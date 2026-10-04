import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PiService } from '@/process/services/pi/PiService';
import { piPaths } from '@/process/services/pi/paths';
import type { PiEvent, PiTaskNode } from '@/common/pi';
import { testSecretCodec } from './secretCodec';
import { fixtureServer } from './fixtureServer';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
function task(id: string, root: string, parent?: string): PiTaskNode {
  return {
    sessionId: id,
    rootSessionId: root,
    parentSessionId: parent,
    title: 'test task',
    objective: 'TOOLS',
    reason: 'test',
    deliverables: ['hello.txt'],
    acceptanceCriteria: ['file says edited version'],
    ownedPaths: parent ? ['hello.txt'] : [],
    dependencies: [],
    candidateSkills: [],
    status: 'waiting',
    acceptance: { status: 'pending' },
    usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: true },
    depth: parent ? 1 : 0,
    revision: 1,
    contextVersion: 'v1',
    dependencyRevisions: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
function settled(service: PiService, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off('event', listener);
      reject(new Error('task_fixture_timeout'));
    }, 20000);
    const listener = (event: PiEvent): void => {
      if (event.kind === 'attention' && event.id === id && event.reason !== 'question') {
        clearTimeout(timer);
        service.off('event', listener);
        resolve();
      }
    };
    service.on('event', listener);
  });
}
async function setup(maxModelCalls = 24) {
  const root = await mkdtemp(join(tmpdir(), 'theone-task-transport-'));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const server = await fixtureServer();
  const paths = piPaths(join(root, 'data'), process.env.AIONPI_TEST_RUNTIME!);
  const service = new PiService(paths, testSecretCodec);
  cleanup.push(async () => {
    await service.dispose();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  await service.init();
  await service.settings.connection({
    provider: 'tree-fixture',
    apiKey: 'test-only',
    baseUrl: server.url,
    api: 'openai-completions',
    model: 'fixture',
  });
  const parent = (await service.create(cwd)).conversation.id;
  await service.store.upsertTask(task(parent, parent));
  const workspace = await service.taskWorkspaces.create(cwd);
  const child = (await service.create(workspace)).conversation.id;
  await service.store.upsertTask(task(child, parent, parent));
  await service.saveTaskLimits({ ...service.taskLimits(), maxModelCalls });
  return { service, server, parent, child, cwd, workspace, paths };
}
describe.skipIf(process.platform !== 'darwin')(
  'task tree through real Pi and a local model fixture (not live Jev acceptance)',
  () => {
    it('keeps research tool-free across restart and starts normal tools only after explicit approval', async () => {
      const { service, server, parent, child, cwd, workspace, paths } = await setup();
      const parentReady = settled(service, parent);
      await service.send(parent, 'TOOLS', [], 'steer', 'system');
      await parentReady;
      expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('edited version');
      await service.store.updateTask(child, {
        research: { state: 'researching', version: 1, queries: ['frontend example', 'frontend skill'], sources: [] },
      });
      await service.send(child, 'Prepare a proposal only.', [], 'steer', 'research');
      await expect
        .poll(() => service.store.taskNode(child)?.research?.state, { timeout: 20000 })
        .toBe('awaiting_approval');
      expect(server.requests[4].tools || []).toEqual([]);
      await expect(readFile(join(workspace, 'hello.txt'))).rejects.toThrow();
      await expect(service.send(child, 'TOOLS', [], 'steer')).rejects.toThrow('task_research_approval_required');
      await service.dispose();
      const reopened = new PiService(paths, testSecretCodec);
      cleanup.unshift(() => reopened.dispose());
      await reopened.init();
      expect(reopened.store.taskNode(child)?.research?.state).toBe('awaiting_approval');
      expect(server.requests).toHaveLength(5);
      const done = settled(reopened, child);
      await reopened.reviewTaskResearch(child, 1, true);
      await done;
      expect(await readFile(join(workspace, 'hello.txt'), 'utf8')).toBe('edited version');
      expect(reopened.store.taskNode(child)?.research?.state).toBe('approved');
    }, 60000);
    it('runs tools in an isolated child, records each model call, accepts files and restores nested transcripts', async () => {
      const { service, child, parent, cwd, workspace, paths } = await setup();
      const done = settled(service, child);
      await service.send(child, 'TOOLS', [], 'steer', 'system');
      await done;
      expect(await readFile(join(workspace, 'hello.txt'), 'utf8')).toBe('edited version');
      await expect(readFile(join(cwd, 'hello.txt'))).rejects.toThrow();
      expect(service.store.taskNode(child)?.usage.modelCalls).toBe(4);
      await service.verifyTask(child, true, 'Checked the three tool results and final file', parent);
      expect(await readFile(join(cwd, 'hello.txt'), 'utf8')).toBe('edited version');
      await service.dispose();
      const reopened = new PiService(paths, testSecretCodec);
      cleanup.unshift(() => reopened.dispose());
      await reopened.init();
      expect((await reopened.open(child)).view.messages.length).toBeGreaterThan(0);
      expect(reopened.store.taskNode(child)?.acceptance.status).toBe('verified');
    }, 60000);
    it('blocks the next provider request when repeated tool calls exhaust the shared model-call budget', async () => {
      const { service, server, child } = await setup(2);
      const done = settled(service, child);
      await service.send(child, 'TOOLS', [], 'steer', 'system');
      await done;
      expect(server.requests).toHaveLength(2);
      expect(service.store.taskNode(child)?.usage.modelCalls).toBe(2);
      expect(service.store.taskNode(child)?.error).toBe('task_model_call_budget_exceeded');
    }, 60000);
    it('stops a running child and requires confirmation for a persisted interrupted turn after restart', async () => {
      const { service, server, child, paths } = await setup();
      await service.send(child, 'WAIT', [], 'steer', 'system');
      await expect.poll(() => server.requests.length).toBe(1);
      await service.stopTask(child, true);
      expect(service.store.taskNode(child)?.stopRequested).toBe(true);
      await service.dispose();
      // A crash can leave the last durable record as running, with no final settlement.
      await service.store.updateTask(child, { status: 'running', stopRequested: false });
      const reopened = new PiService(paths, testSecretCodec);
      cleanup.unshift(() => reopened.dispose());
      await reopened.init();
      expect(reopened.store.taskNode(child)).toMatchObject({ status: 'waiting', resumeState: 'needs_confirmation' });
      await reopened.open(child);
      expect(server.requests).toHaveLength(1);
    }, 60000);
  }
);
