import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { TaskWorkspaces } from '@/process/services/pi/tasks/TaskWorkspaces';
import { taskSandbox } from '@/process/services/pi/tasks/sandbox';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-workspaces-'));
  roots.push(root);
  const parent = join(root, 'parent');
  await mkdir(parent);
  await writeFile(join(parent, 'app.txt'), 'base');
  const service = new TaskWorkspaces(join(root, 'data'));
  const child = await service.create(parent);
  await service.prepare(child, parent);
  return { root, parent, child, service };
}
describe('delegated project integration', () => {
  it('keeps child changes private until acceptance and detects concurrent parent edits without partial writes', async () => {
    const { parent, child, service } = await setup();
    await writeFile(join(child, 'app.txt'), 'child');
    await writeFile(join(child, 'added.txt'), 'new');
    expect(await readFile(join(parent, 'app.txt'), 'utf8')).toBe('base');
    await writeFile(join(parent, 'app.txt'), 'parent edit');
    await expect(service.integrate(child, parent, ['**'])).rejects.toThrow('task_workspace_conflict');
    await expect(readFile(join(parent, 'added.txt'))).rejects.toThrow();
    expect(await readFile(join(parent, 'app.txt'), 'utf8')).toBe('parent edit');
  });
  it('integrates only declared files, including deletion, and supports retry', async () => {
    const { parent, child, service } = await setup();
    await rm(join(child, 'app.txt'));
    await writeFile(join(child, 'new.txt'), 'new');
    await writeFile(join(child, 'unowned.txt'), 'not a delivery');
    await service.integrate(child, parent, ['app.txt', 'new.txt']);
    await service.integrate(child, parent, ['app.txt', 'new.txt']);
    expect(await readFile(join(parent, 'new.txt'), 'utf8')).toBe('new');
    await expect(readFile(join(parent, 'app.txt'))).rejects.toThrow();
    await expect(readFile(join(parent, 'unowned.txt'))).rejects.toThrow();
  });
  it('takes dependency snapshots at start and folds a grandchild into its direct parent before root integration', async () => {
    const { parent, child, service } = await setup();
    const next = await service.create(parent);
    await writeFile(join(child, 'app.txt'), 'first');
    await service.integrate(child, parent, ['app.txt']);
    await service.prepare(next, parent);
    expect(await readFile(join(next, 'app.txt'), 'utf8')).toBe('first');
    const grandchild = await service.create(next);
    await service.prepare(grandchild, next);
    await writeFile(join(grandchild, 'logo.txt'), 'logo');
    await service.integrate(grandchild, next, ['logo.txt']);
    await service.integrate(next, parent, ['**']);
    expect(await readFile(join(parent, 'logo.txt'), 'utf8')).toBe('logo');
  });
  it('refuses integration through symlinks', async () => {
    const { root, parent, child, service } = await setup();
    await mkdir(join(child, 'assets'));
    await writeFile(join(child, 'assets', 'new.txt'), 'new');
    await symlink(root, join(parent, 'assets'));
    await expect(service.integrate(child, parent, ['assets'])).rejects.toThrow('task_workspace_symlink_review');
    await expect(readFile(join(root, 'new.txt'))).rejects.toThrow();
  });
  it.skipIf(process.platform !== 'darwin')(
    'allows real build subprocesses but blocks absolute, traversal and symlink writes to the parent',
    async () => {
      const { parent, child, service } = await setup();
      const sandbox = await taskSandbox(child, service.state(child));
      await symlink(parent, join(child, 'escape'));
      const program = `const fs = require('node:fs'); const cp = require('node:child_process');
      cp.execFileSync(process.execPath, ['-e', "require('node:fs').writeFileSync('built.txt','built')"]);
      for (const target of ${JSON.stringify([join(parent, 'app.txt'), join(child, 'escape', 'app.txt')])}) {
        try { fs.writeFileSync(target, 'escaped'); throw new Error('write escaped'); }
        catch (e) { if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e; }
      }`;
      await execute(sandbox.executable, [...sandbox.prefix, process.execPath, '-e', program], {
        cwd: child,
        env: { ...process.env, ...sandbox.env },
      });
      await writeFile(
        join(child, 'package.json'),
        JSON.stringify({ scripts: { build: "node -e \"require('fs').writeFileSync('npm-built.txt', 'built')\"" } })
      );
      const npm = (await execute('/usr/bin/which', ['npm'])).stdout.trim();
      await execute(sandbox.executable, [...sandbox.prefix, process.execPath, npm, 'run', 'build'], {
        cwd: child,
        env: { ...process.env, ...sandbox.env },
      });
      expect(await readFile(join(child, 'npm-built.txt'), 'utf8')).toBe('built');
      expect(await readFile(join(child, 'built.txt'), 'utf8')).toBe('built');
      expect(await readFile(join(parent, 'app.txt'), 'utf8')).toBe('base');
    }
  );
});
