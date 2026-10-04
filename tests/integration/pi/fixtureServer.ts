/** Local deterministic transport fixture. Never bundled or used as a model fallback. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function fixtureServer() {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body) as Record<string, unknown>;
    requests.push(data);
    const messages = data.messages as { role: string; content: string | { type: string; text?: string }[] }[];
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const text =
      typeof user?.content === 'string' ? user.content : user?.content?.map((b) => b.text || '').join('') || '';
    if (text.includes('HTTP_FAIL')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Fixture credential rejected', type: 'authentication_error' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      );
    chunk({ role: 'assistant' });
    if (text.includes('WAIT')) {
      const timer = setInterval(() => chunk({ content: 'waiting ' }), 150);
      res.on('close', () => clearInterval(timer));
      return;
    }
    const toolCount = messages.slice(messages.lastIndexOf(user!)).filter((m) => m.role === 'tool').length;
    if (text.includes('TOOLS') && toolCount < 3) {
      const operations = [
        { name: 'write', arguments: JSON.stringify({ path: 'hello.txt', content: 'first version' }) },
        {
          name: 'edit',
          arguments: JSON.stringify({ path: 'hello.txt', oldText: 'first version', newText: 'edited version' }),
        },
        { name: 'read', arguments: JSON.stringify({ path: 'hello.txt' }) },
      ];
      chunk({ tool_calls: [{ index: 0, id: `call_${toolCount}`, type: 'function', function: operations[toolCount] }] });
      chunk({}, 'tool_calls');
    } else {
      chunk({ content: `Fixture reply: ${text.replace(/WAIT/g, '').slice(0, 50)}` });
      chunk({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
