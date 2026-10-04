import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '@/process/services/pi/SessionStore';
import { piPaths } from '@/process/services/pi/paths';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'aionpi-store-test-'));
  roots.push(root);
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const paths = piPaths(join(root, 'data'), join(root, 'unused-runtime'));
  const store = new SessionStore(paths);
  await store.load();
  return { store, paths, cwd };
}
describe('session metadata and Pi transcripts', () => {
  it('keeps an unsent conversation, title and pin after restart', async () => {
    const { store, paths, cwd } = await setup();
    const draft = await store.create(cwd);
    draft.conversation.title = '未发送的中文对话';
    await store.saveDrafts();
    await store.pin(draft.conversation.id, true);
    const reopened = new SessionStore(paths);
    await reopened.load();
    expect(reopened.list()).toEqual([draft.conversation]);
  });
  it('removes a draft even if Pi assigned a filename without writing it', async () => {
    const { store, paths, cwd } = await setup();
    const draft = await store.create(cwd);
    let trashed = false;
    store.bind(draft.conversation.id, join(paths.sessions, 'not-created.jsonl'));
    await store.remove(draft.conversation.id, async () => {
      trashed = true;
    });
    expect(trashed).toBe(false);
    const reopened = new SessionStore(paths);
    await reopened.load();
    expect(reopened.list()).toEqual([]);
  });
  it('replaces draft metadata with the real transcript and ignores a partial final record', async () => {
    const { store, paths, cwd } = await setup();
    const draft = await store.create(cwd);
    const id = draft.conversation.id;
    const entries = [
      { type: 'session', id, cwd },
      { type: 'message', id: 'm1', parentId: null, message: { role: 'user', content: '你好' } },
    ];
    await writeFile(
      join(paths.sessions, 'saved.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n{"partial'
    );
    await store.refresh();
    await store.saveDrafts();
    const reopened = new SessionStore(paths);
    await reopened.load();
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.get(id).view.messages[0].entryId).toBe('m1');
    expect(reopened.get(id).conversation.title).toBe('你好');
  });

  it('restores the conversation learning profile after reopening the store', async () => {
    const { store, paths, cwd } = await setup();
    const draft = await store.create(cwd);
    const profile = {
      level: 'expert' as const,
      customDescription: '',
      source: 'manual' as const,
      updatedAt: 123,
    };
    await store.setLearning(draft.conversation.id, profile);
    const reopened = new SessionStore(paths);
    await reopened.load();
    expect(reopened.get(draft.conversation.id).conversation.learning).toEqual(profile);
  });

  it('does not apply a setting when persistence fails and permits retry', async () => {
    const { store, paths, cwd } = await setup();
    const { conversation } = await store.create(cwd);
    const before = conversation.learning;
    await mkdir(join(paths.data, 'learning.json'));
    await expect(store.setLearning(conversation.id, { ...before, level: 'expert' })).rejects.toThrow();
    expect(store.get(conversation.id).conversation.learning).toEqual(before);
    await rm(join(paths.data, 'learning.json'), { recursive: true });
    await store.setLearning(conversation.id, { ...before, level: 'expert' });
    expect(JSON.parse(await readFile(join(paths.data, 'learning.json'), 'utf8'))[conversation.id].level).toBe('expert');
  });

  it('keeps profiles separate after transcripts replace drafts and removes only deleted profiles', async () => {
    const { store, paths, cwd } = await setup();
    const a = (await store.create(cwd)).conversation;
    const b = (await store.create(cwd)).conversation;
    await Promise.all([
      store.setLearning(a.id, { ...a.learning, level: 'beginner' }),
      store.setLearning(b.id, { ...b.learning, level: 'expert' }),
    ]);
    await writeFile(join(paths.sessions, 'a.jsonl'), JSON.stringify({ type: 'session', id: a.id, cwd }) + '\n');
    await store.refresh();
    await store.saveDrafts();
    const reopened = new SessionStore(paths);
    await reopened.load();
    expect(reopened.get(a.id).conversation.learning?.level).toBe('beginner');
    expect(reopened.get(b.id).conversation.learning?.level).toBe('expert');
    await reopened.remove(a.id, (file) => rm(file));
    expect(Object.keys(JSON.parse(await readFile(join(paths.data, 'learning.json'), 'utf8')))).toEqual([b.id]);
  });

  it('rejects a stale task mutation instead of overwriting a newer revision', async () => {
    const { store, paths, cwd } = await setup();
    const session = await store.create(cwd);
    const node = {
      sessionId: session.conversation.id,
      rootSessionId: session.conversation.id,
      title: 'root',
      objective: 'objective',
      reason: 'reason',
      deliverables: ['delivery'],
      acceptanceCriteria: ['check'],
      ownedPaths: ['src'],
      dependencies: [],
      candidateSkills: [],
      status: 'waiting' as const,
      acceptance: { status: 'pending' as const },
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: false },
      depth: 0,
      revision: 1,
      contextVersion: 'v1',
      dependencyRevisions: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await store.upsertTask(node);
    const first = store.updateTaskIfRevision(node.sessionId, 1, { status: 'running' });
    const stale = store.updateTaskIfRevision(node.sessionId, 1, { status: 'failed' });
    expect(await first).toBe(true);
    expect(await stale).toBe(false);
    expect(store.taskNode(node.sessionId)?.status).toBe('running');
  });
});
