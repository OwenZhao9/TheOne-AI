import { describe, it, expect } from 'vitest';
import { JsonLines } from '@/process/services/pi/RpcHost';
import { emptyView, messagesFromEntries, reducePi, type JsonRecord } from '@/common/pi';

describe('Pi framing', () => {
  it('keeps Chinese UTF-8 and Unicode separators intact across chunks', () => {
    const parser = new JsonLines();
    const records: JsonRecord[] = [];
    const bytes = Buffer.from(JSON.stringify({ text: '你好\u2028世界\u2029' }) + '\r\n');
    for (const byte of bytes) parser.push(Buffer.from([byte]), (record) => records.push(record));
    expect(records).toEqual([{ text: '你好\u2028世界\u2029' }]);
  });
  it('rejects invalid records instead of silently losing responses', () => {
    expect(() => new JsonLines().push(Buffer.from('broken\n'), () => {})).toThrow();
  });
});

describe('Pi view', () => {
  it('waits for settled rather than agent_end before ending the run', () => {
    let view = reducePi(emptyView(), { type: 'agent_start' });
    view = reducePi(view, { type: 'agent_end' });
    expect(view.streaming).toBe(true);
    view = reducePi(view, { type: 'response', command: 'get_state', success: true, data: { isStreaming: false } });
    expect(view.streaming).toBe(true);
    expect(reducePi(view, { type: 'agent_settled' }).streaming).toBe(false);
    expect(reducePi(view, { type: 'agent_settled' }).syncing).toBe(true);
  });
  it('replaces growing messages without duplicating chunks', () => {
    let view = reducePi(emptyView(), { type: 'message_start', message: { role: 'assistant', content: [] } });
    view = reducePi(view, {
      type: 'message_update',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
    });
    view = reducePi(view, {
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
    });
    expect(view.messages).toHaveLength(1);
    expect(view.messages[0].content[0].text).toBe('Hello!');
  });
  it('restores only ancestors of the current branch and their persisted identifiers', () => {
    const entries = [
      { type: 'message', id: 'a', parentId: null, message: { role: 'user', content: 'one' } },
      { type: 'message', id: 'b', parentId: 'a', message: { role: 'assistant', content: 'discarded branch' } },
      { type: 'message', id: 'c', parentId: 'a', message: { role: 'assistant', content: 'current branch' } },
    ];
    expect(messagesFromEntries(entries, 'c').map((m) => m.entryId)).toEqual(['a', 'c']);
  });
  it('retains partial messages when a run fails', () => {
    let view = reducePi(emptyView(), { type: 'message_start', message: { role: 'assistant', content: 'partial' } });
    view = reducePi(view, { type: 'desktop_error', message: 'network failed' });
    expect(view.messages[0].content[0].text).toBe('partial');
    expect(view.error).toBe('network failed');
    expect(view.streaming).toBe(false);
  });
});
