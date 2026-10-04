import { execFile, spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { PiAutomationAction, PiAutomationSettings, PiAutomationStatus } from '@/common/pi';
import type { BotCapability } from '@/common/pi/bots';
import type { PiPaths } from '../../services/pi/paths';

const execute = promisify(execFile);

type StoredAutomation = {
  judgeMode: PiAutomationSettings['judgeMode'];
  jevKeyEncrypted?: string;
  jevProjectDir?: string;
};
export type SecretCodec = { seal(value: string): string; open(value: string): string };

export function parseJevApiKey(dotEnv: string): string {
  for (const line of dotEnv.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      return value.slice(1, -1);
    return value.replace(/\s+#.*$/, '').trim();
  }
  return '';
}

export function hasRequiredCuaPermissions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const permissions = value as { status?: unknown; accessibility?: unknown; screen_recording?: unknown };
  return (
    permissions.status === 'granted' || (permissions.accessibility === true && permissions.screen_recording === true)
  );
}

const DRIVER_CANDIDATES = [
  join(homedir(), '.local/bin/cua-driver'),
  '/Applications/CuaDriver.app/Contents/MacOS/cua-driver',
];

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

export class AutomationService {
  private readonly file: string;
  private state: StoredAutomation = { judgeMode: 'shadow' };
  private driver?: string;
  private computerReady = false;
  private jevEnvKey = '';

  constructor(
    private readonly paths: PiPaths,
    private readonly codec: SecretCodec
  ) {
    this.file = join(paths.data, 'automation.json');
  }

  async load(): Promise<void> {
    await this.installAssets();
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as StoredAutomation;
      if (!['shadow', 'active'].includes(parsed.judgeMode)) throw new Error();
      if (parsed.jevKeyEncrypted !== undefined && typeof parsed.jevKeyEncrypted !== 'string') throw new Error();
      if (parsed.jevProjectDir !== undefined && typeof parsed.jevProjectDir !== 'string') throw new Error();
      this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('automation_settings_invalid', { cause: error });
    }
    this.jevEnvKey = await this.readJevEnvKey(this.projectDir());
    this.driver = await this.findDriver();
    await this.status();
  }

  private projectDir(): string {
    return this.state.jevProjectDir?.trim() || process.env.JEV_PROJECT_DIR?.trim() || '';
  }

  private async readJevEnvKey(projectDir: string): Promise<string> {
    if (!projectDir) return '';
    try {
      return parseJevApiKey(await readFile(join(projectDir, '.env'), 'utf8'));
    } catch {
      return '';
    }
  }

  private async installAssets(): Promise<void> {
    const extensionSource = join(this.paths.runtime, 'theone-automation.js');
    const skillSource = join(this.paths.runtime, 'theone-skills', 'computer-use', 'SKILL.md');
    if (!(await exists(extensionSource)) || !(await exists(skillSource))) throw new Error('automation_runtime_missing');
    const extensionTarget = join(this.paths.agent, 'extensions', 'theone-automation.js');
    const skillTarget = join(this.paths.agent, 'skills', 'computer-use', 'SKILL.md');
    await Promise.all([
      mkdir(dirname(extensionTarget), { recursive: true }),
      mkdir(dirname(skillTarget), { recursive: true }),
    ]);
    await Promise.all([copyFile(extensionSource, extensionTarget), copyFile(skillSource, skillTarget)]);
  }

  private async findDriver(): Promise<string | undefined> {
    const configured = process.env.THEONE_CUA_DRIVER;
    for (const path of configured ? [configured, ...DRIVER_CANDIDATES] : DRIVER_CANDIDATES)
      if (await exists(path)) return path;
    return undefined;
  }

  capabilities(): BotCapability[] {
    return this.computerReady ? ['files', 'shell', 'computer-use'] : ['files', 'shell'];
  }

  environment(): NodeJS.ProcessEnv {
    let key = '';
    if (this.state.jevKeyEncrypted) {
      try {
        key = this.codec.open(this.state.jevKeyEncrypted);
      } catch {
        key = '';
      }
    }
    return {
      ...(this.driver ? { THEONE_CUA_DRIVER: this.driver } : {}),
      THEONE_JUDGE_MODE: this.state.judgeMode,
      THEONE_JUDGE_LEDGER: join(this.paths.data, 'automation-ledger.jsonl'),
      ...(this.projectDir() ? { JEV_PROJECT_DIR: this.projectDir() } : {}),
      ...(key || this.jevEnvKey ? { TYPESAFE_API_KEY: key || this.jevEnvKey } : {}),
    };
  }

  async status(): Promise<PiAutomationStatus> {
    this.driver = await this.findDriver();
    this.computerReady = false;
    const base = { jevConfigured: Boolean(this.environment().TYPESAFE_API_KEY), judgeMode: this.state.judgeMode };
    if (!this.driver) return { ...base, computerUse: 'not_installed' };
    let driverVersion: string | undefined;
    try {
      const version = await execute(this.driver, ['--version'], { encoding: 'utf8', timeout: 10_000 });
      driverVersion = version.stdout.trim().slice(0, 100);
    } catch {
      return { ...base, computerUse: 'error', detail: 'computer_driver_error' };
    }
    try {
      await execute(this.driver, ['status'], { encoding: 'utf8', timeout: 10_000 });
    } catch {
      return { ...base, computerUse: 'stopped', driverVersion };
    }
    try {
      const permissions = await execute(this.driver, ['permissions', 'status', '--json'], {
        encoding: 'utf8',
        timeout: 15_000,
      });
      if (!hasRequiredCuaPermissions(JSON.parse(permissions.stdout)))
        return { ...base, computerUse: 'needs_permissions', driverVersion };
    } catch {
      return { ...base, computerUse: 'needs_permissions', driverVersion };
    }
    this.computerReady = true;
    return { ...base, computerUse: 'ready', driverVersion };
  }

  async save(input: PiAutomationSettings): Promise<void> {
    if (!['shadow', 'active'].includes(input.judgeMode)) throw new Error('automation_settings_invalid');
    const next: StoredAutomation = {
      judgeMode: input.judgeMode,
      jevKeyEncrypted: this.state.jevKeyEncrypted,
      jevProjectDir: input.jevProjectDir?.trim() || this.state.jevProjectDir || process.env.JEV_PROJECT_DIR?.trim(),
    };
    if (input.jevApiKey?.trim()) next.jevKeyEncrypted = this.codec.seal(input.jevApiKey.trim());
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = next;
    this.jevEnvKey = await this.readJevEnvKey(this.projectDir());
  }

  async action(action: PiAutomationAction): Promise<PiAutomationStatus> {
    this.driver = await this.findDriver();
    if (action === 'start') {
      spawn('/usr/bin/open', ['-n', '-g', '-a', 'CuaDriver', '--args', 'serve'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } else if (action === 'permissions') {
      if (!this.driver) throw new Error('computer_driver_missing');
      spawn(this.driver, ['permissions', 'grant'], { detached: true, stdio: 'ignore' }).unref();
    }
    return this.status();
  }
}
