import { describe, expect, it, vi } from 'vitest';
import {
  actionSpace,
  pixelTarget,
  readObservation,
  type Element,
  type Observation,
} from '@/process/extensions/automation/fastComputerState';
import { decideFast, type DecisionInput } from '@/process/extensions/automation/fastComputerDecision';
import { fastComputerBusy, runFastComputer, type FastTask } from '@/process/extensions/automation/fastComputer';
import type { callCua } from '@/process/extensions/automation/cua';

const input: Element = {
  element_token: 's00000001:5',
  role: 'AXTextArea',
  label: '文件传输助手',
  value: '',
  frame: { x: 10, y: 10, w: 200, h: 100 },
};
const button: Element = {
  ...input,
  element_token: 's00000001:6',
  role: 'AXButton',
  label: '搜索',
  actions: ['AXPress'],
};
const observation: Observation = { pid: 12, window_id: 34, app: '微信', title: '微信', elements: [input, button] };
const resources = [
  { id: 'message', text: '测试文字', purpose: 'Only type into File Transfer Assistant; do not send.' },
];
const environment = { binary: '/test/cua-driver', apiKey: 'test-key', userRequest: '输入测试文字，不要发送' };
let serial = 0;
function task(overrides: Partial<FastTask> = {}): FastTask {
  return {
    pid: 12,
    window_id: 34,
    session: `test-${++serial}`,
    goal: 'Type the supplied message without sending.',
    resources,
    ...overrides,
  };
}
function raw(elements = [input, button]) {
  return {
    pid: 12,
    window_id: 34,
    window_title: '微信',
    app_name: '微信',
    elements,
    display: 'primary',
    screen_width: 300,
    screen_height: 300,
    screenshot_width: 600,
    screenshot_height: 600,
    capture_id: 'capture-test',
  };
}
function driver(states: ReturnType<typeof raw>[] = [raw()], effect = 'confirmed') {
  let index = 0;
  const actions: string[] = [];
  const call = vi.fn<typeof callCua>(async ({ action, args }) => {
    if (action === 'bring_to_front')
      return { text: 'activated', data: { pid: 12, window_id: 34, exact_window_effect: { verified: true } } };
    if (action === 'get_desktop_state') return { text: 'capture', data: raw() };
    if (action === 'click' && args.target) return { text: 'focus', data: { effect } };
    if (action === 'get_window_state')
      return {
        text: 'observed',
        data: states[Math.min(index, states.length - 1)],
        ...(args.include_screenshot ? { screenshot: 'png' } : {}),
      };
    actions.push(action);
    index++;
    return { text: 'action attempted', data: { effect } };
  });
  return { call, actions };
}
function pick(operation: 'click' | 'type_text' | 'press_key', id?: string) {
  return async ({ space }: DecisionInput) => ({
    operation,
    target: id ? space.targets[operation]?.[id] : Object.values(space.targets[operation] ?? {})[0],
    latencyMs: 2,
  });
}
function answer(criteria: Record<string, unknown>, selected = Object.keys(criteria)[0], confidence = 0.99) {
  return {
    choice: selected,
    confidence,
    probabilities: Object.fromEntries(Object.keys(criteria).map((key) => [key, key === selected ? 1 : 0])),
  };
}

describe('fast native candidate selection', () => {
  it('uses actual screenshot dimensions after downscaling instead of backing scale', () => {
    expect(
      pixelTarget({ ...raw(), screenshot_width: 450, screenshot_height: 450, screenshot_scale: 2 }, input)
    ).toMatchObject({ x: 165, y: 90 });
    expect(() => pixelTarget({ ...raw(), screenshot_width: 0 }, input)).toThrow('geometry_unavailable');
  });
  it('excludes off-window system search controls leaking into a window snapshot', () => {
    const window = { ...input, role: 'AXWindow', frame: { x: 0, y: 0, w: 300, h: 300 } };
    const hiddenSearch = { ...input, label: '_SC_SEARCH_FIELD', frame: { x: -1, y: 1000, w: 300, h: 26 } };
    expect(readObservation(raw([window, input, hiddenSearch]), 12, 34).elements.map((el) => el.label)).not.toContain(
      '_SC_SEARCH_FIELD'
    );
  });
  it('recognizes Chinese WeChat input without parsing translated role labels', () => {
    const state = readObservation(raw(), 12, 34);
    const space = actionSpace(state, resources, new Set(), '文件传输助手');
    expect(Object.values(space.targets.type_text)[0].element.label).toBe('文件传输助手');
    expect(space.targets.type_text.e1_message).toBeUndefined();
  });
  it('does not type over an existing draft or re-offer consumed resources', () => {
    const state = { ...observation, elements: [{ ...input, value: 'Existing draft' }] };
    expect(actionSpace(state, resources, new Set(), '').targets.type_text).toBeUndefined();
    expect(actionSpace(observation, resources, new Set(['message']), '').targets.type_text).toBeUndefined();
  });
  it('rejects snapshots belonging to another window', () => {
    expect(() => readObservation(raw(), 12, 999)).toThrow('observation_unavailable');
    expect(() => readObservation({ ...raw(), degraded_reason: 'ax_window_unresolved' }, 12, 34)).toThrow();
  });
  it('excludes password fields, disabled controls and virtual offscreen rows', () => {
    const data = raw([
      { ...input, role: 'AXSecureTextField' },
      { ...input, frame: { x: 1, y: 1, w: 10, h: 1 } },
    ]);
    data.elements.push({ ...button, enabled: false } as Element);
    expect(readObservation(data, 12, 34).elements).toEqual([]);
  });
  it('static history cannot crowd the editable control out of the candidate set', () => {
    const state = {
      ...observation,
      elements: [
        ...Array.from({ length: 500 }, (_, i) => ({ ...button, role: 'AXStaticText', label: `history${i}` })),
        input,
      ],
    };
    expect(Object.values(actionSpace(state, resources, new Set(), '').targets.type_text)).toHaveLength(1);
  });
});

describe('one-request Jev desktop decisions', () => {
  function request(fetchImpl: typeof fetch, activeGuard = false) {
    return decideFast({
      ...environment,
      observation,
      goal: 'Type message',
      space: actionSpace(observation, resources, new Set(), ''),
      history: [],
      fetchImpl,
      activeGuard,
    });
  }
  it('selects operation, compatible target and authorization in one network request', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.state.available_actions.type_text_e0_message).toContain('测试文字');
      return new Response(
        JSON.stringify({
          answers: {
            next_action: answer(payload.questions.next_action.criteria, 'type_text_e0_message'),
            authorized: { noul: 0.99 },
          },
        })
      );
    });
    const result = await request(fetchImpl, true);
    expect(result.target?.resource?.text).toBe('测试文字');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][1]?.body)).not.toContain('s00000001');
  });
  it('rejects an invented operation-target combination', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const p = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            next_action: answer(p.questions.next_action.criteria, 'type_text_e1_message'),
          },
        })
      );
    });
    await expect(request(fetchImpl)).rejects.toThrow('uncertain_choice');
  });
  it('preserves active-mode rejection without another network round trip', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ answers: { authorized: { noul: 0.3 } } }))
    );
    await expect(request(fetchImpl, true)).rejects.toThrow('computer_action_blocked_by_jev');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('does not retry an unavailable decision service or dispatch any action', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    await expect(request(fetchImpl)).rejects.toThrow('jev_http_503');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('rejects malformed probabilities even if confidence looks high', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ answers: { next_action: { choice: 'done', confidence: 1, probabilities: { done: 1 } } } })
        )
    );
    await expect(request(fetchImpl)).rejects.toThrow('invalid_probabilities');
  });
});

describe('bounded desktop loop and visual handoff', () => {
  it('returns after read-back of a terminal draft without a second Jev request', async () => {
    const d = driver([raw(), raw([{ ...input, value: '测试文字' }])]);
    const decide = vi.fn(pick('type_text'));
    const result = await runFastComputer(
      task({ resources: resources.map((r) => ({ ...r, terminal: true })) }),
      environment,
      { ...d, decide }
    );
    expect(result.status).toBe('needs_verification');
    expect(decide).toHaveBeenCalledOnce();
    expect(d.actions).toEqual(['type_text']);
  });
  it('runs multiple steps internally, refreshes tokens, and returns a final screenshot', async () => {
    const second = raw([{ ...input, value: '测试文字', element_token: 's00000002:5' }, button]);
    const d = driver([raw(), second]);
    const decide = vi
      .fn()
      .mockImplementationOnce(pick('type_text'))
      .mockResolvedValueOnce({ operation: 'done', latencyMs: 1 });
    const result = await runFastComputer(task(), environment, { ...d, decide });
    expect(d.actions).toEqual(['type_text']);
    expect(result).toMatchObject({
      status: 'needs_verification',
      attemptedResources: ['message'],
      observation: { screenshot: 'png' },
    });
    expect(
      d.call.mock.calls.filter(([c]) => c.action === 'get_window_state').map(([c]) => c.args.include_screenshot)
    ).toEqual([false, false, false, true]);
  });
  it('uses a fresh element token for the next key and stops immediately after Return', async () => {
    const d = driver([raw(), raw([{ ...input, value: '测试文字', element_token: 's00000002:5' }]), raw()]);
    const decide = vi.fn().mockImplementationOnce(pick('type_text')).mockImplementationOnce(pick('press_key'));
    const result = await runFastComputer(
      task({
        resources: [...resources, { id: 'send', key: 'return', purpose: 'Send once to the requested recipient' }],
      }),
      environment,
      { ...d, decide }
    );
    expect(d.call.mock.calls.find(([c]) => c.action === 'press_key')?.[0].args.element_token).toBe('s00000002:5');
    expect(result.status).toBe('needs_verification');
    expect(decide).toHaveBeenCalledTimes(2);
  });
  it('does not automatically repeat a click on an unchanged interface', async () => {
    const d = driver();
    const result = await runFastComputer(task(), environment, { ...d, decide: pick('click') });
    expect(d.actions).toEqual(['click']);
    expect(result.reason).toContain('unchanged UI');
  });
  it('hands back to the visual path if typing cannot be read back', async () => {
    const d = driver();
    const result = await runFastComputer(task(), environment, { ...d, decide: pick('type_text') });
    expect(result.reason).toContain('read back');
    expect(d.actions).toEqual(['type_text']);
  });
  it('does not type if exact-window activation was not independently verified', async () => {
    const d = driver();
    const original = d.call.getMockImplementation()!;
    d.call.mockImplementation(async (request) =>
      request.action === 'bring_to_front'
        ? { text: 'request accepted', data: { request_accepted: true } }
        : original(request)
    );
    const result = await runFastComputer(task(), environment, { ...d, decide: pick('type_text') });
    expect(result.reason).toContain('could not be activated');
    expect(result.attemptedResources).toEqual([]);
    expect(d.actions).toEqual([]);
  });
  it('never presses Return after text lands in another field', async () => {
    const d = driver([raw(), raw([input, { ...input, label: 'Wrong chat', value: '测试文字' }])]);
    const decide = vi.fn().mockImplementationOnce(pick('type_text')).mockImplementationOnce(pick('press_key'));
    const result = await runFastComputer(
      task({ resources: [...resources, { id: 'send', key: 'return', purpose: 'Send once' }] }),
      environment,
      { ...d, decide }
    );
    expect(result.reason).toContain('read back');
    expect(decide).toHaveBeenCalledOnce();
    expect(d.actions).toEqual(['type_text']);
  });
  it('uses capture-bound desktop pixels for focus, then inserts exact text', async () => {
    const d = driver();
    await runFastComputer(task(), environment, { ...d, decide: pick('type_text') });
    expect(d.call.mock.calls.find(([c]) => c.action === 'click')?.[0].args).toMatchObject({
      target: { kind: 'desktop', display_id: 'primary' },
      x: 220,
      y: 120,
      capture_id: 'capture-test',
    });
    const typed = d.call.mock.calls.find(([c]) => c.action === 'type_text')?.[0].args;
    expect(typed).toMatchObject({ target: { kind: 'desktop', display_id: 'primary' }, text: '测试文字' });
    expect(typed).not.toHaveProperty('element_token');
    expect(typed).not.toHaveProperty('capture_id');
  });
  it('marks a resource attempted before a timeout, and does not re-offer it on retry', async () => {
    const d = driver();
    const t = task();
    d.call.mockImplementation(async ({ action }) => {
      if (action === 'get_window_state') return { text: 'state', data: raw() };
      if (action === 'get_desktop_state') return { text: 'capture', data: raw() };
      if (action === 'bring_to_front')
        return { text: 'activated', data: { pid: 12, window_id: 34, exact_window_effect: { verified: true } } };
      if (action === 'click') return { text: 'focus', data: { effect: 'unverifiable' } };
      throw new Error('timeout after input');
    });
    const first = await runFastComputer(t, environment, { ...d, decide: pick('type_text') });
    const decide = vi.fn(async ({ space }: DecisionInput) => {
      expect(space.targets.type_text).toBeUndefined();
      return { operation: 'blocked' as const, latencyMs: 1 };
    });
    await runFastComputer(t, environment, { ...d, decide });
    expect(first.attemptedResources).toEqual(['message']);
    expect(d.call.mock.calls.filter(([c]) => c.action === 'type_text')).toHaveLength(1);
  });
  it('returns an explicit handoff for a driver refusal', async () => {
    const d = driver([raw()], 'refused');
    const result = await runFastComputer(task(), environment, { ...d, decide: pick('click') });
    expect(result.status).toBe('handoff');
    expect(result.reason).toContain('refused');
  });
  it('handles unavailable native controls without inventing coordinates', async () => {
    const d = driver([{ ...raw(), elements: [] }]);
    const result = await runFastComputer(task(), environment, {
      ...d,
      decide: async () => ({ operation: 'blocked', latencyMs: 1 }),
    });
    expect(d.actions).toEqual([]);
    expect(result.status).toBe('handoff');
  });
  it('does no work after cancellation and releases the application lock', async () => {
    const d = driver();
    const signal = AbortSignal.abort();
    const result = await runFastComputer(task(), { ...environment, signal }, d);
    expect(result.status).toBe('handoff');
    expect(d.call).not.toHaveBeenCalled();
    expect(fastComputerBusy(12)).toBe(false);
  });
  it('rejects arbitrary key commands, duplicate IDs, and absent authority', async () => {
    await expect(
      runFastComputer(task({ resources: [{ id: 'bad', key: 'cmd+delete', purpose: 'bad' }] }), environment)
    ).rejects.toThrow('invalid_resource');
    await expect(runFastComputer(task({ resources: [...resources, ...resources] }), environment)).rejects.toThrow(
      'invalid_resource'
    );
    await expect(runFastComputer(task(), { ...environment, userRequest: '' })).rejects.toThrow('user_request_missing');
  });
});
