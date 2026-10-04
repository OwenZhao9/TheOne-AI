// Credentials and the full remote catalog remain in the helper process.
const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const summary = (model) => ({
  id: model.id,
  name: model.name,
  provider: model.provider,
  reasoning: model.reasoning,
  input: model.input,
  contextWindow: model.contextWindow,
});

async function accountModels(runtime, provider, signal, fetchModels) {
  const resolved = await runtime.getAuth(provider, { signal });
  if (!resolved?.auth.apiKey) throw new Error('account_models_auth');
  const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${resolved.auth.apiKey}` });
  let url = 'https://api.openai.com/v1/models';
  if (provider === 'openai-codex') {
    url = 'https://chatgpt.com/backend-api/codex/models';
    const payload = JSON.parse(Buffer.from(resolved.auth.apiKey.split('.')[1], 'base64url').toString('utf8'));
    const accountId = payload['https://api.openai.com/auth']?.chatgpt_account_id;
    if (typeof accountId !== 'string' || !accountId) throw new Error('account_models_auth');
    headers.set('chatgpt-account-id', accountId);
    headers.set('originator', 'pi');
  }
  const response = await fetchModels(url, { headers, signal, redirect: 'error' });
  if (response.status === 401 || response.status === 403) throw new Error('account_models_auth');
  if (!response.ok) throw new Error('account_models_failed');
  const body = record(await response.json());
  // An API-key model list (data[]) is not evidence of ChatGPT account access.
  if (!Array.isArray(body.models)) throw new Error('account_models_invalid');
  const local = new Map(runtime.getModels(provider).map((model) => [model.id, model]));
  const seen = new Set();
  return body.models.flatMap((value) => {
    const remote = record(value);
    const model = local.get(remote.slug);
    if (!model || seen.has(model.id) || remote.visibility !== 'list' || remote.supported_in_api === false) return [];
    seen.add(model.id);
    return [{ ...summary(model), name: typeof remote.display_name === 'string' ? remote.display_name : model.name }];
  });
}

/** Build selectable models using the current credential type, never a static subscription allowlist. */
export async function buildCatalog(runtime, { signal, fetchModels = fetch } = {}) {
  const credentials = await runtime.listCredentials();
  const entries = await Promise.all(
    runtime.getProviders().map(async (provider) => {
      const credential = credentials.find((entry) => entry.providerId === provider.id);
      const account = credential?.type === 'oauth' && ['openai', 'openai-codex'].includes(provider.id);
      const info = {
        id: provider.id,
        name: provider.name || provider.id,
        apiKey: !!provider.auth?.apiKey,
        oauth: !!provider.auth?.oauth,
        configured: !!credential,
        authType: credential?.type,
        modelSource: account ? 'account' : 'catalog',
      };
      if (!account) return { provider: info, models: runtime.getModels(provider.id).map(summary) };
      try {
        const timeout = AbortSignal.timeout(15000);
        const models = await accountModels(
          runtime,
          provider.id,
          signal ? AbortSignal.any([signal, timeout]) : timeout,
          fetchModels
        );
        return { provider: info, models };
      } catch (error) {
        // Never expose response bodies, tokens, or auth-library errors to the renderer/logs.
        const known = ['account_models_auth', 'account_models_invalid'];
        const modelError = known.includes(error?.message) ? error.message : 'account_models_failed';
        return { provider: { ...info, modelError }, models: [] };
      }
    })
  );
  return { providers: entries.map((entry) => entry.provider), models: entries.flatMap((entry) => entry.models) };
}
