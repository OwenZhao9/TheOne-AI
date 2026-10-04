import type { JsonRecord, PiBlock, PiDialog, PiMessage, PiModel, PiView } from './types';

export const recordOf = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
export const emptyView = (): PiView => ({
  messages: [],
  streaming: false,
  compacting: false,
  queue: { steering: [], followUp: [] },
  dialogs: [],
  statuses: {},
  widgets: {},
});

export function normalizeMessage(value: unknown, id: string, entryId?: string): PiMessage {
  const m = recordOf(value);
  return {
    id,
    entryId,
    role: textOf(m.role),
    content:
      typeof m.content === 'string'
        ? [{ type: 'text', text: m.content }]
        : Array.isArray(m.content)
          ? (m.content as PiBlock[])
          : [],
    timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined,
    toolCallId: textOf(m.toolCallId) || undefined,
    toolName: textOf(m.toolName) || undefined,
    isError: m.isError === true,
    stopReason: textOf(m.stopReason),
    errorMessage: textOf(m.errorMessage),
  };
}

/** Only the current leaf's ancestors belong to the visible conversation. */
export function messagesFromEntries(entries: unknown[], leafId?: string): PiMessage[] {
  const records = entries.map(recordOf);
  const byId = new Map(records.map((e) => [textOf(e.id), e]));
  let branch = records;
  if (leafId) {
    branch = [];
    const seen = new Set<string>();
    let current = byId.get(leafId);
    while (current && !seen.has(textOf(current.id))) {
      seen.add(textOf(current.id));
      branch.unshift(current);
      current = byId.get(textOf(current.parentId));
    }
  }
  return branch
    .filter((e) => e.type === 'message' || (e.type === 'custom_message' && e.display === true))
    .map((e) =>
      normalizeMessage(
        e.type === 'message'
          ? e.message
          : { role: 'custom', content: e.content, timestamp: Date.parse(textOf(e.timestamp)) },
        textOf(e.id),
        textOf(e.id)
      )
    );
}

/** Shared by the desktop host and renderer, including replay of recorded events. */
export function reducePi(view: PiView, event: JsonRecord): PiView {
  const type = event.type;
  if (type === 'agent_start') return { ...view, streaming: true, error: undefined };
  if (type === 'agent_settled') return { ...view, streaming: false, compacting: false, syncing: true };
  if (type === 'desktop_synchronized') return { ...view, syncing: false };
  if (type === 'compaction_start') return { ...view, compacting: true };
  if (type === 'compaction_end') return { ...view, compacting: false };
  if (type === 'desktop_error')
    return { ...view, error: textOf(event.message), streaming: false, compacting: false, syncing: false };
  if (type === 'desktop_history')
    return {
      ...view,
      messages: messagesFromEntries(Array.isArray(event.entries) ? event.entries : [], textOf(event.leafId)),
    };
  if (type === 'desktop_dialog_answered') return { ...view, dialogs: view.dialogs.filter((d) => d.id !== event.id) };
  if (type === 'extension_ui_request') {
    const method = textOf(event.method);
    if (['select', 'confirm', 'input', 'editor'].includes(method)) {
      const dialog = { ...event, id: textOf(event.id), method } as PiDialog;
      return { ...view, dialogs: [...view.dialogs.filter((d) => d.id !== dialog.id), dialog] };
    }
    if (method === 'setStatus')
      return { ...view, statuses: { ...view.statuses, [textOf(event.statusKey)]: textOf(event.statusText) } };
    if (method === 'setWidget')
      return {
        ...view,
        widgets: {
          ...view.widgets,
          [textOf(event.widgetKey)]: Array.isArray(event.widgetLines) ? (event.widgetLines as string[]) : [],
        },
      };
    if (method === 'notify') return { ...view, statuses: { ...view.statuses, notification: textOf(event.message) } };
  }
  if (type === 'queue_update')
    return {
      ...view,
      queue: {
        steering: Array.isArray(event.steering) ? (event.steering as string[]) : [],
        followUp: Array.isArray(event.followUp) ? (event.followUp as string[]) : [],
      },
    };
  if (type === 'thinking_level_changed') return { ...view, thinkingLevel: textOf(event.level) };
  if (type === 'response' && event.success) {
    const data = recordOf(event.data);
    if (event.command === 'get_state')
      return {
        ...view,
        model: recordOf(data.model).id === 'unknown' ? undefined : (data.model as PiModel | undefined),
        thinkingLevel: textOf(data.thinkingLevel),
        streaming: view.streaming || data.isStreaming === true,
        compacting: data.isCompacting === true,
      };
    if (event.command === 'get_session_stats') return { ...view, stats: data };
    if (event.command === 'set_model') return { ...view, model: data as PiModel };
    if (event.command === 'clear_queue') return { ...view, queue: { steering: [], followUp: [] } };
  }
  if (type === 'message_start' || type === 'message_update' || type === 'message_end') {
    const m = recordOf(event.message);
    if (!m.role) return view;
    const messages = [...view.messages];
    // Tool execution events arrive before Pi persists the same tool result.
    // Replace that provisional row rather than displaying the result twice.
    if (m.role === 'toolResult' && m.toolCallId) {
      const toolIndex = messages.findIndex((item) => item.toolCallId === m.toolCallId);
      if (toolIndex >= 0) {
        messages[toolIndex] = normalizeMessage(m, messages[toolIndex].id);
        return { ...view, messages };
      }
    }
    const last = messages.at(-1);
    const continuing =
      type !== 'message_start' &&
      last &&
      !last.entryId &&
      last.role === m.role &&
      last.toolCallId === (textOf(m.toolCallId) || undefined);
    const id = continuing ? last.id : `live-${messages.length}-${textOf(m.role)}`;
    const normalized = normalizeMessage(m, id);
    if (continuing) messages[messages.length - 1] = normalized;
    else messages.push(normalized);
    return { ...view, messages, error: normalized.errorMessage || view.error };
  }
  if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
    const id = `tool-${textOf(event.toolCallId)}`;
    const result = recordOf(event.result ?? event.partialResult);
    const message = normalizeMessage(
      {
        role: 'toolResult',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        isError: event.isError,
        content: result.content ?? [
          { type: 'text', text: type === 'tool_execution_start' ? JSON.stringify(event.args, null, 2) : '' },
        ],
      },
      id
    );
    const messages = [...view.messages];
    const index = messages.findIndex((m) => m.id === id);
    if (index >= 0) messages[index] = message;
    else messages.push(message);
    return { ...view, messages };
  }
  return view;
}
