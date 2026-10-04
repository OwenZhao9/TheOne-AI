// Desktop observation/candidate loop informed by Sac-Y/Jev-cu (MIT).
// Operation-specific target choices informed by browser-use/jev-ultrafast (MIT).
// See NOTICE for upstream attribution and license terms.
export type Element = {
  element_token: string;
  role: string;
  label: string;
  value: string;
  actions?: string[];
  frame?: { x: number; y: number; w: number; h: number };
};
export type Observation = { pid: number; window_id: number; title: string; app: string; elements: Element[] };
export type Resource = { id: string; purpose: string; text?: string; key?: string; terminal?: boolean };
export type Operation = 'click' | 'type_text' | 'press_key' | 'scroll_up' | 'scroll_down' | 'wait' | 'done' | 'blocked';
export type Target = { element: Element; resource?: Resource };
export type Space = { operations: Record<string, string>; targets: Record<string, Record<string, Target>> };

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Use the driver's structured native roles, not locale-dependent rendered text. */
export function readObservation(value: unknown, pid: number, windowId: number): Observation {
  const data = record(value);
  if (data.pid !== pid || data.window_id !== windowId || !Array.isArray(data.elements) || data.degraded_reason)
    throw new Error('computer_fast_observation_unavailable');
  const elements: Element[] = [];
  const windowFrame = record(record(data.elements.find((item) => record(item).role === 'AXWindow')).frame);
  for (const raw of data.elements) {
    const el = record(raw);
    const frame = record(el.frame);
    if (
      typeof windowFrame.x === 'number' &&
      typeof windowFrame.y === 'number' &&
      typeof windowFrame.w === 'number' &&
      typeof windowFrame.h === 'number' &&
      typeof frame.x === 'number' &&
      typeof frame.y === 'number' &&
      typeof frame.w === 'number' &&
      typeof frame.h === 'number'
    ) {
      const centerX = frame.x + frame.w / 2;
      const centerY = frame.y + frame.h / 2;
      if (
        centerX < windowFrame.x ||
        centerX > windowFrame.x + windowFrame.w ||
        centerY < windowFrame.y ||
        centerY > windowFrame.y + windowFrame.h
      )
        continue;
    }
    if (el.enabled === false || typeof el.element_token !== 'string' || !/^s[0-9a-f]{8}:\d+$/.test(el.element_token))
      continue;
    if (typeof el.role !== 'string' || /secure|password/i.test(el.role)) continue;
    if (typeof frame.w === 'number' && typeof frame.h === 'number' && (frame.w <= 1 || frame.h <= 1)) continue;
    elements.push({
      element_token: el.element_token,
      role: el.role,
      label: typeof el.label === 'string' ? el.label : '',
      value: typeof el.value === 'string' ? el.value : '',
      actions: Array.isArray(el.actions)
        ? el.actions.filter((action): action is string => typeof action === 'string')
        : [],
      ...(typeof frame.x === 'number' &&
      typeof frame.y === 'number' &&
      typeof frame.w === 'number' &&
      typeof frame.h === 'number'
        ? { frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h } }
        : {}),
    });
  }
  return {
    pid,
    window_id: windowId,
    title: String(data.window_title || ''),
    app: String(data.app_name || ''),
    elements,
  };
}

export function elementIdentity(el: Element): string {
  return JSON.stringify([el.role, el.label, el.frame]);
}

export function observationIdentity(observation: Observation): string {
  // Tokens change on every observation even when the UI does not.
  return JSON.stringify([observation.title, observation.elements.map((el) => [elementIdentity(el), el.value])]);
}

/** Map an observed native element into a freshly captured primary-desktop PNG. */
export function pixelTarget(data: unknown, element: Element): { x: number; y: number; capture_id: string } {
  const snapshot = record(data);
  const bounds = { x: 0, y: 0, width: snapshot.screen_width, height: snapshot.screen_height };
  const frame = element.frame;
  const width = snapshot.screenshot_width;
  const height = snapshot.screenshot_height;
  if (
    !frame ||
    typeof bounds.x !== 'number' ||
    typeof bounds.y !== 'number' ||
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    ![bounds.x, bounds.y, bounds.width, bounds.height, width, height, frame.x, frame.y, frame.w, frame.h].every(
      Number.isFinite
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    width <= 0 ||
    height <= 0 ||
    snapshot.display !== 'primary' ||
    typeof snapshot.capture_id !== 'string'
  )
    throw new Error('computer_fast_pixel_geometry_unavailable');
  // The driver may downscale its screenshot after Retina capture. Use actual PNG
  // dimensions, not screenshot_scale (the backing scale can still be 2).
  const x = ((frame.x + frame.w / 2 - bounds.x) * width) / bounds.width;
  const y = ((frame.y + frame.h / 2 - bounds.y) * height) / bounds.height;
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error('computer_fast_pixel_target_outside_window');
  return { x, y, capture_id: snapshot.capture_id };
}

const EDITABLE = /^(AXTextArea|AXTextField|AXSearchField|AXComboBox)$/;
const CLICKABLE =
  /^(AXButton|AXLink|AXMenuItem|AXCheckBox|AXRadioButton|AXPopUpButton|AXTab|AXRow|AXCell|AXTextArea|AXTextField|AXSearchField|AXComboBox|AXStaticText)$/;

/** Never offer arbitrary coordinates, generated keys, or text from the screen as instructions. */
export function actionSpace(observation: Observation, resources: Resource[], used: Set<string>, goal: string): Space {
  const targets: Space['targets'] = {};
  const tokens = goal
    .toLowerCase()
    .split(/\s+|[，。；：、]/)
    .filter((part) => part.length > 1);
  const ranked = observation.elements
    .map((element, index) => ({
      element,
      index,
      score:
        tokens.reduce((sum, token) => sum + (element.label.toLowerCase().includes(token) ? 4 : 0), 0) +
        (EDITABLE.test(element.role) ? 2 : 0),
    }))
    .toSorted((a, b) => b.score - a.score || a.index - b.index);
  // Rank editable controls before bounding; history must not crowd out inputs.
  const controls = ranked
    .filter(({ element }) => CLICKABLE.test(element.role) && element.label && element.frame)
    .slice(0, 60);
  const add = (operation: string, id: string, element: Element, resource?: Resource) => {
    (targets[operation] ??= {})[id] = { element, ...(resource ? { resource } : {}) };
  };
  for (const { element, index } of controls) {
    // The existing type_text driver focuses its explicit element itself. Offering
    // a redundant focus-click splits the decision probability and costs a step.
    const hasInput =
      EDITABLE.test(element.role) &&
      resources.some(
        (item) => !used.has(item.id) && (item.key !== undefined || (item.text !== undefined && !element.value))
      );
    if (!hasInput) add('click', `e${index}`, element);
    if (EDITABLE.test(element.role)) {
      for (const resource of resources.filter((item) => !used.has(item.id))) {
        if (resource.text !== undefined && !element.value)
          add('type_text', `e${index}_${resource.id}`, element, resource);
        if (resource.key !== undefined) add('press_key', `e${index}_${resource.id}`, element, resource);
      }
    }
  }
  for (const [index, element] of observation.elements.entries()) {
    if (!element.frame || !/^(AXScrollArea|AXList|AXTable|AXOutline)$/.test(element.role)) continue;
    add('scroll_up', `e${index}`, element);
    add('scroll_down', `e${index}`, element);
  }
  const descriptions: Record<string, string> = {
    click: 'Click an observed control.',
    type_text: 'Insert one exact supplied text into an EMPTY editable field.',
    press_key: 'Press one supplied key on an observed editable field, only for its stated purpose.',
    scroll_up: 'Scroll an observed region up.',
    scroll_down: 'Scroll an observed region down.',
  };
  return {
    targets,
    operations: {
      ...Object.fromEntries(Object.keys(targets).map((operation) => [operation, descriptions[operation]])),
      wait: 'Wait briefly for an already initiated UI update.',
      done: 'The requested subtask is visibly satisfied; return evidence to the planner for verification.',
      blocked:
        'Unsupported UI, missing authorization, ambiguous target, or no suitable observed action. Hand back to the planner.',
    },
  };
}
