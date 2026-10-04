/* eslint-disable no-await-in-loop -- Each desktop action depends on the preceding observed state; parallel dispatch is unsafe. */
import { setTimeout as delay } from 'node:timers/promises';
import { callCua, type CuaResult } from './cua';
import { decideFast, type DecisionInput, type Decision } from './fastComputerDecision';
import {
  actionSpace,
  elementIdentity,
  observationIdentity,
  pixelTarget,
  readObservation,
  record,
  type Observation,
  type Resource,
} from './fastComputerState';

export type FastTask = {
  pid: number;
  window_id: number;
  session: string;
  goal: string;
  resources?: Resource[];
  maxSteps?: number;
  delivery_mode?: 'background' | 'foreground';
};
type Step = { operation: string; decisionMs: number; actionMs: number; observationMs: number; effect?: string };
export type FastResult = {
  status: 'needs_verification' | 'handoff';
  reason: string;
  steps: Step[];
  elapsedMs: number;
  observationMs: number;
  decisionMs: number;
  actionMs: number;
  observation?: CuaResult;
  attemptedResources: string[];
};
type Dependencies = {
  call?: typeof callCua;
  decide?: (input: DecisionInput) => Promise<Decision>;
  onStep?: (step: Step) => Promise<void>;
};
const busy = new Set<number>();
const attempted = new Map<string, Set<string>>();

export function fastComputerBusy(pid: unknown): boolean {
  return typeof pid === 'number' && busy.has(pid);
}

function validate(task: FastTask): void {
  if (
    !Number.isInteger(task.pid) ||
    task.pid <= 0 ||
    !Number.isInteger(task.window_id) ||
    task.window_id <= 0 ||
    !task.session ||
    task.session.length > 120 ||
    !task.goal.trim() ||
    task.goal.length > 4000
  )
    throw new Error('computer_fast_invalid_task');
  const ids = new Set<string>();
  for (const resource of task.resources ?? []) {
    if (
      !/^[a-z][a-z0-9_]{0,31}$/i.test(resource.id) ||
      ids.has(resource.id) ||
      !resource.purpose.trim() ||
      (resource.text === undefined) === (resource.key === undefined) ||
      (resource.text !== undefined && (!resource.text || resource.text.length > 4000)) ||
      (resource.key !== undefined && !['return', 'tab', 'escape', 'up', 'down', 'left', 'right'].includes(resource.key))
    )
      throw new Error('computer_fast_invalid_resource');
    ids.add(resource.id);
  }
  if (ids.size > 8) throw new Error('computer_fast_too_many_resources');
  if (task.maxSteps !== undefined && (!Number.isInteger(task.maxSteps) || task.maxSteps < 1 || task.maxSteps > 20))
    throw new Error('computer_fast_invalid_budget');
}

/** Run a bounded native desktop subtask without returning to the planner on each step. */
export async function runFastComputer(
  task: FastTask,
  environment: { binary: string; apiKey: string; userRequest: string; activeGuard?: boolean; signal?: AbortSignal },
  dependencies: Dependencies = {}
): Promise<FastResult> {
  validate(task);
  if (!environment.apiKey) throw new Error('jev_not_configured');
  if (!environment.userRequest.trim()) throw new Error('computer_fast_user_request_missing');
  if (busy.has(task.pid)) throw new Error('computer_fast_app_busy');
  const call = dependencies.call ?? callCua;
  const decide = dependencies.decide ?? decideFast;
  const budgetSignal = AbortSignal.timeout(90_000);
  const signal = environment.signal ? AbortSignal.any([environment.signal, budgetSignal]) : budgetSignal;
  const started = Date.now();
  const steps: Step[] = [];
  const history: string[] = [];
  let observationMs = 0;
  let decisionMs = 0;
  let actionMs = 0;
  const dispatch: typeof callCua = async (request) => {
    const dispatchStarted = Date.now();
    try {
      return await call(request);
    } finally {
      actionMs += Date.now() - dispatchStarted;
    }
  };
  let lastObservation: CuaResult | undefined;
  const memoryKey = `${task.pid}:${task.session}`;
  const used = attempted.get(memoryKey) ?? new Set<string>();
  attempted.set(memoryKey, used);
  // Bound memory, keeping recent sessions' non-idempotent actions across handoffs.
  if (attempted.size > 100) attempted.delete(attempted.keys().next().value!);
  const tried = new Set<string>();
  busy.add(task.pid);
  const observe = async (screenshot = false): Promise<Observation> => {
    signal.throwIfAborted();
    const t = Date.now();
    lastObservation = await call({
      binary: environment.binary,
      action: 'get_window_state',
      structured: true,
      signal,
      args: {
        pid: task.pid,
        window_id: task.window_id,
        session: task.session,
        include_screenshot: screenshot,
        timeout_ms: 1500,
      },
    });
    observationMs += Date.now() - t;
    return readObservation(lastObservation.data, task.pid, task.window_id);
  };
  const finish = async (status: FastResult['status'], reason: string): Promise<FastResult> => {
    if (!signal.aborted) {
      try {
        await observe(true);
      } catch {
        /* Preserve the last truthful observation for handoff. */
      }
    }
    return {
      status,
      reason,
      steps,
      elapsedMs: Date.now() - started,
      observationMs,
      decisionMs,
      actionMs,
      observation: lastObservation,
      attemptedResources: [...used],
    };
  };
  try {
    let observation = await observe();
    let waits = 0;
    for (let index = 0; index < (task.maxSteps ?? 10); index++) {
      signal.throwIfAborted();
      const space = actionSpace(observation, task.resources ?? [], used, task.goal);
      const decisionStarted = Date.now();
      const decision = await decide({
        apiKey: environment.apiKey,
        userRequest: environment.userRequest,
        goal: task.goal,
        observation,
        space,
        history,
        activeGuard: environment.activeGuard,
        signal,
      }).finally(() => {
        decisionMs += Date.now() - decisionStarted;
      });
      if (decision.operation === 'done')
        return await finish(
          'needs_verification',
          'Jev reports completion; independently inspect the returned final state.'
        );
      if (decision.operation === 'blocked')
        return await finish(
          'handoff',
          'Jev cannot select a supported, authorized action. Continue with the original computer tool and fresh evidence.'
        );
      if (decision.operation === 'wait') {
        if (++waits > 2) return await finish('handoff', 'The UI did not become ready within the bounded wait budget.');
        await delay(200, undefined, { signal });
        observation = await observe();
        continue;
      }
      const target = decision.target;
      if (!target || !Object.values(space.targets[decision.operation] ?? {}).includes(target))
        return await finish('handoff', 'The selected target is not in the current observation.');
      const identity = `${decision.operation}:${elementIdentity(target.element)}:${target.resource?.id ?? ''}:${observationIdentity(observation)}`;
      if (tried.has(identity))
        return await finish('handoff', 'The same action already ran on this unchanged UI; do not repeat it blindly.');
      tried.add(identity);
      const resource = target.resource;
      if (resource && used.has(resource.id))
        return await finish('handoff', 'This text/key resource was already attempted. Verify before any retry.');
      const args: Record<string, unknown> = {
        pid: task.pid,
        window_id: task.window_id,
        session: task.session,
        element_token: target.element.element_token,
        delivery_mode: task.delivery_mode ?? 'foreground',
      };
      let action: string = decision.operation;
      const actionBefore = actionMs;
      const needsPixel = action === 'type_text' || (action === 'click' && !target.element.actions?.includes('AXPress'));
      if (needsPixel) {
        const front = await dispatch({
          binary: environment.binary,
          action: 'bring_to_front',
          args: { pid: task.pid, window_id: task.window_id, session: task.session },
          structured: true,
          signal,
        });
        const frontData = record(front.data);
        if (
          frontData.pid !== task.pid ||
          frontData.window_id !== task.window_id ||
          record(frontData.exact_window_effect).verified !== true
        )
          return await finish('handoff', 'The exact target window could not be activated.');
        const fresh = await observe();
        const current = fresh.elements.find(
          (el) => elementIdentity(el) === elementIdentity(target.element) && el.value === target.element.value
        );
        if (!current)
          return await finish(
            'handoff',
            'The selected control moved or changed before input; choose again from fresh evidence.'
          );
        const capture = await dispatch({
          binary: environment.binary,
          action: 'get_desktop_state',
          args: { session: task.session },
          structured: true,
          signal,
        });
        const point = pixelTarget(capture.data, current);
        delete args.element_token;
        delete args.pid;
        delete args.window_id;
        delete args.delivery_mode;
        args.target = { kind: 'desktop', display_id: 'primary' };
        args.x = point.x;
        args.y = point.y;
        args.capture_id = point.capture_id;
        if (action === 'type_text') {
          const focus = await dispatch({
            binary: environment.binary,
            action: 'click',
            args: { ...args },
            structured: true,
            signal,
          });
          if (['refused', 'partial', 'suspected_noop'].includes(String(record(focus.data).effect)))
            return await finish('handoff', 'The desktop focus click did not land. No text entered.');
          delete args.x;
          delete args.y;
          delete args.capture_id;
        }
      }
      // Record BEFORE dispatch. A timeout may occur after the OS has applied input.
      if (resource) used.add(resource.id);
      if (action === 'type_text') args.text = resource?.text;
      if (action === 'press_key') args.key = resource?.key;
      if (action === 'scroll_up' || action === 'scroll_down') {
        args.direction = action === 'scroll_up' ? 'up' : 'down';
        args.amount = 3;
        action = 'scroll';
      }
      const result = await dispatch({ binary: environment.binary, action, args, structured: true, signal });
      const elapsed = actionMs - actionBefore;
      const effect = record(result.data).effect;
      const beforeObservationMs = observationMs;
      observation = await observe();
      const step = {
        operation: decision.operation,
        decisionMs: decision.latencyMs,
        actionMs: elapsed,
        observationMs: observationMs - beforeObservationMs,
        effect: typeof effect === 'string' ? effect : undefined,
      };
      steps.push(step);
      await dependencies.onStep?.(step);
      history.push(
        `${decision.operation} ${target.element.label.slice(0, 200)} ${resource?.id ?? ''}: ${effect ?? 'unknown'}`
      );
      if (['refused', 'partial', 'suspected_noop'].includes(String(effect)))
        return await finish(
          'handoff',
          `The driver reported ${effect}; use fresh visual evidence instead of repeating.`
        );
      if (
        action === 'type_text' &&
        !observation.elements.some(
          (el) => el.role === target.element.role && el.label === target.element.label && el.value === resource?.text
        )
      )
        return await finish(
          'handoff',
          'Typed text could not be independently read back. Inspect the screenshot before continuing.'
        );
      if (
        resource?.terminal ||
        (action === 'press_key' && resource?.key === 'return') ||
        (action === 'click' &&
          /^(发送|提交|发布|付款|支付|删除|send|submit|post|pay|delete)$/i.test(target.element.label.trim()))
      )
        return await finish(
          'needs_verification',
          'The final requested action was attempted once. Inspect the returned evidence; do not repeat it.'
        );
    }
    return await finish(
      'handoff',
      'Step budget reached. Continue from the returned observation, not from the beginning.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'computer_fast_failed';
    return await finish('handoff', message);
  } finally {
    busy.delete(task.pid);
  }
}
