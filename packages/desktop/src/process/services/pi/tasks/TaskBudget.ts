import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { PiTaskLimits, PiTaskNode, PiTaskUsage } from '@/common/pi';

const empty = (): PiTaskUsage => ({ modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: true });
/** One desktop-owned ledger serializes reservations before provider requests across the whole task tree. */
export class TaskBudget {
  private server?: Server;
  private url = '';
  private tokens = new Map<string, string>();
  private ledger = new Map<string, PiTaskUsage>();
  private leases = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private nodes: () => PiTaskNode[],
    private limits: () => PiTaskLimits,
    private save: (id: string, usage: PiTaskUsage) => Promise<void>,
    private activate: (id: string, goal: string) => Promise<void>,
    private denied: (id: string, error: string) => Promise<void>
  ) {}

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      const token = request.headers.authorization?.replace(/^Bearer /, '') || '';
      const id = this.tokens.get(token);
      if (!id || request.method !== 'POST') {
        response.writeHead(403).end();
        return;
      }
      try {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 16384) throw new Error('task_budget_request_invalid');
          chunks.push(chunk as Buffer);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString()) as {
          action: string;
          goal?: string;
          lease?: string;
          usage?: Record<string, unknown>;
        };
        const result = await this.serial(async () =>
          input.action === 'activate'
            ? await this.activate(id, typeof input.goal === 'string' ? input.goal.slice(0, 20000) : '')
            : input.action === 'reserve'
              ? { lease: await this.reserve(id) }
              : input.action === 'usage'
                ? await this.charge(id, input.lease || '', input.usage)
                : Promise.reject(new Error('task_budget_request_invalid'))
        );
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result || { ok: true }));
      } catch (error) {
        await this.denied(id, error instanceof Error ? error.message : 'task_budget_unavailable').catch((): void => {});
        response
          .writeHead(409, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: error instanceof Error ? error.message : 'task_budget_unavailable' }));
      }
    });
    this.server.requestTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('task_budget_unavailable');
    this.url = `http://127.0.0.1:${address.port}`;
    this.server.unref();
  }
  environment(id: string): NodeJS.ProcessEnv {
    const token = randomUUID();
    this.tokens.set(token, id);
    return { THEONE_TASK_BUDGET_URL: this.url, THEONE_TASK_BUDGET_TOKEN: token };
  }
  private baseUsage(id: string): PiTaskUsage {
    return { ...(this.ledger.get(id) || this.nodes().find((node) => node.sessionId === id)?.usage || empty()) };
  }
  usage(id: string): PiTaskUsage {
    const usage = this.baseUsage(id);
    return { ...usage, costKnown: usage.costKnown && ![...this.leases.values()].includes(id) };
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.catch((): void => {}).then(fn);
    this.queue = next;
    return next;
  }
  private async reserve(id: string): Promise<string> {
    const nodes = this.nodes();
    const node = nodes.find((item) => item.sessionId === id);
    if (node?.stopRequested || node?.needsRevalidation) throw new Error('task_needs_review');
    if (node) {
      const usages = nodes
        .filter((item) => item.rootSessionId === node.rootSessionId)
        .map((item) => this.usage(item.sessionId));
      const limits = this.limits();
      if (usages.reduce((n, u) => n + u.modelCalls, 0) >= limits.maxModelCalls)
        throw new Error('task_model_call_budget_exceeded');
      if (usages.reduce((n, u) => n + u.inputTokens, 0) >= limits.maxInputTokens)
        throw new Error('task_input_token_budget_exceeded');
      if (usages.reduce((n, u) => n + u.outputTokens, 0) >= limits.maxOutputTokens)
        throw new Error('task_output_token_budget_exceeded');
      if (limits.maxCostUsd !== undefined) {
        if (usages.some((u) => u.modelCalls && !u.costKnown)) throw new Error('task_cost_unknown_requires_review');
        if (usages.reduce((n, u) => n + (u.costUsd || 0), 0) >= limits.maxCostUsd)
          throw new Error('task_cost_budget_exceeded');
      }
    }
    const usage = this.baseUsage(id);
    const lease = randomUUID();
    this.leases.set(lease, id);
    const updated = {
      ...usage,
      modelCalls: usage.modelCalls + 1,
      costKnown: usage.modelCalls === 0 || usage.costKnown,
    };
    this.ledger.set(id, updated);
    await this.save(id, this.usage(id));
    return lease;
  }
  private async charge(id: string, lease: string, raw?: Record<string, unknown>): Promise<{ ok: boolean }> {
    if (this.leases.get(lease) !== id) throw new Error('task_budget_lease_invalid');
    const number = (value: unknown): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
    const cost = raw?.cost && typeof raw.cost === 'object' ? (raw.cost as { total?: unknown }).total : undefined;
    const known = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0;
    const usage = this.baseUsage(id);
    const updated: PiTaskUsage = {
      modelCalls: usage.modelCalls,
      inputTokens: usage.inputTokens + number(raw?.input) + number(raw?.cacheRead) + number(raw?.cacheWrite),
      outputTokens: usage.outputTokens + number(raw?.output),
      ...(known || usage.costUsd !== undefined ? { costUsd: (usage.costUsd || 0) + number(cost) } : {}),
      costKnown: usage.costKnown && known,
    };
    this.ledger.set(id, updated);
    this.leases.delete(lease);
    await this.save(id, this.usage(id));
    return { ok: true };
  }
  async close(): Promise<void> {
    await this.queue.catch((): void => {});
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

export const BUDGET_EXTENSION_HELPERS = String.raw`
async function budget(action, details = {}) {
  const response = await fetch(process.env.THEONE_TASK_BUDGET_URL, {
    method: "POST", headers: { authorization: "Bearer " + process.env.THEONE_TASK_BUDGET_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ action, ...details }), signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "task_budget_unavailable");
  return value;
}
`;
export const BUDGET_EXTENSION_HOOKS = String.raw`
  let modelLease;
  pi.on("before_provider_request", async (_event, ctx) => {
    try { modelLease = (await budget("reserve")).lease; }
    catch (error) { ctx.ui.notify(String(error), "error"); ctx.abort(); throw error; }
  });
  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant" || !modelLease) return;
    const lease = modelLease; modelLease = undefined;
    try { await budget("usage", { lease, usage: event.message.usage }); }
    catch (error) { ctx.ui.notify(String(error), "error"); ctx.abort(); throw error; }
  });
`;
