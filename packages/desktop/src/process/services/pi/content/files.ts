import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PiAttachment, PiFile, PiGit, PiPreview } from '@/common/pi';

const execute = promisify(execFile);
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const MAX_ATTACHMENT = 16 * 1024 * 1024;

export async function insideFolder(cwd: string, requested = ''): Promise<string> {
  const root = await realpath(cwd);
  const path = await realpath(isAbsolute(requested) ? requested : resolve(root, requested));
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('file_outside_project');
  return path;
}

export async function listFiles(cwd: string, path = '', search?: string): Promise<PiFile[]> {
  const directory = await insideFolder(cwd, path);
  const result: PiFile[] = [];
  let visited = 0;
  const walk = async (folder: string, depth: number): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.isSymbolicLink()) continue;
      if (++visited > 10000 || result.length >= 1000) return;
      const full = join(folder, entry.name);
      const rel = relative(cwd, full);
      if (!search || rel.toLowerCase().includes(search.toLowerCase()))
        result.push({ name: entry.name, path: rel, directory: entry.isDirectory() });
      if (search && depth < 6 && entry.isDirectory() && !['node_modules', '.cache', 'dist', 'out'].includes(entry.name))
        await walk(full, depth + 1);
    }
  };
  await walk(directory, 0);
  return result;
}

export async function previewFile(cwd: string, requested: string): Promise<PiPreview> {
  const path = await insideFolder(cwd, requested);
  const info = await stat(path);
  if (!info.isFile()) throw new Error('not_a_file');
  const extension = extname(path).toLowerCase();
  const mimeType = IMAGE_TYPES[extension] || (extension === '.pdf' ? 'application/pdf' : undefined);
  if (mimeType) {
    if (info.size > MAX_ATTACHMENT) throw new Error('file_too_large');
    return {
      path: requested,
      kind: extension === '.pdf' ? 'pdf' : 'image',
      content: (await readFile(path)).toString('base64'),
      mimeType,
    };
  }
  if (info.size > 2 * 1024 * 1024) throw new Error('preview_too_large');
  const bytes = await readFile(path);
  if (bytes.includes(0)) return { path: requested, kind: 'binary', content: '' };
  return { path: requested, kind: 'text', content: bytes.toString('utf8') };
}

export async function attachmentInput(
  attachments: PiAttachment[]
): Promise<{ images: { type: 'image'; mimeType: string; data: string }[]; paths: string[] }> {
  const images: { type: 'image'; mimeType: string; data: string }[] = [];
  const paths: string[] = [];
  if (attachments.length > 20) throw new Error('too_many_attachments');
  let total = 0;
  for (const item of attachments) {
    if (item.path) {
      const path = await realpath(item.path);
      const info = await stat(path);
      const mimeType = IMAGE_TYPES[extname(path).toLowerCase()];
      if (mimeType && info.isFile()) {
        total += info.size;
        if (total > MAX_ATTACHMENT) throw new Error('file_too_large');
        images.push({ type: 'image', mimeType, data: (await readFile(path)).toString('base64') });
      } else paths.push(path);
    } else if (item.data && item.mimeType && Object.values(IMAGE_TYPES).includes(item.mimeType)) {
      const bytes = Buffer.from(item.data, 'base64');
      total += bytes.length;
      if (!bytes.length || total > MAX_ATTACHMENT) throw new Error('file_too_large');
      images.push({ type: 'image', mimeType: item.mimeType, data: bytes.toString('base64') });
    } else throw new Error(`attachment_invalid:${basename(item.name)}`);
  }
  return { images, paths };
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execute('/usr/bin/git', ['--no-pager', '-c', 'core.fsmonitor=false', ...args], {
      cwd,
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '0' },
    });
    return result.stdout;
  } catch {
    throw new Error('git_unavailable');
  }
}
export async function gitStatus(cwd: string): Promise<PiGit> {
  const [branch, status, topLevel] = await Promise.all([
    git(cwd, ['branch', '--show-current']),
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    git(cwd, ['rev-parse', '--show-toplevel']),
  ]);
  const root = topLevel.trim();
  const folder = await realpath(cwd);
  const parts = status.split('\0');
  const files: PiGit['files'] = [];
  for (let i = 0; i < parts.length && files.length < 1000; i++) {
    if (!parts[i]) continue;
    const state = parts[i].slice(0, 2);
    const path = relative(folder, resolve(root, parts[i].slice(3)));
    const oldPath =
      state.includes('R') || state.includes('C') ? relative(folder, resolve(root, parts[++i])) : undefined;
    if (path === '..' || path.startsWith('../') || isAbsolute(path)) continue;
    files.push({ path, status: state, ...(oldPath ? { oldPath } : {}) });
  }
  return { branch: branch.trim() || 'HEAD', files };
}
export async function gitDiff(cwd: string, path: string): Promise<string> {
  const state = await gitStatus(cwd);
  const file = state.files.find((f) => f.path === path);
  if (!file) throw new Error('file_missing');
  if (file.status === '??') return (await previewFile(cwd, path)).content;
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--', path];
  const [working, staged] = await Promise.all([
    git(cwd, args),
    git(cwd, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--', path]),
  ]);
  return [staged, working].filter(Boolean).join('\n');
}
