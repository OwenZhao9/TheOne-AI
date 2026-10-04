import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, matchesGlob, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const EXCLUDED = new Set(['.git', '.theone', 'node_modules']);
type FileVersion = { hash: string; mode: number; link?: string };
type Files = Record<string, FileVersion>;
type Manifest = { parent: string; workspace: string; files: Files };
export type WorkspaceChange = { path: string; kind: 'added' | 'changed' | 'deleted' };

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function equal(a: FileVersion | undefined, b: FileVersion | undefined): boolean {
  return a?.hash === b?.hash && a?.mode === b?.mode && a?.link === b?.link;
}

/** Private project copies with a baseline; only reviewed, non-conflicting changes enter the parent. */
export class TaskWorkspaces {
  constructor(private data: string) {}

  async create(parent: string): Promise<string> {
    const configured = join(this.data, 'task-workspaces');
    await mkdir(configured, { recursive: true, mode: 0o700 });
    const managed = await realpath(configured);
    const parentPath = await realpath(parent);
    const root = inside(managed, parentPath) ? join(dirname(parentPath), 'runtime', 'children') : managed;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const holder = await mkdtemp(join(root, 'task-'));
    const workspace = join(holder, 'project');
    await mkdir(workspace);
    return workspace;
  }

  async prepare(workspace: string, parent: string): Promise<void> {
    const file = this.manifestPath(workspace);
    try {
      await accessManifest(file);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const source = await realpath(parent);
    if (inside(source, resolve(workspace))) throw new Error('task_workspace_nested');
    await cp(source, workspace, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (path) =>
        !relative(source, path)
          .split(sep)
          .some((part) => EXCLUDED.has(part)),
    });
    const files = await this.scan(workspace);
    // Give each child its own Git metadata, never a pointer to the parent's repository.
    await execute('git', ['-c', 'core.hooksPath=/dev/null', 'init', '--quiet', workspace]);
    await writeFile(file, JSON.stringify({ parent: source, workspace: await realpath(workspace), files }), {
      mode: 0o600,
    });
  }

  state(workspace: string): string {
    return join(dirname(workspace), 'runtime');
  }
  private manifestPath(workspace: string): string {
    return join(dirname(workspace), 'baseline.json');
  }

  async changes(workspace: string): Promise<WorkspaceChange[]> {
    const baseline = await this.manifest(workspace);
    const current = await this.scan(workspace);
    return [...new Set([...Object.keys(baseline.files), ...Object.keys(current)])]
      .sort()
      .filter((path) => !equal(baseline.files[path], current[path]))
      .map((path) => ({ path, kind: !current[path] ? 'deleted' : !baseline.files[path] ? 'added' : 'changed' }));
  }

  async integrate(workspace: string, parent: string, owned: string[]): Promise<WorkspaceChange[]> {
    const baseline = await this.manifest(workspace);
    const destination = await realpath(parent);
    if (baseline.parent !== destination) throw new Error('task_workspace_parent_changed');
    const current = await this.scan(workspace);
    const changes = await this.changes(workspace);
    const selected = changes.filter(({ path }) =>
      owned.some((pattern) => {
        const base = pattern.replace(/\/\*\*?$/, '');
        return (
          pattern === '*' ||
          pattern === '**' ||
          matchesGlob(path, pattern) ||
          path === base ||
          path.startsWith(`${base}/`)
        );
      })
    );
    const operations: {
      path: string;
      target: string;
      before?: FileVersion;
      after?: FileVersion;
      backup?: Buffer;
      next?: Buffer;
    }[] = [];
    for (const { path } of selected) {
      const target = join(destination, path);
      await this.assertTarget(destination, target);
      const before = await this.version(target);
      const after = current[path];
      if (equal(before, after)) continue; // Previously integrated changes are idempotent.
      if (!equal(before, baseline.files[path])) throw new Error(`task_workspace_conflict: ${path}`);
      if (before?.link !== undefined || after?.link !== undefined)
        throw new Error(`task_workspace_symlink_review: ${path}`);
      const next = after ? await readFile(join(workspace, path)) : undefined;
      if (next && createHash('sha256').update(next).digest('hex') !== after?.hash)
        throw new Error('task_workspace_changed_during_review');
      operations.push({ path, target, before, after, backup: before ? await readFile(target) : undefined, next });
    }
    const applied: typeof operations = [];
    try {
      for (const item of operations) {
        await this.assertTarget(destination, item.target);
        if (!equal(await this.version(item.target), item.before))
          throw new Error(`task_workspace_conflict: ${item.path}`);
        await this.replace(item.target, item.next, item.after?.mode);
        applied.push(item);
      }
    } catch (error) {
      // Restore only our own writes; an external edit is never overwritten by rollback.
      for (const item of applied.reverse()) {
        if (equal(await this.version(item.target), item.after))
          await this.replace(item.target, item.backup, item.before?.mode);
      }
      throw error;
    }
    return selected;
  }

  private async manifest(workspace: string): Promise<Manifest> {
    const value = JSON.parse(await readFile(this.manifestPath(workspace), 'utf8')) as Manifest;
    if (value.workspace !== (await realpath(workspace))) throw new Error('task_workspace_invalid');
    return value;
  }
  private async replace(target: string, bytes?: Buffer, mode?: number): Promise<void> {
    if (!bytes) {
      await rm(target, { force: true });
      return;
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.theone-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes, { mode });
      if (mode !== undefined) await chmod(temporary, mode);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async assertTarget(root: string, target: string): Promise<void> {
    if (!inside(root, target) || target === root) throw new Error('task_workspace_path_invalid');
    let probe = target;
    while (probe !== root) {
      try {
        const info = await lstat(probe);
        if (info.isSymbolicLink()) throw new Error('task_workspace_symlink_review');
        if (!inside(root, await realpath(probe))) throw new Error('task_workspace_path_invalid');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      probe = dirname(probe);
    }
  }
  private async version(path: string): Promise<FileVersion | undefined> {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink()) return { hash: '', mode: info.mode & 0o777, link: await readlink(path) };
      if (!info.isFile()) throw new Error('task_workspace_file_type_changed');
      return {
        hash: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
        mode: info.mode & 0o777,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  private async scan(root: string): Promise<Files> {
    const files: Files = Object.create(null) as Files;
    const visit = async (directory: string): Promise<void> => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        if (EXCLUDED.has(item.name)) continue;
        const path = join(directory, item.name);
        if (item.isDirectory()) await visit(path);
        else {
          const version = await this.version(path);
          if (version) files[relative(root, path).split(sep).join('/')] = version;
        }
      }
    };
    await visit(root);
    return files;
  }
}

async function accessManifest(file: string): Promise<void> {
  await readFile(file);
}
