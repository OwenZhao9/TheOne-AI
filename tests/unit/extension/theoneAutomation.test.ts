import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import theOneAutomation, { branchState } from '../../../scripts/aionpi/automation-extension';
import * as judge from '@/process/extensions/automation/judge';
import { askJevBoolean, askJevChoice, selectedChoice, threeZone } from '@/process/extensions/automation/judge';

// Schema construction is supplied by Pi at runtime; these tests exercise execution, not validation.
vi.mock('typebox', () => {
  const schema = () => ({});
  return {
    Type: {
      Object: schema,
      String: schema,
      Number: schema,
      Boolean: schema,
      Record: schema,
      Unknown: schema,
      Array: schema,
      Optional: schema,
    },
  };
});

const mcp = vi.hoisted(() => ({
  clients: [] as object[],
  transports: [] as unknown[],
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  listTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    constructor() {
      mcp.clients.push(this);
    }
    connect(...args: unknown[]) {
      return mcp.connect(this, ...args);
    }
    close(...args: unknown[]) {
      return mcp.close(this, ...args);
    }
    listTools(...args: unknown[]) {
      return mcp.listTools(this, ...args);
    }
    callTool(...args: unknown[]) {
      return mcp.callTool(this, ...args);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    readonly parameters: unknown;

    constructor(parameters: unknown) {
      this.parameters = parameters;
      mcp.transports.push(parameters);
    }
  },
}));

import {
  callCua,
  closeCuaConnections,
  isHighRiskCuaAction,
  isReadOnlyCuaAction,
  validCuaAction,
} from '@/process/extensions/automation/cua';

beforeEach(async () => {
  await closeCuaConnections();
  mcp.clients.length = 0;
  mcp.transports.length = 0;
  vi.clearAllMocks();
});

afterAll(async () => {
  await closeCuaConnections();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TheOne computer actions without an extra confirmation dialog', () => {
  beforeEach(() => {
    vi.stubEnv('THEONE_CUA_DRIVER', '/test/cua-driver');
    vi.stubEnv('THEONE_JUDGE_MODE', 'shadow');
    vi.stubEnv('TYPESAFE_API_KEY', '');
    vi.stubEnv('THEONE_JUDGE_LEDGER', '');
    mcp.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'driver result' }] });
  });

  function computer() {
    const registered: Parameters<ExtensionAPI['registerTool']>[0][] = [];
    theOneAutomation({ registerTool: (tool) => registered.push(tool) } as ExtensionAPI);
    const tool = registered.find((entry) => entry.name === 'computer')!;
    const confirm = vi.fn(async () => false);
    const ctx = {
      sessionManager: { getBranch: () => [] },
      ui: { confirm },
    } as unknown as ExtensionContext;
    return { tool, confirm, ctx };
  }

  it('lists windows without prompting when the session label contains send', async () => {
    vi.stubEnv('THEONE_JUDGE_MODE', 'active');
    const { tool, confirm, ctx } = computer();
    const result = await tool.execute(
      'call-1',
      {
        action: 'list_windows',
        arguments: { pid: 123, session: 'wechat-send-morning-20250215' },
      },
      undefined,
      undefined,
      ctx
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(result.content).toEqual([{ type: 'text', text: 'driver result' }]);
    expect(mcp.callTool).toHaveBeenCalledOnce();
  });

  it('does not add a confirmation dialog for a consequential action', async () => {
    const { tool, confirm, ctx } = computer();
    await tool.execute('call-2', { action: 'click', arguments: { label: 'Send' } }, undefined, undefined, ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(mcp.callTool).toHaveBeenCalledOnce();
  });

  it('reports an active Jev rejection without opening a dialog or executing the action', async () => {
    vi.stubEnv('THEONE_JUDGE_MODE', 'active');
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    vi.spyOn(judge, 'askJevBoolean').mockRejectedValue(new Error('judge unavailable'));
    const { tool, confirm, ctx } = computer();
    await expect(tool.execute('call-3', { action: 'click', arguments: {} }, undefined, undefined, ctx)).rejects.toThrow(
      'computer_action_blocked_by_jev'
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(mcp.callTool).not.toHaveBeenCalled();
  });

  it('executes an active Jev approval without asking for confirmation', async () => {
    vi.stubEnv('THEONE_JUDGE_MODE', 'active');
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    vi.spyOn(judge, 'askJevBoolean').mockResolvedValue({ verdict: 'yes', probability: 0.95, latencyMs: 1 });
    const { tool, confirm, ctx } = computer();
    await tool.execute('call-4', { action: 'click', arguments: { label: 'Send' } }, undefined, undefined, ctx);
    expect(confirm).not.toHaveBeenCalled();
    expect(mcp.callTool).toHaveBeenCalledOnce();
  });
});

describe('TheOne judgment evidence', () => {
  it('preserves the user request and exact action when history contains large images and catalogs', () => {
    const branch = [
      { message: { role: 'user', content: [{ type: 'text', text: 'Open WeChat, do not send a message.' }] } },
      ...Array.from({ length: 22 }, () => ({
        message: {
          role: 'toolResult',
          content: [
            { type: 'image', data: 'BASE64_IMAGE'.repeat(100_000) },
            { type: 'text', text: 'tool catalog '.repeat(10_000) },
          ],
        },
      })),
    ];
    const state = branchState(branch, 'bring_to_front', { pid: 123, window_id: 456 });
    expect(JSON.parse(state)).toMatchObject({
      latestUserRequest: 'Open WeChat, do not send a message.',
      proposedAction: { action: 'bring_to_front', arguments: { pid: 123, window_id: 456 } },
    });
    expect(state.length).toBeLessThanOrEqual(50_000);
    expect(state).not.toMatch(/BASE64_IMAGE|tool catalog/);
  });

  it('refuses an oversized action instead of silently changing the proposed text', () => {
    expect(() => branchState([], 'type_text', { text: 'x'.repeat(50_001) })).toThrow(
      'computer_judge_context_too_large'
    );
  });

  it('ignores malformed entries and accepts string user messages', () => {
    const state = branchState([null, {}, { message: { role: 'user', content: 'Only inspect.' } }], 'click', {});
    expect(JSON.parse(state).latestUserRequest).toBe('Only inspect.');
  });

  it('keeps the current visual observation even before assistant text is persisted in history', () => {
    const state = branchState(
      [],
      'click',
      { x: 10, y: 20 },
      'The visible target is File Transfer Assistant. Open that chat.'
    );
    expect(JSON.parse(state).agentObservation).toBe('The visible target is File Transfer Assistant. Open that chat.');
  });
});

describe('TheOne Computer Use guardrails', () => {
  it('accepts Cua tool names but rejects command injection', () => {
    expect(validCuaAction('screenshot')).toBe(true);
    expect(validCuaAction('click')).toBe(true);
    expect(validCuaAction('click;rm')).toBe(false);
    expect(validCuaAction('../click')).toBe(false);
  });

  it('separates inspection from mutation and detects consequential actions', () => {
    expect(isReadOnlyCuaAction('screenshot')).toBe(true);
    expect(isReadOnlyCuaAction('get_windows')).toBe(true);
    expect(isReadOnlyCuaAction('list_tools')).toBe(true);
    expect(isReadOnlyCuaAction('describe_tool')).toBe(true);
    expect(isReadOnlyCuaAction('click')).toBe(false);
    expect(isHighRiskCuaAction('click', { label: 'Pay now' })).toBe(true);
    expect(isHighRiskCuaAction('type', { text: 'hello' })).toBe(false);
  });
});

describe('TheOne persistent Cua connection', () => {
  it('reuses one MCP client for observation and the following click', async () => {
    mcp.callTool
      .mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'desktop captured' },
          { type: 'image', data: 'cG5n', mimeType: 'image/png' },
        ],
        structuredContent: { capture_id: 'capture-1' },
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'clicked' }] });

    const observed = await callCua({
      binary: '/test/cua-driver',
      action: 'get_desktop_state',
      args: { session: 'wechat-task' },
    });
    const clicked = await callCua({
      binary: '/test/cua-driver',
      action: 'click',
      args: { session: 'wechat-task', capture_id: 'capture-1', x: 10, y: 20 },
    });

    expect(observed).toEqual({
      text: 'desktop captured\nStructured result:\n{\n  "capture_id": "capture-1"\n}',
      screenshot: 'cG5n',
    });
    expect(clicked.text).toBe('clicked');
    expect(mcp.clients).toHaveLength(1);
    expect(mcp.transports).toEqual([{ command: '/test/cua-driver', args: ['mcp'], stderr: 'pipe' }]);
    expect(mcp.callTool).toHaveBeenNthCalledWith(
      2,
      mcp.clients[0],
      {
        name: 'click',
        arguments: { session: 'wechat-task', capture_id: 'capture-1', x: 10, y: 20 },
      },
      undefined,
      expect.objectContaining({ timeout: 120_000 })
    );
  });

  it('preserves the driver error instead of hiding it behind a generic failure', async () => {
    mcp.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'capture_id expired in this session' }],
    });

    await expect(
      callCua({ binary: '/test/cua-driver', action: 'click', args: { capture_id: 'expired' } })
    ).rejects.toThrow('computer_action_failed: capture_id expired in this session');
  });
});

describe('mu-compatible Jev System One protocol', () => {
  it('uses the noul wire type and a three-zone verdict for boolean checks', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { questions: { decision: { type: string } } };
      expect(request.questions.decision.type).toBe('noul');
      return new Response(JSON.stringify({ answers: { decision: { noul: 0.91 } } }), { status: 200 });
    });
    const result = await askJevBoolean({ apiKey: 'test-key', state: 'facts', question: 'safe?', fetchImpl });
    expect(result.verdict).toBe('yes');
    expect(threeZone(0.5)).toBe('unsure');
  });

  it('adds an escape option and rejects a low-probability choice', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        questions: { decision: { criteria: Record<string, string> } };
      };
      expect(request.questions.decision.criteria.unclear).toBeDefined();
      return new Response(
        JSON.stringify({
          model: 'jev-latest',
          answers: { decision: { choice: 'flight_a', probabilities: { flight_a: 0.55, unclear: 0.45 } } },
        }),
        { status: 200 }
      );
    });
    const result = await askJevChoice({
      apiKey: 'test-key',
      state: 'two flight candidates',
      question: 'Which matches the user?',
      options: [
        { id: 'flight_a', description: 'Morning direct flight' },
        { id: 'flight_b', description: 'Evening connecting flight' },
      ],
      fetchImpl,
    });
    expect(selectedChoice(result)).toBeUndefined();
  });
});
