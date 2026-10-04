import { parseBotManifest } from '@/common/pi/bots';
import {
  BOT_MAX_BYTES,
  BOT_MAX_FILE_BYTES,
  BOT_MAX_FILES,
  packageIncludes,
  validatePackage,
  type BotPackage,
} from './botPackage';

type GithubTarget = { owner: string; repo: string; tree: string[] };
export function parseGithubBotUrl(input: string): GithubTarget {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('bot_github_url');
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length < 2 ||
    !/^[\w.-]+$/.test(parts[0]) ||
    !/^[\w.-]+$/.test(parts[1]) ||
    (parts.length > 2 && (parts[2] !== 'tree' || parts.length < 4))
  )
    throw new Error('bot_github_url');
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, ''), tree: parts.slice(3) };
}
async function bytes(url: string, max: number, request: typeof fetch, signal: AbortSignal): Promise<Buffer> {
  const response = await request(url, {
    signal,
    redirect: 'error',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TheOne-Bot-Import' },
  });
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'bot_github_missing'
        : response.status === 403 || response.status === 429
          ? 'bot_github_limit'
          : 'bot_github_failed'
    );
  if (!response.body || Number(response.headers.get('content-length') || 0) > max) throw new Error('bot_package_large');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > max) throw new Error('bot_package_large');
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
/** Public GitHub packages only. Resolve to a commit before downloading any package file. */
export async function readGithubPackage(input: string, request: typeof fetch = fetch): Promise<BotPackage> {
  const target = parseGithubBotUrl(input);
  const signal = AbortSignal.timeout(60000);
  const base = `https://api.github.com/repos/${target.owner}/${target.repo}`;
  const json = async (url: string): Promise<Record<string, unknown>> =>
    JSON.parse((await bytes(url, 8 * 1024 * 1024, request, signal)).toString('utf8')) as Record<string, unknown>;
  let commit: Record<string, unknown> | undefined;
  let folder = '';
  if (!target.tree.length) {
    const repo = await json(base);
    if (typeof repo.default_branch !== 'string') throw new Error('bot_github_failed');
    commit = await json(`${base}/commits/${encodeURIComponent(repo.default_branch)}`);
  } else {
    // Longest existing ref handles branch names that contain slashes.
    for (let n = Math.min(target.tree.length, 10); n >= 1; n--) {
      try {
        commit = await json(`${base}/commits/${encodeURIComponent(target.tree.slice(0, n).join('/'))}`);
        folder = target.tree.slice(n).join('/');
        break;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'bot_github_missing') throw error;
      }
    }
  }
  if (typeof commit?.sha !== 'string' || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('bot_github_missing');
  const prefix = folder ? `${folder}/` : '';
  const rawBase = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${commit.sha}/`;
  const raw = (path: string): Promise<Buffer> =>
    bytes(rawBase + (prefix + path).split('/').map(encodeURIComponent).join('/'), BOT_MAX_FILE_BYTES, request, signal);
  const manifestBytes = await raw('bot.json');
  let manifest;
  try {
    manifest = parseBotManifest(JSON.parse(manifestBytes.toString('utf8')));
  } catch {
    throw new Error('bot_manifest_invalid');
  }
  const tree = await json(`${base}/git/trees/${commit.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('bot_package_large');
  const entries = (tree.tree as { path: string; type: string; mode: string; size?: number }[]).filter(
    (entry) =>
      typeof entry.path === 'string' &&
      entry.path.startsWith(prefix) &&
      entry.type !== 'tree' &&
      packageIncludes(manifest, entry.path.slice(prefix.length))
  );
  if (entries.length > BOT_MAX_FILES || entries.reduce((sum, entry) => sum + (entry.size || 0), 0) > BOT_MAX_BYTES)
    throw new Error('bot_package_large');
  if (entries.some((entry) => !['100644', '100755'].includes(entry.mode) || entry.type !== 'blob'))
    throw new Error('bot_package_path');
  const files = new Map<string, Buffer>([['bot.json', manifestBytes]]);
  for (let i = 0; i < entries.length; i += 4) {
    await Promise.all(
      entries.slice(i, i + 4).map(async (entry) => {
        const path = entry.path.slice(prefix.length);
        if (path !== 'bot.json') files.set(path, await raw(path));
      })
    );
  }
  return validatePackage(
    files,
    `https://github.com/${target.owner}/${target.repo}/tree/${commit.sha}${folder ? `/${folder}` : ''}`
  );
}
