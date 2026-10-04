import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PiService } from '@/process/services/pi/PiService';
import { piPaths, piEnvironment } from '@/process/services/pi/paths';
import { insideFolder } from '@/process/services/pi/content';
import { testSecretCodec } from './secretCodec';
import { fixtureServer } from './fixtureServer';

const services: PiService[] = [];
const folders: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'aionpi-runtime-test-'));
  folders.push(root);
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const service = new PiService(piPaths(join(root, 'data'), resolve('resources/aionpi-runtime')), testSecretCodec);
  services.push(service);
  await service.init();
  return { service, cwd, root };
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('real packaged Pi runtime without credentials', () => {
  it('starts the real RPC process and keeps the requested conversation identity', async () => {
    const { service, cwd } = await setup();
    const created = await service.create(cwd);
    const state = await service.command(created.conversation.id, { type: 'get_state' });
    expect(state.sessionId).toBe(created.conversation.id);
    expect((await service.open(created.conversation.id)).phase).toBe('ready');
    expect(await service.list()).toHaveLength(1);
  }, 60000);
  it('offers credential metadata without importing terminal credentials', async () => {
    const { service } = await setup();
    const catalog = await service.settings.catalog();
    expect(catalog.providers.length).toBeGreaterThan(0);
    expect(catalog.providers.some((p) => p.configured)).toBe(false);
    expect(piEnvironment(service.paths).DEEPSEEK_API_KEY).toBeUndefined();
  }, 60000);
  it('does not report a successful Hello test without a selected model', async () => {
    const { service } = await setup();
    await expect(service.testConnection()).rejects.toThrow('model_required');
  });
  it('rejects non-ASCII keys before sending an HTTP request', async () => {
    const { service } = await setup();
    await expect(service.settings.connection({ provider: 'deepseek', apiKey: 'invalid你的密钥' })).rejects.toThrow(
      'invalid_key_characters'
    );
  }, 60000);
  it('does not let a file preview escape its working folder', async () => {
    const { cwd, root } = await setup();
    await writeFile(join(root, 'private.txt'), 'private');
    await expect(insideFolder(cwd, '../private.txt')).rejects.toThrow('file_outside_project');
  });
  it('installs and advertises the real Computer Use and Jev tools', async () => {
    const { service, cwd } = await setup();
    expect(await readFile(join(service.paths.agent, 'extensions', 'theone-automation.js'), 'utf8')).toContain(
      'jev_judge'
    );
    expect(await readFile(join(service.paths.agent, 'skills', 'computer-use', 'SKILL.md'), 'utf8')).toContain(
      'Computer Use'
    );
    const server = await fixtureServer();
    try {
      await service.settings.connection({
        provider: 'automation-fixture',
        apiKey: 'test-only',
        baseUrl: server.url,
        api: 'openai-completions',
        model: 'fixture',
      });
      const created = await service.create(cwd);
      const settled = new Promise<void>((done, reject) => {
        const timer = setTimeout(() => reject(new Error('automation_fixture_timeout')), 20_000);
        service.on('event', (event) => {
          if (
            event.kind === 'record' &&
            event.id === created.conversation.id &&
            event.record.type === 'agent_settled'
          ) {
            clearTimeout(timer);
            done();
          }
        });
      });
      await service.send(created.conversation.id, 'List your available tools.', [], 'steer');
      await settled;
      const request = server.requests.at(-1);
      expect(JSON.stringify(request?.tools)).toContain('computer');
      expect(JSON.stringify(request?.tools)).toContain('jev_judge');
    } finally {
      await server.close();
    }
  }, 60_000);
});
