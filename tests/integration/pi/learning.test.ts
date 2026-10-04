import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultPiLearningProfile, type PiEvent, type PiLearningLevel } from '@/common/pi';
import { PiService } from '@/process/services/pi/PiService';
import { piPaths } from '@/process/services/pi/paths';
import { fixtureServer } from './fixtureServer';
import { testSecretCodec } from './secretCodec';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

function waitFor(service: PiService, predicate: (event: PiEvent) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const listener = (event: PiEvent) => {
      if (!predicate(event)) return;
      clearTimeout(timer);
      service.off('event', listener);
      resolve();
    };
    const timer = setTimeout(() => {
      service.off('event', listener);
      reject(new Error('learning_timeout'));
    }, 20000);
    service.on('event', listener);
  });
}
async function sendAndSettle(service: PiService, id: string, text: string) {
  let settled = false;
  const done = waitFor(service, (event) => {
    if (event.kind === 'record' && event.id === id && event.record.type === 'agent_settled') settled = true;
    return (
      settled && event.kind === 'snapshot' && event.snapshot.conversation.id === id && !event.snapshot.view.syncing
    );
  });
  await service.send(id, text, [], 'steer');
  await done;
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-'));
  const cwd = join(root, 'project');
  await mkdir(cwd);
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
    provider: 'learning-fixture',
    apiKey: 'test-only',
    baseUrl: server.url,
    api: 'openai-completions',
    model: 'fixture',
  });
  return {
    service,
    server,
    cwd,
    restart: async () => {
      await service.dispose();
      service = new PiService(paths, testSecretCodec);
      await service.init();
      return service;
    },
  };
}
const profile = (level: PiLearningLevel) => ({ ...defaultPiLearningProfile(), level });
const systemText = (request: Record<string, unknown>) =>
  JSON.stringify((request.messages as { role: string }[]).filter((m) => m.role === 'system'));

describe('learning instructions through real Pi to a local endpoint (not live-model acceptance)', () => {
  it('does not start a prompt while the new level is still being saved', async () => {
    const { service, cwd, server } = await setup();
    const id = (await service.create(cwd)).conversation.id;
    const save = service.store.setLearning.bind(service.store);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(service.store, 'setLearning').mockImplementationOnce(async (...args) => {
      await pending;
      await save(...args);
    });
    const update = service.setLearning(id, profile('expert'));
    try {
      await expect(service.send(id, 'during save', [], 'steer')).rejects.toThrow('session_busy');
      expect(server.requests).toHaveLength(0);
    } finally {
      release();
      await update;
    }
    await sendAndSettle(service, id, 'after save');
    expect(systemText(server.requests.at(-1)!)).toContain('Treat the user as highly experienced');
  }, 60000);

  it('updates a persisted session, keeps Bot instructions and model selection, and restores through restart/fork', async () => {
    const context = await setup();
    let service = context.service;
    const { server, cwd } = context;
    const bot = await service.bots.install(
      (await service.bots.prepare({ folder: resolve('docs/guides/bots/writing-bot') })).token
    );
    const { conversation } = await service.create(cwd, bot.id);
    await service.setLearning(conversation.id, profile('beginner'));
    await sendAndSettle(service, conversation.id, 'first');
    expect(systemText(server.requests.at(-1)!)).toContain('Treat the user as a beginner');
    expect(systemText(server.requests.at(-1)!)).toContain('使用写作技能帮助用户');
    const before = await service.open(conversation.id);
    await service.setLearning(conversation.id, profile('expert'));
    await sendAndSettle(service, conversation.id, 'second');
    const request = systemText(server.requests.at(-1)!);
    expect(request).toContain('Treat the user as highly experienced');
    expect(request).not.toContain('Treat the user as a beginner');
    expect((await service.open(conversation.id)).view.model).toEqual(before.view.model);
    expect((await service.open(conversation.id)).view.thinkingLevel).toEqual(before.view.thinkingLevel);
    service = await context.restart();
    const reopened = await service.open(conversation.id);
    expect(reopened.conversation.learning?.level).toBe('expert');
    const fork = await service.fork(conversation.id, reopened.view.messages.at(-1)!.entryId!);
    expect(fork.snapshot.conversation.learning?.level).toBe('expert');
    await service.setLearning(fork.snapshot.conversation.id, profile('beginner'));
    expect((await service.open(conversation.id)).conversation.learning?.level).toBe('expert');
  }, 60000);

  it('rejects updates during a running reply and allows them after abort', async () => {
    const { service, cwd } = await setup();
    const id = (await service.create(cwd)).conversation.id;
    await service.setLearning(id, profile('beginner'));
    const started = waitFor(service, (e) => e.kind === 'record' && e.id === id && e.record.type === 'message_update');
    await service.send(id, 'WAIT', [], 'steer');
    await started;
    await expect(service.setLearning(id, profile('expert'))).rejects.toThrow('session_busy');
    expect((await service.open(id)).conversation.learning?.level).toBe('beginner');
    const done = waitFor(
      service,
      (e) => e.kind === 'record' && e.id === id && e.record.type === 'desktop_synchronized'
    );
    await service.command(id, { type: 'abort' });
    await done;
    await service.setLearning(id, { ...profile('expert'), source: 'automatic' });
    expect((await service.open(id)).conversation.learning?.source).toBe('manual');
  }, 60000);
});
