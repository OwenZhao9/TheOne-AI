import React from 'react';
import Sidebar from '@/renderer/pages/PiDesktop/components/Sidebar';
import { act, cleanup, render, screen, renderHook, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyView, type PiTaskNode, type PiSnapshot } from '@/common/pi';
import { useConversation } from '@/renderer/pages/PiDesktop/useConversation';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
const snapshot = (id: string): PiSnapshot => ({
  conversation: { id, cwd: '/tmp', title: id, updatedAt: 0, messageCount: 0, running: false, pinned: false },
  view: emptyView(),
  seq: 0,
  phase: 'idle',
});
describe('conversation switching', () => {
  it('never exposes previous messages while the next conversation loads', async () => {
    const old = snapshot('a');
    old.view.messages.push({ id: 'hello', role: 'user', content: [{ type: 'text', text: '你好' }] });
    let finish!: (value: PiSnapshot) => void;
    invoke.mockImplementation((method, input) =>
      method === 'open'
        ? input.id === 'a'
          ? Promise.resolve(old)
          : new Promise((resolve) => {
              finish = resolve;
            })
        : Promise.resolve()
    );
    const renders: (string | undefined)[] = [];
    const { result, rerender } = renderHook(
      ({ id }) => {
        const state = useConversation(id);
        renders.push(state.snapshot?.conversation.id);
        return state;
      },
      { initialProps: { id: 'a' } }
    );
    await waitFor(() => expect(result.current.snapshot?.conversation.id).toBe('a'));
    renders.length = 0;
    rerender({ id: 'b' });
    expect(renders).not.toContain('a');
    await act(async () => finish(snapshot('b')));
    expect(result.current.snapshot?.view.messages).toEqual([]);
  });
  it('ignores late failures from a conversation that is no longer selected', async () => {
    let fail!: (reason: Error) => void;
    invoke.mockImplementation((method, input) =>
      method === 'open'
        ? input.id === 'a'
          ? new Promise((_resolve, reject) => {
              fail = reject;
            })
          : Promise.resolve(snapshot('b'))
        : Promise.resolve()
    );
    const { result, rerender } = renderHook(({ id }) => useConversation(id), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.snapshot?.conversation.id).toBe('b'));
    await act(async () => fail(new Error('old failure')));
    expect(result.current.error).toBe('');
  });
});

describe('history drafts', () => {
  it('keeps text and attachment drafts while ignoring empty abandoned chats', async () => {
    const { saveDraft, hasDraft } = await import('@/renderer/pages/PiDesktop/utils/drafts');
    saveDraft('empty', { text: '   ', attachments: [] });
    saveDraft('text', { text: '未发送的内容', attachments: [] });
    saveDraft('file', { text: '', attachments: [{ name: 'file.txt', path: '/tmp/file.txt' }] });
    expect(hasDraft('empty')).toBe(false);
    expect(hasDraft('text')).toBe(true);
    expect(hasDraft('file')).toBe(true);
  });
});

describe('empty conversations in history', () => {
  it('hides empty chats but keeps sent messages and unsent drafts', async () => {
    const { saveDraft } = await import('@/renderer/pages/PiDesktop/utils/drafts');
    const empty = { ...snapshot('empty-history').conversation, title: 'Unused chat' };
    const sent = { ...snapshot('sent-history').conversation, title: 'Sent chat', messageCount: 2 };
    render(
      <Sidebar
        taskTree={{
          version: 1,
          nodes: [],
          limits: {
            maxDepth: 3,
            maxTotalTasks: 12,
            maxConcurrent: 4,
            maxModelCalls: 24,
            maxInputTokens: 200000,
            maxOutputTokens: 100000,
          },
        }}
        conversations={[empty, sent]}
        unread={new Set()}
        select={vi.fn()}
        create={vi.fn()}
        settings={vi.fn()}
        refresh={vi.fn()}
        onError={vi.fn()}
        plaza={vi.fn()}
        plazaOpen={false}
      />
    );
    expect(screen.queryByText('Unused chat')).toBeNull();
    expect(screen.getByText('Sent chat')).toBeTruthy();
    act(() => saveDraft('empty-history', { text: 'Keep this draft', attachments: [] }));
    expect(screen.getByText('Unused chat')).toBeTruthy();
  });
});

describe('task hierarchy in the existing sidebar', () => {
  it('indents recursive tasks, collapses children and retains the Bot plaza', () => {
    const nodes: PiTaskNode[] = ['app', 'frontend', 'logo'].map((id, index) => ({
      sessionId: id,
      rootSessionId: 'app',
      parentSessionId: index ? ['app', 'frontend'][index - 1] : undefined,
      title: id,
      objective: id,
      reason: 'test',
      deliverables: [],
      acceptanceCriteria: [],
      ownedPaths: [],
      dependencies: [],
      candidateSkills: [],
      status: 'waiting',
      acceptance: { status: 'pending' },
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: true },
      depth: index,
      revision: 1,
      contextVersion: 'v1',
      dependencyRevisions: {},
      createdAt: 1,
      updatedAt: 1,
    }));
    localStorage.setItem('pi.taskTree.expanded', JSON.stringify(['app', 'frontend']));
    render(
      <Sidebar
        conversations={nodes.map((node) => snapshot(node.sessionId).conversation)}
        taskTree={{
          version: 1,
          nodes,
          limits: {
            maxDepth: 3,
            maxTotalTasks: 12,
            maxConcurrent: 4,
            maxModelCalls: 24,
            maxInputTokens: 200000,
            maxOutputTokens: 100000,
          },
        }}
        unread={new Set()}
        select={vi.fn()}
        create={vi.fn()}
        settings={vi.fn()}
        refresh={vi.fn()}
        onError={vi.fn()}
        plaza={vi.fn()}
        plazaOpen={false}
      />
    );
    expect(screen.getByTestId('pi-task-logo').style.paddingInlineStart).toBe('28px');
    fireEvent.click(screen.getByTestId('pi-task-frontend').querySelector('button')!);
    expect(screen.queryByTestId('pi-task-logo')).toBeNull();
    expect(screen.getByTestId('pi-bot-plaza')).toBeTruthy();
    localStorage.removeItem('pi.taskTree.expanded');
  });
});
