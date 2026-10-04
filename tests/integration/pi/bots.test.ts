import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PiService } from '@/process/services/pi/PiService';
import { piPaths } from '@/process/services/pi/paths';
import { fixtureServer } from './fixtureServer';
import { testSecretCodec } from './secretCodec';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
describe('Bot skills in the real bundled Pi (local transport, not real-model acceptance)', () => {
  it('loads only the selected skills, sends Bot instructions and retains binding through restart and fork', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-bot-rpc-'));
    const cwd = join(root, 'project');
    await mkdir(join(cwd, '.pi/skills/unrelated'), { recursive: true });
    await writeFile(
      join(cwd, '.pi/skills/unrelated/SKILL.md'),
      '---\nname: unrelated\ndescription: Unrelated skill\n---\nUNRELATED_SKILL'
    );
    const server = await fixtureServer();
    const paths = piPaths(join(root, 'data'), resolve(process.env.AIONPI_TEST_RUNTIME || 'resources/aionpi-runtime'));
    let service = new PiService(paths, testSecretCodec);
    cleanup.push(async () => {
      await service.dispose();
      await server.close();
      await rm(root, { recursive: true, force: true });
    });
    await service.init();
    await service.settings.connection({
      provider: 'fixture',
      apiKey: 'test-only',
      baseUrl: server.url,
      api: 'openai-completions',
      model: 'fixture',
    });
    const bot = await service.bots.install(
      (await service.bots.prepare({ folder: resolve('docs/guides/bots/writing-bot') })).token
    );
    const created = await service.create(cwd, bot.id);
    const id = created.conversation.id;
    const commands = JSON.stringify(await service.command(id, { type: 'get_commands' }));
    expect(commands).toContain('writing');
    expect(commands).not.toContain('unrelated');
    const settled = new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('bot_run_timeout')), 25000);
      service.on('event', (event) => {
        if (
          event.kind === 'snapshot' &&
          event.snapshot.conversation.id === id &&
          event.snapshot.view.messages.some((m) => m.role === 'assistant' && m.entryId) &&
          !event.snapshot.view.syncing
        ) {
          clearTimeout(timer);
          done();
        }
      });
    });
    await service.send(id, 'Hello', [], 'steer');
    await settled;
    const request = JSON.stringify(server.requests[0]);
    expect(request).toContain('写作助手');
    expect(request).toContain('skills/writing/SKILL.md');
    await service.dispose();
    service = new PiService(paths, testSecretCodec);
    await service.init();
    const restored = await service.open(id);
    expect(restored.conversation.bot?.revision).toBe(bot.revision);
    const fork = await service.fork(id, restored.view.messages.at(-1)!.entryId!);
    expect(fork.snapshot.conversation.bot?.revision).toBe(bot.revision);
  }, 60000);
});
