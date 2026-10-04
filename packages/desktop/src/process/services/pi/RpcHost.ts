import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import type { JsonRecord } from '@/common/pi';
import { recordOf } from '@/common/pi';
import { taskSandbox } from './tasks/sandbox';
import { assertRuntime, piEnvironment, type PiPaths } from './paths';

/** JSON records are separated only by LF, never Unicode paragraph separators. */
export class JsonLines {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  push(chunk: Buffer, receive: (record: JsonRecord) => void): void {
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > 64 * 1024 * 1024) throw new Error('protocol_record_too_large');
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) receive(recordOf(JSON.parse(line)));
    }
  }
}

export class RpcHost extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private requests = new Map<
    string,
    { resolve: (value: JsonRecord) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private counter = 0;
  private closing = false;
  private startPromise?: Promise<JsonRecord>;
  constructor(
    private paths: PiPaths,
    private cwd: string,
    private args: string[] = [],
    private extraEnv: NodeJS.ProcessEnv = {},
    private taskState?: string
  ) {
    super();
  }

  start(): Promise<JsonRecord> {
    this.startPromise ??= this.launch();
    return this.startPromise;
  }

  private async launch(): Promise<JsonRecord> {
    assertRuntime(this.paths);
    const sandbox = this.taskState ? await taskSandbox(this.cwd, this.taskState, this.paths.sessions) : undefined;
    const child = spawn(
      sandbox?.executable || this.paths.node,
      [
        ...(sandbox ? [...sandbox.prefix, this.paths.node] : []),
        this.paths.cli,
        '--mode',
        'rpc',
        '--session-dir',
        this.paths.sessions,
        ...this.args,
      ],
      {
        cwd: this.cwd,
        env: { ...piEnvironment(this.paths), ...this.extraEnv, ...sandbox?.env },
        stdio: 'pipe',
        detached: true,
      }
    );
    this.child = child;
    const parser = new JsonLines();
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        parser.push(chunk, (frame) => this.receive(frame));
      } catch {
        this.fail(new Error('protocol_invalid'));
        void this.close();
      }
    });
    // Pi's stderr can contain user content or credentials. Drain it, don't log it.
    child.stderr.on('data', () => undefined);
    child.on('error', () => this.fail(new Error('runtime_start_failed')));
    child.on('exit', (code, signal) => {
      this.child = undefined;
      this.fail(new Error(this.closing ? 'host_closed' : `runtime_exited:${code ?? signal}`));
      this.emit('exit', this.closing);
    });
    return this.request({ type: 'get_state' });
  }

  private receive(frame: JsonRecord): void {
    this.emit('record', frame);
    if (frame.type !== 'response') return;
    const pending = this.requests.get(String(frame.id));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.requests.delete(String(frame.id));
    if (frame.success === false) pending.reject(new Error(String(frame.error || 'request_failed')));
    else pending.resolve(recordOf(frame.data));
  }

  request(command: JsonRecord, timeout = 45000): Promise<JsonRecord> {
    if (!this.child || this.closing) return Promise.reject(new Error('host_closed'));
    const id = `desktop-${++this.counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('request_timeout'));
      }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify({ ...command, id })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.requests.delete(id);
        reject(new Error('host_closed'));
      });
    });
  }

  respond(response: JsonRecord): void {
    if (!this.child || this.closing) throw new Error('host_closed');
    this.child.stdin.write(`${JSON.stringify({ ...response, type: 'extension_ui_response' })}\n`);
  }

  private fail(error: Error): void {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.requests.clear();
  }

  async close(): Promise<void> {
    this.closing = true;
    const child = this.child;
    if (!child) return;
    this.fail(new Error('host_closed'));
    await new Promise<void>((resolve) => {
      const killGroup = (): void => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already exited */
        }
      };
      const timer = setTimeout(() => {
        killGroup();
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        killGroup();
        resolve();
      });
      child.stdin.end();
    });
  }
}
