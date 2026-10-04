// This helper runs under the bundled Node, using the unmodified Pi SDK.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { buildCatalog } from './model-catalog.mjs';

const { ModelRuntime, SettingsManager } = await import(
  pathToFileURL(join(import.meta.dirname, 'pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/index.js'))
);
const agent = process.env.PI_CODING_AGENT_DIR;
if (!agent) throw new Error('Missing agent directory');
await mkdir(agent, { recursive: true, mode: 0o700 });
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const waiting = new Map();
let counter = 0;
let active;
const decoder = new StringDecoder('utf8');
let buffer = '';
async function runtime() {
  return ModelRuntime.create({
    authPath: join(agent, 'auth.json'),
    modelsPath: join(agent, 'models.json'),
    refreshOnCreate: false,
  });
}
async function run(input) {
  active = new AbortController();
  const r = await runtime();
  if (input.method === 'catalog') {
    emit({
      type: 'result',
      data: await buildCatalog(r, { signal: active.signal }),
    });
  } else if (input.method === 'login') {
    // ChatGPT's current flow needs a stable, app-owned installation identity.
    // Persist it before publishing a URL: cancel/quit must not change the next login's identity.
    let loginOptions;
    if (input.provider === 'openai' && input.authType === 'oauth') {
      const settings = SettingsManager.create(agent, agent, { projectTrusted: false });
      if (settings.drainErrors().length) throw new Error('settings_read_failed');
      const deviceId = settings.getOrCreateDeviceId();
      await settings.flush();
      if (settings.drainErrors().length) throw new Error('settings_write_failed');
      loginOptions = { getDeviceId: () => deviceId };
    }
    await r.login(
      input.provider,
      input.authType,
      {
        signal: active.signal,
        prompt: (prompt) =>
          new Promise((resolve, reject) => {
            const id = `auth-${++counter}`;
            const { signal, ...display } = prompt;
            const cancel = () => {
              waiting.delete(id);
              emit({ type: 'prompt_closed', id });
              reject(new Error('login_cancelled'));
            };
            waiting.set(id, {
              resolve: (value) => {
                signal?.removeEventListener('abort', cancel);
                resolve(value);
              },
              reject,
            });
            if (signal?.aborted) return cancel();
            signal?.addEventListener('abort', cancel, { once: true });
            emit({ type: 'prompt', id, prompt: display });
          }),
        notify: (event) => emit({ type: 'auth_event', event }),
      },
      loginOptions
    );
    emit({ type: 'result', data: {} });
  } else if (input.method === 'logout') {
    await r.logout(input.provider);
    emit({ type: 'result', data: {} });
  } else if (input.method === 'save') {
    if (input.apiKey !== undefined && input.apiKey !== '') {
      if (/[^\x21-\x7e]/.test(input.apiKey)) throw new Error('invalid_key_characters');
    }
    if (input.baseUrl) {
      const url = new URL(input.baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('invalid_service_url');
      if (!['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(input.api))
        throw new Error('invalid_service_protocol');
      let config = {};
      try {
        config = JSON.parse(await readFile(join(agent, 'models.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      config.providers ??= {};
      const existing = config.providers[input.provider] || {};
      const models = [...(existing.models || [])];
      if (input.model) {
        const definition = { id: input.model, input: input.imageInput ? ['text', 'image'] : ['text'] };
        const index = models.findIndex((m) => m.id === input.model);
        if (index < 0) models.push(definition);
        else models[index] = { ...models[index], ...definition };
      }
      config.providers[input.provider] = {
        ...existing,
        baseUrl: input.baseUrl,
        api: input.api,
        ...(models.length ? { models } : {}),
      };
      await writeFile(join(agent, 'models.json.tmp'), JSON.stringify(config, null, 2), { mode: 0o600 });
      const { rename } = await import('node:fs/promises');
      await rename(join(agent, 'models.json.tmp'), join(agent, 'models.json'));
    }
    if (input.apiKey !== undefined && input.apiKey !== '') {
      const updated = await runtime();
      await updated.login(input.provider, 'api_key', {
        prompt: async (prompt) => {
          if (prompt.type === 'secret') return input.apiKey;
          throw new Error('provider_requires_guided_login');
        },
        notify: () => {},
      });
    }
    emit({ type: 'result', data: {} });
  } else throw new Error('unknown_auth_method');
}
process.stdin.on('data', (chunk) => {
  buffer += decoder.write(chunk);
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const input = JSON.parse(line);
    if (input.method === 'answer') {
      const pending = waiting.get(input.id);
      waiting.delete(input.id);
      if (input.cancelled) pending?.reject(new Error('login_cancelled'));
      else pending?.resolve(String(input.value ?? ''));
    } else if (input.method === 'cancel') active?.abort();
    else
      void run(input).catch((error) =>
        emit({
          type: 'failure',
          message: active?.signal.aborted
            ? 'login_cancelled'
            : String(error.message).replace(/\b(sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[redacted]'),
        })
      );
  }
});
process.stdin.on('end', () => {
  active?.abort();
  process.exit(0);
});
