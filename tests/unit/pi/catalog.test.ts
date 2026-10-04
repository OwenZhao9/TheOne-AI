import { describe, expect, it, vi } from 'vitest';
import { buildCatalog } from '../../../scripts/aionpi/model-catalog.mjs';

function fixture(type: 'oauth' | 'api_key' | undefined = 'oauth', provider = 'openai') {
  const models = ['allowed', 'old', 'hidden', 'blocked'].map((id) => ({ id, provider, name: id, input: ['text'] }));
  return {
    listCredentials: vi.fn(async () => (type ? [{ providerId: provider, type }] : [])),
    getProviders: () => [
      { id: provider, auth: { oauth: {}, apiKey: {} } },
      { id: 'other', auth: {} },
    ],
    getModels: (id: string) => (id === provider ? models : [{ id: 'other-model', provider: 'other' }]),
    getAuth: vi.fn(async () => ({ auth: { apiKey: 'secret-not-for-renderer' } })),
  };
}
const response = (models: unknown[]) => new Response(JSON.stringify({ models }), { status: 200 });
const visible = (slug: string) => ({ slug, display_name: slug, visibility: 'list', supported_in_api: true });

describe('ChatGPT account model catalog', () => {
  it('keeps only listed account models supported by Pi, without remote instructions or credentials', async () => {
    const fetchModels = vi.fn(async () =>
      response([
        { ...visible('allowed'), model_messages: { instructions_template: 'untrusted' } },
        visible('allowed'),
        { ...visible('hidden'), visibility: 'hide' },
        { ...visible('blocked'), supported_in_api: false },
        visible('unknown-new-model'),
        null,
      ])
    );
    const result = await buildCatalog(fixture(), { fetchModels });
    expect(result.models.filter((m) => m.provider === 'openai').map((m) => m.id)).toEqual(['allowed']);
    expect(JSON.stringify(result)).not.toMatch(/untrusted|secret-not-for-renderer/);
    expect(fetchModels).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it.each([401, 403, 429, 500])('does not fall back to static models after HTTP %s', async (status) => {
    const result = await buildCatalog(fixture(), {
      fetchModels: async () => new Response('private service error', { status }),
    });
    expect(result.models.map((m) => m.id)).toEqual(['other-model']);
    expect(result.providers[0].modelError).toBe(
      status === 401 || status === 403 ? 'account_models_auth' : 'account_models_failed'
    );
    expect(JSON.stringify(result)).not.toContain('private service error');
  });

  it('does not substitute an API-key catalog for account permissions', async () => {
    const result = await buildCatalog(fixture(), { fetchModels: async () => new Response('{"data":[{"id":"old"}]}') });
    expect(result.providers[0].modelError).toBe('account_models_invalid');
    expect(result.models.filter((m) => m.provider === 'openai')).toEqual([]);
  });

  it('treats an empty list as no selectable models', async () => {
    const result = await buildCatalog(fixture(), { fetchModels: async () => response([]) });
    expect(result.models.filter((m) => m.provider === 'openai')).toEqual([]);
    expect(result.providers[0].modelError).toBeUndefined();
  });

  it('redacts network and token-refresh failures while preserving other providers', async () => {
    const runtime = fixture();
    runtime.getAuth.mockRejectedValue(new Error('secret-not-for-renderer'));
    const result = await buildCatalog(runtime);
    expect(result.providers[0].modelError).toBe('account_models_failed');
    expect(result.models.map((m) => m.id)).toEqual(['other-model']);
    expect(JSON.stringify(result)).not.toContain('secret-not-for-renderer');
  });

  it.each(['api_key', undefined] as const)('does not apply subscription filtering to %s credentials', async (type) => {
    const runtime = fixture(type);
    if (type === undefined) runtime.listCredentials.mockResolvedValue([]);
    const fetchModels = vi.fn();
    const result = await buildCatalog(runtime, { fetchModels });
    expect(result.models.filter((m) => m.provider === 'openai')).toHaveLength(4);
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it('refreshes after changing accounts and does not reuse the previous account list', async () => {
    const runtime = fixture();
    const fetchModels = vi
      .fn()
      .mockResolvedValueOnce(response([visible('allowed')]))
      .mockResolvedValueOnce(response([visible('old')]));
    expect((await buildCatalog(runtime, { fetchModels })).models[0].id).toBe('allowed');
    expect((await buildCatalog(runtime, { fetchModels })).models[0].id).toBe('old');
  });

  it('routes legacy OAuth through its official account endpoint', async () => {
    const runtime = fixture('oauth', 'openai-codex');
    const payload = Buffer.from(
      JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })
    ).toString('base64url');
    runtime.getAuth.mockResolvedValue({ auth: { apiKey: `header.${payload}.signature` } });
    const fetchModels = vi.fn(async () => response([visible('allowed')]));
    const result = await buildCatalog(runtime, { fetchModels });
    expect(result.models[0].id).toBe('allowed');
    expect(fetchModels.mock.calls[0][0]).toBe('https://chatgpt.com/backend-api/codex/models');
    expect(fetchModels.mock.calls[0][1].headers.get('chatgpt-account-id')).toBe('test-account');
  });

  it('aborts a stalled request without restoring the static list', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await buildCatalog(fixture(), {
      signal: controller.signal,
      fetchModels: async (_url, options) => {
        options.signal.throwIfAborted();
        return response([]);
      },
    });
    expect(result.providers[0].modelError).toBe('account_models_failed');
    expect(result.models.filter((m) => m.provider === 'openai')).toEqual([]);
  });
});

describe('catalog loading between conversations', () => {
  it('shares account loading across requests and refreshes after logout', async () => {
    const { SettingsService } = await import('@/process/services/pi/SettingsService');
    const service = new SettingsService({} as import('@/process/services/pi/paths').PiPaths, () => {});
    const data = { providers: [{ id: 'openai', configured: true }], models: [{ id: 'allowed', provider: 'openai' }] };
    const helper = vi
      .spyOn(
        service as unknown as { helper: (input: Record<string, unknown>) => Promise<Record<string, unknown>> },
        'helper'
      )
      .mockResolvedValue(data);
    await Promise.all([service.catalog(), service.catalog(), service.catalog()]);
    await service.catalog();
    expect(helper).toHaveBeenCalledTimes(1);
    await service.logout('openai');
    await service.catalog();
    expect(helper).toHaveBeenCalledTimes(3);
  });
  it('retries failed account lookups instead of caching them', async () => {
    const { SettingsService } = await import('@/process/services/pi/SettingsService');
    const service = new SettingsService({} as import('@/process/services/pi/paths').PiPaths, () => {});
    const helper = vi
      .spyOn(
        service as unknown as { helper: (input: Record<string, unknown>) => Promise<Record<string, unknown>> },
        'helper'
      )
      .mockRejectedValueOnce(new Error('network_failed'))
      .mockResolvedValue({ providers: [], models: [] });
    await expect(service.catalog()).rejects.toThrow('network_failed');
    await expect(service.catalog()).resolves.toMatchObject({ models: [] });
    expect(helper).toHaveBeenCalledTimes(2);
  });
});
