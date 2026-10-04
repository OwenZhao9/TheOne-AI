import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const READ_ONLY =
  /^(get_|list_|check_|describe|status|doctor|dump_|health_report|verify_state|screenshot|snapshot|observe)/;
const HIGH_RISK =
  /pay|purchase|buy|book|checkout|confirm[_-]?(?:order|booking|purchase)|submit|send|delete|remove|kill|revoke|transfer|ticket|出票|支付|购买|購買|预订|預訂|下单|下單/i;
const connections = new Map<string, Promise<Client>>();

export type CuaResult = { text: string; screenshot?: string; data?: unknown };

class CuaToolError extends Error {}

export function validCuaAction(action: string): boolean {
  return /^[a-z][a-z0-9_]{0,63}$/.test(action);
}

export function isReadOnlyCuaAction(action: string): boolean {
  return READ_ONLY.test(action);
}

export function isHighRiskCuaAction(action: string, args: Record<string, unknown>): boolean {
  return HIGH_RISK.test(`${action} ${JSON.stringify(args)}`);
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown driver error';
  return error.message.replace(/\s+/g, ' ').trim().slice(0, 2_000) || 'unknown driver error';
}

async function createClient(binary: string): Promise<Client> {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
  ]);
  const transport = new StdioClientTransport({ command: binary, args: ['mcp'], stderr: 'pipe' });
  const client = new Client({ name: 'theone-computer-use', version: '1.0.0' });
  await client.connect(transport, { timeout: 30_000 });
  return client;
}

async function clientFor(binary: string): Promise<Client> {
  let pending = connections.get(binary);
  if (!pending) {
    pending = createClient(binary).catch((error) => {
      connections.delete(binary);
      throw error;
    });
    connections.set(binary, pending);
  }
  return pending;
}

async function discardClient(binary: string): Promise<void> {
  const pending = connections.get(binary);
  connections.delete(binary);
  if (pending) await pending.then((client) => client.close()).catch((): void => {});
}

export async function closeCuaConnections(): Promise<void> {
  const binaries = [...connections.keys()];
  await Promise.all(binaries.map((binary) => discardClient(binary)));
}

function toolText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 50_000);
  } catch {
    return String(value).slice(0, 50_000);
  }
}

function cuaResult(result: unknown): CuaResult {
  if (!result || typeof result !== 'object') return { text: toolText(result) };
  if ('toolResult' in result) return { text: toolText(result.toolResult) };

  const response = result as {
    content?: unknown;
    structuredContent?: unknown;
    isError?: unknown;
  };
  const content = Array.isArray(response.content) ? response.content : [];
  const text = content
    .filter((item): item is { type: 'text'; text: string } => {
      return Boolean(
        item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
      );
    })
    .map((item) => item.text)
    .join('\n')
    .trim()
    .slice(0, 50_000);
  const image = content.find((item) => {
    return Boolean(
      item &&
      typeof item === 'object' &&
      (item as { type?: unknown }).type === 'image' &&
      typeof (item as { data?: unknown }).data === 'string'
    );
  }) as { data?: string } | undefined;
  const structured = response.structuredContent === undefined ? '' : toolText(response.structuredContent);
  const output = [text, structured && structured !== text ? `Structured result:\n${structured}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 50_000);
  if (response.isError === true) throw new CuaToolError(output || 'Cua Driver rejected the action.');
  return { text: output || 'Computer action completed.', ...(image?.data ? { screenshot: image.data } : {}) };
}

export async function callCua(input: {
  binary: string;
  action: string;
  args: Record<string, unknown>;
  signal?: AbortSignal;
  structured?: boolean;
}): Promise<CuaResult> {
  if (!validCuaAction(input.action)) throw new Error('computer_action_invalid');
  if (!input.binary) throw new Error('computer_driver_missing');

  try {
    const client = await clientFor(input.binary);
    if (input.action === 'list_tools') {
      const result = await client.listTools(undefined, { signal: input.signal, timeout: 30_000 });
      return {
        text: toolText(result.tools.map(({ name, description }) => ({ name, description }))),
      };
    }
    if (input.action === 'describe_tool') {
      const tool = input.args.tool;
      if (typeof tool !== 'string' || !validCuaAction(tool)) throw new Error('computer_action_invalid');
      const result = await client.listTools(undefined, { signal: input.signal, timeout: 30_000 });
      const definition = result.tools.find((candidate) => candidate.name === tool);
      if (!definition) throw new CuaToolError(`Cua Driver tool not found: ${tool}`);
      return { text: toolText(definition) };
    }
    const result = await client.callTool({ name: input.action, arguments: input.args }, undefined, {
      signal: input.signal,
      timeout: 120_000,
    });
    const output = cuaResult(result);
    return input.structured ? { ...output, data: result.structuredContent } : output;
  } catch (error) {
    if (error instanceof CuaToolError)
      throw new Error(`computer_action_failed: ${errorMessage(error)}`, { cause: error });
    if (error instanceof Error && error.message === 'computer_action_invalid') throw error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
    await discardClient(input.binary);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('computer_driver_missing', { cause: error });
    throw new Error(`computer_driver_connection_failed: ${errorMessage(error)}`, { cause: error });
  }
}
