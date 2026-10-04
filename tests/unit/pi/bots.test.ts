import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BotStore } from '@/process/extensions/BotStore';
import { readLocalPackage } from '@/process/extensions/botPackage';
import { parseBotManifest } from '@/common/pi/bots';
import { builtinImageBotPackage } from '@/process/extensions/builtinImageBot';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-bots-'));
  roots.push(root);
  const folder = join(root, 'package');
  await cp(resolve('docs/guides/bots/writing-bot'), folder, { recursive: true });
  const store = new BotStore(join(root, 'data'));
  await store.load();
  return { root, folder, store };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Bot packages and immutable conversation bindings', () => {
  it('seeds the image Bot into the plaza once and keeps removal persistent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-builtin-bot-'));
    roots.push(root);
    const data = join(root, 'data');
    const store = new BotStore(data);
    await store.load();
    await store.seedBuiltins([builtinImageBotPackage()]);
    const imageBot = store.get('theone.image-generation');
    expect(imageBot.source).toBe('builtin:theone.image-generation');
    expect((await store.args(imageBot)).some((arg) => arg.endsWith('/skills/image-generation/SKILL.md'))).toBe(true);

    await store.remove(imageBot.id);
    const reopened = new BotStore(data);
    await reopened.load();
    await reopened.seedBuiltins([builtinImageBotPackage()]);
    expect(reopened.list().some((bot) => bot.id === imageBot.id)).toBe(false);
  });

  it('imports the documented package and keeps it usable after the original folder is deleted', async () => {
    const { folder, store } = await setup();
    const preview = await store.prepare({ folder });
    expect(store.list()).toEqual([]);
    const bot = await store.install(preview.token);
    await rm(folder, { recursive: true });
    expect(await store.args(bot)).toContain('--skill');
    expect(store.list()[0].name).toBe('写作助手');
  });
  it('keeps old session versions through update, restart and plaza removal', async () => {
    const { folder, root, store } = await setup();
    const first = await store.install((await store.prepare({ folder })).token);
    await store.bind('old-session', {
      id: first.id,
      revision: first.revision,
      name: first.name,
      version: first.version,
    });
    const manifest = JSON.parse(await readFile(join(folder, 'bot.json'), 'utf8'));
    manifest.version = '2.0.0';
    manifest.instructions = 'NEW ROLE';
    await writeFile(join(folder, 'bot.json'), JSON.stringify(manifest));
    await store.install((await store.prepare({ folder })).token);
    await store.favorite(first.id, true);
    const reopened = new BotStore(join(root, 'data'));
    await reopened.load();
    expect(reopened.list()[0]).toMatchObject({ version: '2.0.0', favorite: true });
    await reopened.remove(first.id);
    expect((await reopened.args(reopened.binding('old-session')!)).join(' ')).not.toContain('NEW ROLE');
    expect(reopened.list()).toEqual([]);
  });
  it('blocks execution for missing tools without blocking import', async () => {
    const { folder, store } = await setup();
    const manifest = JSON.parse(await readFile(join(folder, 'bot.json'), 'utf8'));
    manifest.requiredCapabilities = ['computer-use'];
    await writeFile(join(folder, 'bot.json'), JSON.stringify(manifest));
    const bot = await store.install((await store.prepare({ folder })).token);
    expect(bot.missingCapabilities).toEqual(['computer-use']);
    await expect(store.args(bot)).rejects.toThrow('bot_tools_missing');
  });
  it('detects tampering with an installed version before launching it', async () => {
    const { folder, store } = await setup();
    const bot = await store.install((await store.prepare({ folder })).token);
    await writeFile(join(store.root, 'packages', bot.revision, 'README.md'), 'changed');
    await expect(store.args(bot)).rejects.toThrow('bot_package_changed');
    await store.install((await store.prepare({ folder })).token);
    expect(await store.args(bot)).toContain('--skill');
  });
  it('rejects symlink ancestors instead of reading resources outside the package', async () => {
    const { root, folder } = await setup();
    await cp(join(folder, 'skills'), join(root, 'external'), { recursive: true });
    await rm(join(folder, 'skills'), { recursive: true });
    await symlink(join(root, 'external'), join(folder, 'skills'));
    await expect(readLocalPackage(folder)).rejects.toThrow('bot_package_path');
  });
  it('rejects missing skill descriptions and does not install partial packages', async () => {
    const { folder, store } = await setup();
    await writeFile(join(folder, 'skills/writing/SKILL.md'), '---\nname: writing\n---\nDo a task');
    await expect(store.prepare({ folder })).rejects.toThrow('bot_skill_invalid');
    expect(store.list()).toEqual([]);
  });
  it('rejects duplicate skill names and parent traversal', async () => {
    const { folder } = await setup();
    const manifest = JSON.parse(await readFile(join(folder, 'bot.json'), 'utf8'));
    expect(() => parseBotManifest({ ...manifest, skills: ['skills/../../outside/SKILL.md'] })).toThrow();
    await mkdir(join(folder, 'skills/second'));
    await cp(join(folder, 'skills/writing/SKILL.md'), join(folder, 'skills/second/SKILL.md'));
    await writeFile(
      join(folder, 'bot.json'),
      JSON.stringify({ ...manifest, skills: [...manifest.skills, 'skills/second/SKILL.md'] })
    );
    await expect(readLocalPackage(folder)).rejects.toThrow('bot_skill_invalid');
  });
  it('cannot install a discarded preview', async () => {
    const { folder, store } = await setup();
    const preview = await store.prepare({ folder });
    store.discard(preview.token);
    await expect(store.install(preview.token)).rejects.toThrow('bot_preview_expired');
  });
});
