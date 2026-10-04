import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { load, JSON_SCHEMA } from 'js-yaml';
import { botRelativePath, parseBotManifest, type BotManifest } from '@/common/pi/bots';

export type BotPackage = { manifest: BotManifest; files: Map<string, Buffer>; revision: string; source: string };
export const BOT_MAX_BYTES = 20 * 1024 * 1024;
export const BOT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const BOT_MAX_FILES = 200;
export function packageIncludes(manifest: BotManifest, path: string): boolean {
  return (
    path === 'bot.json' ||
    ['LICENSE', 'LICENSE.md', 'README.md'].includes(path) ||
    manifest.skills.some((skill) => path.startsWith(`${skill.slice(0, -'SKILL.md'.length)}`))
  );
}
export function validatePackage(files: Map<string, Buffer>, source: string): BotPackage {
  let manifest: BotManifest;
  try {
    manifest = parseBotManifest(JSON.parse(files.get('bot.json')?.toString('utf8') || ''));
  } catch {
    throw new Error('bot_manifest_invalid');
  }
  if (files.size > BOT_MAX_FILES || [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > BOT_MAX_BYTES)
    throw new Error('bot_package_large');
  const names = new Set<string>();
  for (const [path, bytes] of files) {
    if (!botRelativePath(path) || !packageIncludes(manifest, path) || names.has(path.toLowerCase()))
      throw new Error('bot_package_path');
    if (bytes.length > BOT_MAX_FILE_BYTES) throw new Error('bot_package_large');
    names.add(path.toLowerCase());
  }
  const skillNames = new Set<string>();
  for (const path of manifest.skills) {
    const content = files.get(path)?.toString('utf8');
    const match = content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match || !content?.slice(match[0].length).trim()) throw new Error('bot_skill_invalid');
    let meta: Record<string, unknown>;
    try {
      meta = load(match[1], { schema: JSON_SCHEMA }) as Record<string, unknown>;
    } catch {
      throw new Error('bot_skill_invalid');
    }
    if (
      !meta ||
      typeof meta.name !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name) ||
      meta.name.length > 64 ||
      typeof meta.description !== 'string' ||
      !meta.description.trim() ||
      meta.description.length > 1024 ||
      meta['disable-model-invocation'] === true ||
      skillNames.has(meta.name)
    )
      throw new Error('bot_skill_invalid');
    skillNames.add(meta.name);
  }
  const hash = createHash('sha256');
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  return { manifest, files, revision: hash.digest('hex'), source };
}
export async function readLocalPackage(root: string): Promise<BotPackage> {
  const manifestPath = join(root, 'bot.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).size > BOT_MAX_FILE_BYTES)
    throw new Error('bot_manifest_invalid');
  const manifestBytes = await readFile(manifestPath);
  let manifest: BotManifest;
  try {
    manifest = parseBotManifest(JSON.parse(manifestBytes.toString('utf8')));
  } catch {
    throw new Error('bot_manifest_invalid');
  }
  const files = new Map<string, Buffer>([['bot.json', manifestBytes]]);
  let total = manifestBytes.length;
  async function visit(path: string): Promise<void> {
    if (!botRelativePath(path)) throw new Error('bot_package_path');
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      if ((await lstat(join(root, ...parts.slice(0, i)))).isSymbolicLink()) throw new Error('bot_package_path');
    }
    const entry = await lstat(join(root, path));
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error('bot_package_path');
    if (entry.isDirectory()) {
      for (const name of await readdir(join(root, path))) await visit(`${path}/${name}`);
    } else {
      if (files.has(path)) return;
      total += entry.size;
      if (entry.size > BOT_MAX_FILE_BYTES || total > BOT_MAX_BYTES || files.size >= BOT_MAX_FILES)
        throw new Error('bot_package_large');
      files.set(path, await readFile(join(root, path)));
    }
  }
  for (const dir of new Set(manifest.skills.map((skill) => dirname(skill)))) await visit(dir);
  for (const name of ['README.md', 'LICENSE', 'LICENSE.md']) {
    try {
      await visit(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return validatePackage(files, root);
}
export async function writePackage(root: string, pack: BotPackage): Promise<void> {
  for (const [path, bytes] of pack.files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes, { mode: 0o600 });
  }
}
