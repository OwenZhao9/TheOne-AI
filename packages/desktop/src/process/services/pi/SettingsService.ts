import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { JsonRecord, PiCatalog, PiConnection, PiSettings } from '@/common/pi';
import { recordOf } from '@/common/pi';
import { JsonLines } from './RpcHost';
import { assertRuntime, piEnvironment, safeError, type PiPaths } from './paths';

export class SettingsService {
  private cachedCatalog?: { value: Omit<PiCatalog, 'settings'>; expires: number };
  private catalogRequest?: Promise<Omit<PiCatalog, 'settings'>>;
  private catalogGeneration = 0;
  private invalidateCatalog(): void {
    this.catalogGeneration++;
    this.cachedCatalog = undefined;
    this.catalogRequest = undefined;
  }
  private auth?: ChildProcessWithoutNullStreams;
  private children = new Set<ChildProcessWithoutNullStreams>();
  private defaults: PiSettings = {
    notifications: true,
    thinkingLevel: 'medium',
    jevProvider: 'typesafe',
    jevModel: 'jev-latest',
  };
  constructor(
    private paths: PiPaths,
    private notify: (event: JsonRecord) => void
  ) {}

  async load(): Promise<void> {
    try {
      this.defaults = {
        ...this.defaults,
        ...JSON.parse(await readFile(join(this.paths.data, 'settings.json'), 'utf8')),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('settings_read_failed');
    }
  }
  get(): PiSettings {
    return { ...this.defaults };
  }
  async save(settings: PiSettings): Promise<void> {
    const next = { ...settings };
    if (next.jevProvider && !/^[a-zA-Z0-9._-]+$/.test(next.jevProvider)) throw new Error('invalid_provider');
    if (next.jevModel && !/^[a-zA-Z0-9._:/-]+$/.test(next.jevModel)) throw new Error('invalid_model');
    if (next.skillRegistryUrl) {
      let url: URL;
      try {
        url = new URL(next.skillRegistryUrl);
      } catch {
        throw new Error('skill_registry_invalid');
      }
      if (url.protocol !== 'https:') throw new Error('skill_registry_https_required');
    }
    await writeFile(join(this.paths.data, 'settings.json.tmp'), JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(join(this.paths.data, 'settings.json.tmp'), join(this.paths.data, 'settings.json'));
    this.defaults = next;
  }

  async catalog(): Promise<PiCatalog> {
    if (this.cachedCatalog && this.cachedCatalog.expires > Date.now())
      return { ...this.cachedCatalog.value, settings: this.get() };
    if (!this.catalogRequest) {
      const generation = this.catalogGeneration;
      this.catalogRequest = this.helper({ method: 'catalog' })
        .then((data) => {
          const value = data as Omit<PiCatalog, 'settings'>;
          if (generation === this.catalogGeneration && !value.providers.some((p) => p.modelError))
            this.cachedCatalog = { value, expires: Date.now() + 60000 };
          return value;
        })
        .finally(() => {
          if (generation === this.catalogGeneration) this.catalogRequest = undefined;
        });
    }
    const generation = this.catalogGeneration;
    const value = await this.catalogRequest;
    if (generation !== this.catalogGeneration) return this.catalog();
    return { ...value, settings: this.get() };
  }
  async connection(input: PiConnection): Promise<void> {
    this.invalidateCatalog();
    if (!input.provider?.trim() || !/^[a-zA-Z0-9._-]+$/.test(input.provider)) throw new Error('invalid_provider');
    await this.helper({ ...input, method: 'save' }).finally(() => this.invalidateCatalog());
    if (input.model) await this.save({ ...this.get(), provider: input.provider, model: input.model });
  }
  async login(provider: string, authType: string): Promise<void> {
    this.invalidateCatalog();
    await this.helper({ method: 'login', provider, authType }, true).finally(() => this.invalidateCatalog());
  }
  async logout(provider: string): Promise<void> {
    this.invalidateCatalog();
    await this.helper({ method: 'logout', provider }).finally(() => this.invalidateCatalog());
  }
  respond(input: JsonRecord): void {
    this.auth?.stdin.write(`${JSON.stringify({ ...input, method: 'answer' })}\n`);
  }
  cancel(): void {
    this.auth?.stdin.write('{"method":"cancel"}\n');
    this.auth?.stdin.end();
    this.auth = undefined;
  }
  dispose(): void {
    this.cancel();
    for (const child of this.children) child.kill();
    this.children.clear();
  }

  private helper(input: JsonRecord, interactive = false): Promise<JsonRecord> {
    assertRuntime(this.paths);
    if (interactive && this.auth) throw new Error('login_in_progress');
    return new Promise((resolve, reject) => {
      const child = spawn(this.paths.node, [this.paths.helper], {
        cwd: this.paths.agent,
        env: piEnvironment(this.paths),
        stdio: 'pipe',
      });
      this.children.add(child);
      if (interactive) this.auth = child;
      const parser = new JsonLines();
      let done = false;
      const finish = (error?: Error, data: JsonRecord = {}): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        child.stdin.end();
        child.kill();
        this.children.delete(child);
        if (this.auth === child) this.auth = undefined;
        if (interactive) this.notify({ type: 'closed' });
        if (error) reject(error);
        else resolve(data);
      };
      const timer = setTimeout(
        () => finish(new Error(interactive ? 'login_timeout' : 'request_timeout')),
        interactive ? 600000 : 45000
      );
      child.on('error', () => finish(new Error('runtime_start_failed')));
      child.on('exit', () => finish(new Error('login_cancelled')));
      child.stderr.on('data', () => undefined);
      child.stdout.on('data', (chunk: Buffer) => {
        try {
          parser.push(chunk, (frame) => {
            if (frame.type === 'result') finish(undefined, recordOf(frame.data));
            else if (frame.type === 'failure') finish(new Error(safeError(frame.message)));
            else this.notify(frame);
          });
        } catch {
          finish(new Error('protocol_invalid'));
        }
      });
      child.stdin.write(`${JSON.stringify(input)}\n`);
    });
  }
}
