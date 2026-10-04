import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SettingsService } from '@/process/services/pi/SettingsService';
import { piPaths } from '@/process/services/pi/paths';
import { recordOf, type JsonRecord } from '@/common/pi';

const cleanup: (() => Promise<void>)[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-auth-test-'));
  const paths = piPaths(root, resolve(process.env.AIONPI_TEST_RUNTIME || 'resources/aionpi-runtime'));
  let onEvent: ((event: JsonRecord) => void) | undefined;
  const settings = new SettingsService(paths, (event) => onEvent?.(event));
  cleanup.push(async () => {
    settings.dispose();
    await rm(root, { recursive: true, force: true });
  });
  async function start(provider = 'openai') {
    let received!: (value: URL) => void;
    const url = new Promise<URL>((receive) => {
      received = receive;
    });
    onEvent = (frame) => {
      const event = recordOf(frame.event);
      if (frame.type === 'auth_event' && event.type === 'auth_url') received(new URL(String(event.url)));
      if (provider === 'openai-codex' && frame.type === 'prompt' && recordOf(frame.prompt).type === 'select')
        settings.respond({ id: frame.id, value: 'browser' });
    };
    const finished = settings.login(provider, 'oauth').then(
      () => '',
      (error: Error) => error.message
    );
    const authorization = await Promise.race([
      url,
      finished.then((error) => {
        throw new Error(error || 'Login completed before authorization');
      }),
    ]);
    return { authorization, finished };
  }
  return { paths, settings, start };
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dispose) => dispose()));
});

describe('ChatGPT login with the real bundled Pi (no account or model response simulated)', () => {
  it('persists an installation ID before opening authorization and reuses it after cancellation', async () => {
    const { paths, settings, start } = await setup();
    await writeFile(join(paths.agent, 'settings.json'), JSON.stringify({ retry: { enabled: false } }));
    const first = await start();
    const saved = JSON.parse(await readFile(join(paths.agent, 'settings.json'), 'utf8'));
    expect(saved).toMatchObject({ deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/), retry: { enabled: false } });
    expect(first.authorization.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${saved.deviceId}`);
    settings.cancel();
    await first.finished;
    const second = await start();
    expect(second.authorization.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${saved.deviceId}`);
    settings.cancel();
    await second.finished;
  }, 30000);

  it('does not create credentials or claim configuration when browser login is cancelled', async () => {
    const { paths, settings, start } = await setup();
    const { finished } = await start();
    settings.cancel();
    expect(await finished).toBe('login_cancelled');
    const credentials = await readFile(join(paths.agent, 'auth.json'), 'utf8').catch(() => '{}');
    expect(JSON.parse(credentials).openai).toBeUndefined();
    expect((await settings.catalog()).providers.find((provider) => provider.id === 'openai')?.configured).toBe(false);
  }, 30000);

  it('preserves unreadable settings and reports failure before starting authorization', async () => {
    const { paths, settings } = await setup();
    await writeFile(join(paths.agent, 'settings.json'), '{invalid');
    await expect(settings.login('openai', 'oauth')).rejects.toThrow('settings_read_failed');
    expect(await readFile(join(paths.agent, 'settings.json'), 'utf8')).toBe('{invalid');
  }, 30000);

  it('also supports the OpenAI Codex browser flow used by Mu', async () => {
    const { settings, start } = await setup();
    const { authorization, finished } = await start('openai-codex');
    expect(authorization.origin).toBe('https://auth.openai.com');
    expect(authorization.pathname).toBe('/oauth/authorize');
    settings.cancel();
    expect(await finished).toBe('login_cancelled');
  }, 30000);
});
