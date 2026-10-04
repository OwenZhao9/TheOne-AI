import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PiService } from '@/process/services/pi/PiService';
import { piPaths } from '@/process/services/pi/paths';
import type { PiEvent } from '@/common/pi';
import { fixtureServer } from './fixtureServer';
import { testSecretCodec } from './secretCodec';

const cleanup: (() => Promise<unknown>)[] = [];
async function setup(configure = true) {
  const root = await mkdtemp(join(tmpdir(), 'aionpi-conversation-test-'));
  const server = await fixtureServer();
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const paths = piPaths(join(root, 'data'), resolve('resources/aionpi-runtime'));
  await writeFile(join(paths.agent, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
  const service = new PiService(paths, testSecretCodec);
  await service.init();
  cleanup.push(async () => {
    await service.dispose();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  if (configure)
    await service.settings.connection({
      provider: 'aionpi-fixture',
      apiKey: 'local-fixture',
      baseUrl: server.url,
      api: 'openai-completions',
      model: 'fixture',
      imageInput: true,
    });
  const created = await service.create(cwd);
  return { service, cwd, id: created.conversation.id, server, paths };
}
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});
function waitFor(service: PiService, predicate: (event: PiEvent) => boolean): Promise<PiEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off('event', listener);
      reject(new Error('fixture_event_timeout'));
    }, 30000);
    const listener = (event: PiEvent) => {
      if (predicate(event)) {
        clearTimeout(timer);
        service.off('event', listener);
        resolve(event);
      }
    };
    service.on('event', listener);
  });
}
function settled(service: PiService, id: string): Promise<PiEvent> {
  let finished = false;
  return waitFor(service, (event) => {
    if (event.kind === 'record' && event.id === id && event.record.type === 'agent_settled') finished = true;
    return (
      finished &&
      event.kind === 'snapshot' &&
      event.snapshot.conversation.id === id &&
      !event.snapshot.view.streaming &&
      !event.snapshot.view.syncing &&
      event.snapshot.view.messages.some((m) => m.role === 'assistant' && m.entryId !== undefined)
    );
  });
}

describe('Pi integration against a local transport fixture (not real-model acceptance)', () => {
  it('retries the same unsent conversation after first-time model setup', async () => {
    const { service, id, server } = await setup(false);
    await service.rename(id, '首次配置测试');
    await expect(service.send(id, 'Hello', [], 'steer')).rejects.toThrow();
    await service.settingsChange(() =>
      service.settings.connection({
        provider: 'aionpi-fixture',
        apiKey: 'local-fixture',
        baseUrl: server.url,
        api: 'openai-completions',
        model: 'fixture',
      })
    );
    const done = settled(service, id);
    await service.send(id, 'Hello', [], 'steer');
    await done;
    expect(JSON.stringify((await service.open(id)).view.messages)).toContain('Fixture reply: Hello');
    expect((await service.open(id)).conversation.title).toBe('首次配置测试');
  }, 60000);
  it('executes real file tools and restores the same transcript after restart', async () => {
    const { service, cwd, id, paths } = await setup();
    const done = settled(service, id);
    await service.send(id, 'TOOLS', [], 'steer');
    await done;
    expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('edited version');
    const before = await service.open(id);
    expect(before.view.messages.filter((m) => m.role === 'toolResult')).toHaveLength(3);
    await service.dispose();
    const reopened = new PiService(paths, testSecretCodec);
    cleanup.push(() => reopened.dispose());
    await reopened.init();
    expect((await reopened.open(id)).view.messages.map((m) => m.content)).toEqual(
      before.view.messages.map((m) => m.content)
    );
  }, 60000);
  it('branches from a saved message without overwriting the original session', async () => {
    const { service, id } = await setup();
    const done = settled(service, id);
    await service.send(id, 'first message', [], 'steer');
    await done;
    const before = await service.open(id);
    const fork = await service.fork(id, before.view.messages.at(-1)!.entryId!);
    expect(fork.snapshot.conversation.id).not.toBe(id);
    expect((await service.open(id)).view.messages).toEqual(before.view.messages);
    expect((await service.list()).map((c) => c.id)).toContain(fork.snapshot.conversation.id);
  }, 60000);
  it('queues, returns queued input, and aborts a live run', async () => {
    const { service, id } = await setup();
    const started = waitFor(service, (e) => e.kind === 'record' && e.record.type === 'message_update');
    await service.send(id, 'WAIT', [], 'steer');
    await started;
    await service.send(id, 'next instruction', [], 'followUp');
    expect((await service.open(id)).view.queue.followUp).toContain('next instruction');
    expect((await service.command(id, { type: 'clear_queue' })).followUp).toContain('next instruction');
    const end = waitFor(service, (e) => e.kind === 'record' && e.record.type === 'agent_settled');
    await service.command(id, { type: 'abort' });
    await end;
    expect((await service.open(id)).view.streaming).toBe(false);
  }, 60000);
  it('sends real image blocks through Pi to the endpoint', async () => {
    const { service, id, server } = await setup();
    const done = settled(service, id);
    await service.send(
      id,
      'image test',
      [
        {
          name: 'app.png',
          mimeType: 'image/png',
          data: (await readFile(resolve('resources/app.png'))).toString('base64'),
        },
      ],
      'steer'
    );
    await done;
    expect(JSON.stringify(server.requests.at(-1)?.messages).includes('image_url')).toBe(true);
    expect(
      (await service.open(id)).view.messages.filter((m) => m.role === 'user').map((m) => m.content.map((b) => b.type))
    ).toContainEqual(expect.arrayContaining(['image']));
  }, 60000);
  it('reports a rejected credential and keeps the failed conversation', async () => {
    const { service, id } = await setup();
    const done = settled(service, id);
    await service.send(id, 'HTTP_FAIL', [], 'steer');
    await done;
    expect((await service.open(id)).view.error).toContain('Fixture credential rejected');
    expect((await service.list()).some((c) => c.id === id)).toBe(true);
  }, 60000);
  it('keeps event numbering increasing when an idle Pi process is restarted', async () => {
    const { service, id } = await setup();
    const first = settled(service, id);
    await service.send(id, 'first', [], 'steer');
    await first;
    const before = await service.open(id);
    await service.close(id);
    const second = settled(service, id);
    await service.send(id, 'second', [], 'steer');
    await second;
    const after = await service.open(id);
    expect(after.seq).toBeGreaterThan(before.seq);
  }, 60000);
  it('shows a network failure without leaving the conversation running', async () => {
    const { service, id, server } = await setup();
    await server.close();
    const done = settled(service, id);
    await service.send(id, 'network failure', [], 'steer');
    await done;
    const snapshot = await service.open(id);
    expect(snapshot.view.streaming).toBe(false);
    expect(snapshot.view.error).toBeTruthy();
  }, 60000);
  it('recovers after the real Pi child unexpectedly exits', async () => {
    const { service, id } = await setup();
    const started = waitFor(service, (e) => e.kind === 'record' && e.record.type === 'message_update');
    await service.send(id, 'WAIT', [], 'steer');
    await started;
    const failed = waitFor(service, (e) => e.kind === 'record' && e.record.type === 'desktop_error');
    const internals = service as unknown as { live: Map<string, { host: { child: { pid: number } } }> };
    process.kill(internals.live.get(id)!.host.child.pid, 'SIGKILL');
    await failed;
    expect((await service.open(id)).view.streaming).toBe(false);
    const done = settled(service, id);
    await service.send(id, 'retry after crash', [], 'steer');
    await done;
    expect(JSON.stringify((await service.open(id)).view.messages)).toContain('Fixture reply: retry after crash');
  }, 60000);
  it('relays native Pi extension questions and answers without changing Pi', async () => {
    const { service, id, paths } = await setup();
    const extensions = join(paths.agent, 'extensions');
    await mkdir(extensions, { recursive: true });
    await writeFile(
      join(extensions, 'questions.ts'),
      `export default function(pi) {
      pi.registerCommand('questions', { description: 'Question fixture', handler: async (_args, ctx) => {
        const values = [];
        values.push(await ctx.ui.select('选择', ['one', 'two']));
        values.push(await ctx.ui.confirm('确认', '继续？'));
        values.push(await ctx.ui.input('输入', '中文'));
        values.push(await ctx.ui.editor('编辑', 'draft'));
        ctx.ui.notify(JSON.stringify(values), 'info');
      }});
    }`
    );
    const observed: string[] = [];
    service.on('event', (event) => {
      if (event.kind !== 'record' || event.record.type !== 'extension_ui_request') return;
      const { method, id: dialogId } = event.record;
      if (!['select', 'confirm', 'input', 'editor'].includes(String(method))) return;
      observed.push(String(method));
      service.respond(id, {
        id: dialogId,
        ...(method === 'confirm' ? { confirmed: true } : { value: method === 'select' ? 'two' : '中文答复' }),
      });
    });
    const commands = await service.command(id, { type: 'get_commands' });
    expect(JSON.stringify(commands)).toContain('questions');
    await service.send(id, '/questions', [], 'steer');
    expect(observed).toEqual(['select', 'confirm', 'input', 'editor']);
    expect((await service.open(id)).view.dialogs).toHaveLength(0);
    expect((await service.open(id)).view.statuses.notification).toContain('中文答复');
  }, 60000);
});

describe('Conversations without a selected folder', () => {
  it('keeps separate persistent working folders and restores messages', async () => {
    const { service, paths } = await setup();
    const a = await service.create();
    const b = await service.create();
    expect(a.conversation.cwd).not.toBe(b.conversation.cwd);
    expect(a.view.model).toEqual({ provider: 'aionpi-fixture', id: 'fixture' });
    const done = settled(service, a.conversation.id);
    await service.send(a.conversation.id, 'Hello', [], 'steer');
    await done;
    await service.dispose();
    const restored = new PiService(paths, testSecretCodec);
    cleanup.push(() => restored.dispose());
    await restored.init();
    const snapshot = await restored.open(a.conversation.id);
    expect(snapshot.conversation.managedFolder).toBe(true);
    expect(snapshot.view.messages.some((m) => m.role === 'assistant')).toBe(true);
  });
  it('does not silently replace an explicitly missing folder', async () => {
    const { service, paths } = await setup(false);
    await expect(service.create(join(paths.data, 'missing-folder'))).rejects.toThrow();
  });
});
