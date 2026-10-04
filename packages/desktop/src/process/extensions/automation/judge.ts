// Jev System One protocol adapted from mu's MIT-licensed @kyrn/judge package.
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

export type JevOption = { id: string; description: string };
export type JevChoice = {
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  model: string;
  latencyMs: number;
};
export type JevVerdict = 'yes' | 'no' | 'unsure';

type JevResponse = {
  model?: unknown;
  answers?: Record<string, Record<string, unknown>>;
};

async function responseBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function probabilities(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => finiteNumber(entry[1]) !== undefined
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function threeZone(probability: number, no = 0.2, yes = 0.8): JevVerdict {
  if (!(no < yes)) throw new RangeError('jev_thresholds_invalid');
  if (probability <= no) return 'no';
  if (probability >= yes) return 'yes';
  return 'unsure';
}

export function selectedChoice(result: JevChoice, minimumProbability = 0.6): string | undefined {
  if (!result.choice || ['none', 'other', 'unclear', 'unknown'].includes(result.choice)) return undefined;
  const probability = result.probabilities?.[result.choice];
  return probability === undefined || probability >= minimumProbability ? result.choice : undefined;
}

function safeOptions(options: JevOption[]): JevOption[] {
  const result = options
    .filter((option) => /^[a-z][a-z0-9_-]{0,63}$/i.test(option.id) && option.description.trim())
    .slice(0, 31);
  if (!result.some((option) => ['none', 'other', 'unclear', 'unknown'].includes(option.id)))
    result.push({
      id: 'unclear',
      description: 'The available evidence is insufficient or none of the options clearly fit.',
    });
  if (result.length < 2) throw new Error('jev_options_invalid');
  return result;
}

export async function askJevChoice(input: {
  apiKey: string;
  state: string;
  question: string;
  options: JevOption[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<JevChoice> {
  if (!input.apiKey) throw new Error('jev_not_configured');
  const options = safeOptions(input.options);
  const started = Date.now();
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: input.state.slice(0, 50_000),
        questions: {
          decision: {
            type: 'choice',
            instructions: input.question.slice(0, 4_000),
            criteria: Object.fromEntries(options.map((option) => [option.id, option.description.slice(0, 4_000)])),
          },
        },
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('jev_unreachable', { cause: error });
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('jev_auth_failed');
    if (response.status === 429) throw new Error('jev_rate_limited');
    throw new Error(`jev_http_${response.status}`);
  }
  const body = (await responseBody(response)) as JevResponse | undefined;
  const answer = body?.answers?.decision;
  const choice = typeof answer?.choice === 'string' ? answer.choice : undefined;
  if (!choice || !options.some((option) => option.id === choice)) throw new Error('jev_invalid_response');
  return {
    choice,
    probabilities: probabilities(answer?.probabilities),
    confidence: finiteNumber(answer?.confidence),
    model: typeof body?.model === 'string' ? body.model : JEV_MODEL,
    latencyMs: Date.now() - started,
  };
}

export async function askJevBoolean(input: {
  apiKey: string;
  state: string;
  question: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ probability: number; verdict: JevVerdict; latencyMs: number }> {
  if (!input.apiKey) throw new Error('jev_not_configured');
  const started = Date.now();
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: input.state.slice(0, 50_000),
        questions: { decision: { type: 'noul', instructions: input.question.slice(0, 4_000) } },
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('jev_unreachable', { cause: error });
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('jev_auth_failed');
    if (response.status === 429) throw new Error('jev_rate_limited');
    throw new Error(`jev_http_${response.status}`);
  }
  const body = (await responseBody(response)) as JevResponse | undefined;
  const probability = finiteNumber(body?.answers?.decision?.noul);
  if (probability === undefined || probability < 0 || probability > 1) throw new Error('jev_invalid_response');
  return { probability, verdict: threeZone(probability), latencyMs: Date.now() - started };
}
