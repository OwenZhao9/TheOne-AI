import { describe, expect, it, vi } from 'vitest';
import { researchTask, isWebsiteBuildRequest } from '@/process/services/pi/tasks/TaskResearch';
import { PiService } from '@/process/services/pi/PiService';
import type { PiTaskNode } from '@/common/pi';

function child(): PiTaskNode {
  return {
    sessionId: 'frontend',
    parentSessionId: 'root',
    rootSessionId: 'root',
    title: '前端',
    objective: '做一个网站',
    reason: 'independent',
    deliverables: ['website'],
    acceptanceCriteria: ['renders'],
    ownedPaths: ['src'],
    dependencies: [],
    candidateSkills: [],
    status: 'waiting',
    acceptance: { status: 'pending' },
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: true },
    depth: 1,
    revision: 1,
    contextVersion: 'v1',
    dependencyRevisions: {},
    createdAt: 1,
    updatedAt: 1,
    research: { state: 'awaiting_approval', version: 1, sources: [], queries: [], proposal: '先实现页面，再检查布局' },
  };
}
function harness(node = child()) {
  const schedule = vi.fn();
  const close = vi.fn(async () => undefined);
  const service = Object.assign(Object.create(PiService.prototype) as PiService, {
    live: new Map(),
    dispatchQueues: new Map(),
    store: {
      taskNode: () => node,
      updateTaskIfRevision: async (_id: string, revision: number, patch: Partial<PiTaskNode>) => {
        if (revision !== node.revision) return false;
        Object.assign(node, patch, { revision: node.revision + 1 });
        return true;
      },
    },
    writeTaskDocuments: vi.fn(async () => undefined),
    close,
    publish: vi.fn(),
    schedulePersistedRoot: schedule,
  });
  return { node, service, schedule, close };
}
describe('child pre-work research approval', () => {
  it('delegates explicit website building but not a tutorial or cancellation', () => {
    expect(isWebsiteBuildRequest('帮我制作一个网站')).toBe(true);
    expect(isWebsiteBuildRequest('不要做网站')).toBe(false);
    expect(isWebsiteBuildRequest('解释怎么做网站')).toBe(false);
  });
  it('blocks ordinary user and parent prompts before approval', async () => {
    const { service } = harness();
    await expect(service.send('frontend', '直接开工', [], 'steer')).rejects.toThrow('task_research_approval_required');
    await expect(service.send('frontend', '开始实现', [], 'followUp', 'system')).rejects.toThrow(
      'task_research_approval_required'
    );
    await expect(service.verifyTask('frontend', true, 'done')).rejects.toThrow('task_research_approval_required');
  });
  it('closes the restricted process and queues execution only after approval of the current proposal', async () => {
    const { node, service, schedule, close } = harness();
    await service.reviewTaskResearch('frontend', 1, true);
    expect(node.research).toMatchObject({ state: 'approved', version: 1 });
    expect(close).toHaveBeenCalledWith('frontend');
    expect(schedule).toHaveBeenCalledWith('root');
  });
  it('rejects stale and double approval instead of starting duplicate work', async () => {
    const { service, schedule } = harness();
    await expect(service.reviewTaskResearch('frontend', 0, true)).rejects.toThrow('task_research_stale');
    await service.reviewTaskResearch('frontend', 1, true);
    await expect(service.reviewTaskResearch('frontend', 1, true)).rejects.toThrow('task_research_stale');
    expect(schedule).toHaveBeenCalledTimes(1);
  });
  it('retains feedback and creates a new unapproved version when the user requests changes', async () => {
    const { node, service } = harness();
    await expect(service.reviewTaskResearch('frontend', 1, false, ' ')).rejects.toThrow(
      'task_research_feedback_required'
    );
    await service.reviewTaskResearch('frontend', 1, false, '换成简洁的布局');
    expect(node.research).toMatchObject({ state: 'queued', version: 2, feedback: '换成简洁的布局' });
    await expect(service.send('frontend', 'go', [], 'steer')).rejects.toThrow('task_research_approval_required');
  });
  it('never approves failed or stopped research', async () => {
    const n = child();
    n.research!.state = 'failed';
    const { service } = harness(n);
    await expect(service.reviewTaskResearch('frontend', 1, true)).rejects.toThrow('task_research_approval_required');
    n.research!.state = 'awaiting_approval';
    n.stopRequested = true;
    await expect(service.reviewTaskResearch('frontend', 1, true)).rejects.toThrow('task_research_approval_required');
  });
  it('fetches both examples and skill candidates without installing or trusting them', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/git/trees/')
        ? Response.json({ tree: [{ path: 'skills/frontend/SKILL.md', type: 'blob' }] })
        : Response.json({
            items: [
              {
                full_name: 'test/example',
                default_branch: 'main',
                html_url: 'https://github.com/test/example',
                description: 'Example',
                license: { spdx_id: 'MIT' },
              },
            ],
          })
    );
    const result = await researchTask(child(), { skills: [] }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.sources.map((s) => [s.kind, s.available])).toEqual([
      ['example', false],
      ['skill', false],
    ]);
    expect(result.sources[1].url).toBe('https://github.com/test/example/blob/main/skills/frontend/SKILL.md');
  });
  it('reports rate limits and oversized responses instead of inventing sources', async () => {
    await expect(
      researchTask(
        child(),
        { skills: [] },
        vi.fn(async () => new Response('', { status: 403 }))
      )
    ).rejects.toThrow('task_research_network_failed');
    await expect(
      researchTask(
        child(),
        { skills: [] },
        vi.fn(async () => new Response('x'.repeat(1024 * 1024 + 1)))
      )
    ).rejects.toThrow('task_research_response_too_large');
  });
});
