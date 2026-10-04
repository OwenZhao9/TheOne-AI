import { describe, expect, it, vi } from 'vitest';
import { PiService } from '@/process/services/pi/PiService';
import type { PiTaskNode } from '@/common/pi';

function node(overrides: Partial<PiTaskNode>): PiTaskNode {
  return {
    sessionId: 'node',
    rootSessionId: 'root',
    parentSessionId: 'root',
    title: 'node',
    objective: 'objective',
    reason: 'reason',
    deliverables: ['delivery'],
    acceptanceCriteria: ['check'],
    ownedPaths: ['src'],
    dependencies: [],
    candidateSkills: [],
    status: 'waiting',
    acceptance: { status: 'pending' },
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: false },
    depth: 1,
    revision: 1,
    contextVersion: 'v1',
    dependencyRevisions: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('task-tree dependency scheduler', () => {
  it('waits for direct-parent acceptance before starting a dependent child', async () => {
    const parent = node({
      sessionId: 'root',
      rootSessionId: 'root',
      parentSessionId: undefined,
      title: 'root',
      depth: 0,
    });
    const dependency = node({
      sessionId: 'dependency',
      title: 'dependency',
      status: 'completed',
      acceptance: { status: 'pending' },
    });
    const child = node({ sessionId: 'child', title: 'child', dependencies: ['dependency'] });
    const nodes = [parent, dependency, child];
    const store = {
      taskTree: () => ({
        version: 1 as const,
        limits: {
          maxDepth: 3,
          maxTotalTasks: 12,
          maxConcurrent: 2,
          maxModelCalls: 12,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
        },
        nodes,
      }),
      taskLimits: () => ({
        maxDepth: 3,
        maxTotalTasks: 12,
        maxConcurrent: 2,
        maxModelCalls: 12,
        maxInputTokens: 1000,
        maxOutputTokens: 1000,
      }),
      taskNode: (id: string) => nodes.find((item) => item.sessionId === id),
      updateTask: async (id: string, patch: Partial<PiTaskNode>) => {
        const current = nodes.find((item) => item.sessionId === id)!;
        Object.assign(current, patch, { revision: current.revision + 1 });
      },
      updateTaskIfRevision: async (id: string, revision: number, patch: Partial<PiTaskNode>) => {
        const current = nodes.find((item) => item.sessionId === id)!;
        if (current.revision !== revision) return false;
        Object.assign(current, patch, { revision: current.revision + 1 });
        return true;
      },
    };
    const service = Object.create(PiService.prototype) as any;
    service.store = store;
    service.budgetReservations = new Map();
    service.reportToParent = vi.fn(async () => {});
    service.writeTaskDocuments = vi.fn(async () => {});
    service.setTaskStatus = vi.fn(async (id: string, status: PiTaskNode['status']) => store.updateTask(id, { status }));
    service.runDelegatedTask = vi.fn(async (_parentId: string, childNode: PiTaskNode) =>
      store.updateTask(childNode.sessionId, { status: 'completed' })
    );

    await service.runTaskPlan('root', [{ node: child, task: child }], 1);
    expect(service.runDelegatedTask).not.toHaveBeenCalled();
    expect(child.status).toBe('waiting');

    dependency.acceptance = { status: 'verified', notes: 'Reviewed output', verifiedAt: Date.now() };
    dependency.revision++;
    await service.runTaskPlan('root', [{ node: child, task: child }], 1);
    expect(service.runDelegatedTask).toHaveBeenCalledTimes(1);
    expect(child.status).toBe('completed');
  });

  it('only lets the direct parent record evidence-backed acceptance', async () => {
    const parent = node({
      sessionId: 'parent',
      rootSessionId: 'parent',
      parentSessionId: undefined,
      title: 'parent',
      depth: 0,
    });
    const child = node({ sessionId: 'child', rootSessionId: 'parent', parentSessionId: 'parent', status: 'waiting' });
    const nodes = [parent, child];
    const service = Object.create(PiService.prototype) as any;
    service.live = new Map();
    service.taskWorkspaces = { integrate: vi.fn(async () => []) };
    service.store = {
      get: () => ({ conversation: { cwd: '/fixture' } }),
      taskNode: (id: string) => nodes.find((item) => item.sessionId === id),
      taskTree: () => ({
        version: 1 as const,
        limits: {
          maxDepth: 3,
          maxTotalTasks: 12,
          maxConcurrent: 2,
          maxModelCalls: 12,
          maxInputTokens: 1000,
          maxOutputTokens: 1000,
        },
        nodes,
      }),
      updateTask: async (id: string, patch: Partial<PiTaskNode>) =>
        Object.assign(nodes.find((item) => item.sessionId === id)!, patch),
    };
    service.invalidateDependents = vi.fn(async () => {});
    service.writeTaskDocuments = vi.fn(async () => {});
    service.reportToParent = vi.fn(async () => {});
    service.schedulePersistedRoot = vi.fn();
    service.publish = vi.fn();

    await expect(service.verifyTask('child', true, 'reviewed', 'not-the-parent')).rejects.toThrow(
      'task_verify_forbidden'
    );
    await expect(service.verifyTask('child', true, 'reviewed', 'parent')).rejects.toThrow('task_acceptance_not_ready');
    child.status = 'completed';
    await service.verifyTask('child', true, 'Reviewed the files and checks', 'parent');
    expect(child.acceptance.status).toBe('verified');
    expect(child.acceptance.notes).toContain('Reviewed the files');
  });
  it('delivers a later report after an earlier parent delivery failed', async () => {
    const child = node({ sessionId: 'child', parentSessionId: 'parent', status: 'completed' });
    const service = Object.create(PiService.prototype) as {
      reportQueues: Map<string, Promise<void>>;
      store: { taskNode(id: string): PiTaskNode; get(id: string): { conversation: { cwd: string } } };
      taskWorkspaces: { changes(path: string): Promise<unknown[]> };
      sendReportWhenReady: ReturnType<typeof vi.fn>;
      reportToParent(parent: string, node: PiTaskNode, result: string): Promise<void>;
    };
    service.reportQueues = new Map();
    service.store = { taskNode: () => child, get: () => ({ conversation: { cwd: '/test' } }) };
    service.taskWorkspaces = { changes: async () => [] };
    service.sendReportWhenReady = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await expect(service.reportToParent('parent', child, 'first result')).rejects.toThrow('offline');
    await service.reportToParent('parent', child, 'second result');
    expect(service.sendReportWhenReady).toHaveBeenLastCalledWith('parent', expect.stringContaining('second result'));
    expect(service.reportQueues.size).toBe(0);
  });
});
