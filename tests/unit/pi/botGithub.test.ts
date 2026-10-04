import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseGithubBotUrl, readGithubPackage } from '@/process/extensions/botGithub';

const sha = 'a'.repeat(40);
async function githubFixture(mode = 'ok') {
  const root = resolve('docs/guides/bots/writing-bot');
  const manifest = await readFile(resolve(root, 'bot.json'));
  const skill = await readFile(resolve(root, 'skills/writing/SKILL.md'));
  const request = vi.fn<typeof fetch>(async (input, options) => {
    const url = String(input);
    expect(options?.redirect).toBe('error');
    if (mode === 'limit') return new Response('', { status: 403 });
    if (mode === 'private') return new Response('', { status: 404 });
    if (url.endsWith('/repos/owner/repo')) return Response.json({ default_branch: 'main' });
    if (url.includes('/commits/')) {
      const ref = decodeURIComponent(url.split('/commits/')[1]);
      return ['main', 'feature/bot'].includes(ref) ? Response.json({ sha }) : new Response('', { status: 404 });
    }
    if (url.includes('/git/trees/'))
      return Response.json({
        truncated: mode === 'truncated',
        tree: [
          { path: 'bot.json', type: 'blob', mode: '100644', size: manifest.length },
          {
            path: 'skills/writing/SKILL.md',
            type: 'blob',
            mode: mode === 'symlink' ? '120000' : '100644',
            size: skill.length,
          },
          { path: 'other-private-file.txt', type: 'blob', mode: '100644', size: 100 },
        ].map((entry) => ({ ...entry, path: mode === 'subfolder' ? `bots/writer/${entry.path}` : entry.path })),
      });
    if (url.includes('raw.githubusercontent.com') && url.includes(sha))
      return new Response(url.endsWith('bot.json') ? manifest : skill);
    throw new Error('Unexpected download destination');
  });
  return request;
}
describe('public GitHub Bot imports', () => {
  it('pins all files to a commit and downloads only declared package resources', async () => {
    const request = await githubFixture();
    const pack = await readGithubPackage('https://github.com/owner/repo', request);
    expect([...pack.files.keys()]).toEqual(['bot.json', 'skills/writing/SKILL.md']);
    expect(pack.source).toContain(sha);
    expect(request.mock.calls.some(([url]) => String(url).includes('other-private-file'))).toBe(false);
  });
  it('resolves slash-containing branches and Bot subfolders', async () => {
    const pack = await readGithubPackage(
      'https://github.com/owner/repo/tree/feature/bot/bots/writer',
      await githubFixture('subfolder')
    );
    expect(pack.manifest.id).toBe('theone.writing');
    expect(pack.source).toBe(`https://github.com/owner/repo/tree/${sha}/bots/writer`);
  });
  it.each([
    ['limit', 'bot_github_limit'],
    ['private', 'bot_github_missing'],
    ['symlink', 'bot_package_path'],
    ['truncated', 'bot_package_large'],
  ])('rejects %s responses', async (mode, error) => {
    await expect(readGithubPackage('https://github.com/owner/repo', await githubFixture(mode))).rejects.toThrow(error);
  });
  it.each([
    'http://github.com/a/b',
    'https://github.com.evil.test/a/b',
    'https://token@github.com/a/b',
    'https://github.com/a/b/blob/main/bot.json',
  ])('rejects unsupported destinations: %s', (url) => {
    expect(() => parseGithubBotUrl(url)).toThrow('bot_github_url');
  });
});
