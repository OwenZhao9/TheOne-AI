import { describe, expect, it } from 'vitest';
import { TaskBudget } from '@/process/services/pi/tasks/TaskBudget';
import type { PiTaskNode, PiTaskUsage } from '@/common/pi';

const node = (id: string): PiTaskNode => ({
  sessionId: id,
  rootSessionId: 'root',
  title: id,
  objective: id,
  reason: 'test',
  deliverables: [],
  acceptanceCriteria: [],
  ownedPaths: [],
  dependencies: [],
  candidateSkills: [],
  status: 'running',
  acceptance: { status: 'pending' },
  usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: true },
  depth: 1,
  revision: 1,
  contextVersion: 'v1',
  dependencyRevisions: {},
  createdAt: 1,
  updatedAt: 1,
});
describe('shared provider request budget', () => {
  it('serializes parallel parent, child and judge reservations and keeps the persisted usage on restart', async () => {
    const nodes = ['root', 'child', 'grandchild'].map(node);
    const limits = {
      maxDepth: 3,
      maxTotalTasks: 10,
      maxConcurrent: 4,
      maxModelCalls: 3,
      maxInputTokens: 1000,
      maxOutputTokens: 1000,
    };
    const save = async (id: string, usage: PiTaskUsage): Promise<void> => {
      nodes.find((n) => n.sessionId === id)!.usage = usage;
    };
    const service = new TaskBudget(
      () => nodes,
      () => limits,
      save,
      async () => {},
      async () => {}
    );
    await service.start();
    try {
      const envs = nodes.map((n) => service.environment(n.sessionId));
      const post = async (index: number, body: object): Promise<Response> =>
        fetch(envs[index].THEONE_TASK_BUDGET_URL!, {
          method: 'POST',
          headers: { authorization: `Bearer ${envs[index].THEONE_TASK_BUDGET_TOKEN}` },
          body: JSON.stringify(body),
        });
      const requests = await Promise.all([
        post(0, { action: 'reserve' }),
        post(1, { action: 'reserve' }),
        post(2, { action: 'reserve' }),
        post(0, { action: 'reserve' }),
      ]);
      expect(requests.filter((r) => r.ok)).toHaveLength(3);
      const { lease } = (await requests[0].json()) as { lease: string };
      await post(0, { action: 'usage', lease, usage: { input: 10, cacheRead: 20, output: 5, cost: { total: 0.1 } } });
      expect(service.usage('root')).toMatchObject({ modelCalls: 1, inputTokens: 30, outputTokens: 5, costUsd: 0.1 });
      const restarted = new TaskBudget(
        () => nodes,
        () => limits,
        save,
        async () => {},
        async () => {}
      );
      expect(restarted.usage('root')).toEqual(service.usage('root'));
    } finally {
      await service.close();
    }
  });
  it('does not invent a price when provider usage lacks cost', async () => {
    const nodes = [node('root')];
    const service = new TaskBudget(
      () => nodes,
      () => ({
        maxDepth: 3,
        maxTotalTasks: 10,
        maxConcurrent: 2,
        maxModelCalls: 10,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
        maxCostUsd: 1,
      }),
      async (_id, usage) => {
        nodes[0].usage = usage;
      },
      async () => {},
      async () => {}
    );
    await service.start();
    try {
      const env = service.environment('root');
      const post = async (body: object): Promise<Response> =>
        fetch(env.THEONE_TASK_BUDGET_URL!, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.THEONE_TASK_BUDGET_TOKEN}` },
          body: JSON.stringify(body),
        });
      const { lease } = (await (await post({ action: 'reserve' })).json()) as { lease: string };
      await post({ action: 'usage', lease, usage: { input: 2, output: 3 } });
      expect(service.usage('root').costKnown).toBe(false);
      expect(await (await post({ action: 'reserve' })).json()).toMatchObject({
        error: 'task_cost_unknown_requires_review',
      });
    } finally {
      await service.close();
    }
  });
});
