import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BotBinding, BotCapability, BotCard, BotPreview } from '@/common/pi/bots';
import { parseBotManifest } from '@/common/pi/bots';
import { readLocalPackage, writePackage, type BotPackage } from './botPackage';
import { readGithubPackage } from './botGithub';

type SavedBot = Omit<BotCard, 'missingCapabilities'>;
type State = {
  bots: Record<string, SavedBot>;
  sessions: Record<string, BotBinding>;
  /** Built-ins are seeded once so a user removal is respected after restart. */
  builtinSeeds?: Record<string, string>;
};
export class BotStore {
  private state: State = { bots: {}, sessions: {}, builtinSeeds: {} };
  private pending = new Map<string, { pack: BotPackage; expires: number }>();
  private writes: Promise<unknown> = Promise.resolve();
  readonly root: string;
  constructor(
    data: string,
    private capabilities: () => BotCapability[] = () => ['files', 'shell']
  ) {
    this.root = join(data, 'bots');
  }
  async load(): Promise<void> {
    await mkdir(join(this.root, 'packages'), { recursive: true });
    try {
      const state = JSON.parse(await readFile(join(this.root, 'state.json'), 'utf8')) as State;
      if (!state.bots || !state.sessions || Array.isArray(state.bots) || Array.isArray(state.sessions))
        throw new Error();
      if (
        state.builtinSeeds !== undefined &&
        (!state.builtinSeeds || Array.isArray(state.builtinSeeds) || typeof state.builtinSeeds !== 'object')
      )
        throw new Error();
      for (const revision of Object.values(state.builtinSeeds || {})) {
        if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error();
      }
      for (const bot of Object.values(state.bots)) {
        const { revision, source, installedAt, favorite, ...manifest } = bot;
        parseBotManifest(manifest);
        if (
          !/^[a-f0-9]{64}$/.test(revision) ||
          typeof source !== 'string' ||
          typeof installedAt !== 'number' ||
          typeof favorite !== 'boolean'
        )
          throw new Error();
      }
      for (const binding of Object.values(state.sessions))
        if (!/^[a-f0-9]{64}$/.test(binding.revision)) throw new Error();
      this.state = { ...state, builtinSeeds: state.builtinSeeds || {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('bot_store_invalid');
    }
  }
  async seedBuiltins(packages: BotPackage[]): Promise<void> {
    const pending = packages.filter(
      (pack) => !this.state.builtinSeeds?.[pack.manifest.id] && !this.state.bots[pack.manifest.id]
    );
    if (!pending.length && packages.every((pack) => this.state.builtinSeeds?.[pack.manifest.id])) return;

    for (const pack of pending) {
      const stage = await mkdtemp(join(this.root, 'builtin-'));
      try {
        await writePackage(stage, pack);
        const destination = join(this.root, 'packages', pack.revision);
        try {
          await rename(stage, destination);
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        }
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }

    await this.change((state) => {
      state.builtinSeeds ||= {};
      for (const pack of packages) {
        if (!state.builtinSeeds[pack.manifest.id]) state.builtinSeeds[pack.manifest.id] = pack.revision;
        if (state.bots[pack.manifest.id]) continue;
        state.bots[pack.manifest.id] = {
          ...pack.manifest,
          source: pack.source,
          revision: pack.revision,
          installedAt: Date.now(),
          favorite: false,
        };
      }
    });
  }
  private missing(required: BotCapability[]): BotCapability[] {
    return required.filter((cap) => !this.capabilities().includes(cap));
  }
  list(): BotCard[] {
    return Object.values(this.state.bots)
      .map((bot) => ({ ...bot, missingCapabilities: this.missing(bot.requiredCapabilities) }))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.installedAt - a.installedAt);
  }
  get(id: string): BotCard {
    const bot = this.list().find((item) => item.id === id);
    if (!bot) throw new Error('bot_missing');
    return bot;
  }
  binding(sessionId: string): BotBinding | undefined {
    return this.state.sessions[sessionId];
  }
  async prepare(source: { folder: string } | { github: string }): Promise<BotPreview> {
    for (const [token, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(token);
    if (this.pending.size >= 4) this.pending.delete(this.pending.keys().next().value!);
    let pack: BotPackage;
    try {
      pack = 'github' in source ? await readGithubPackage(source.github) : await readLocalPackage(source.folder);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('bot_')) throw error;
      throw new Error('github' in source ? 'bot_github_failed' : 'bot_package_read');
    }
    const token = randomUUID();
    this.pending.set(token, { pack, expires: Date.now() + 10 * 60 * 1000 });
    return {
      token,
      manifest: pack.manifest,
      source: pack.source,
      replaces: this.state.bots[pack.manifest.id]?.version,
      missingCapabilities: this.missing(pack.manifest.requiredCapabilities),
    };
  }
  discard(token: string): void {
    this.pending.delete(token);
  }
  private change(action: (state: State) => void): Promise<void> {
    const operation = this.writes
      .catch((): void => {})
      .then(async () => {
        const next = structuredClone(this.state);
        action(next);
        const file = join(this.root, 'state.json');
        await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        this.state = next;
      });
    this.writes = operation;
    return operation;
  }
  async install(token: string): Promise<BotCard> {
    const prepared = this.pending.get(token);
    if (!prepared || prepared.expires < Date.now()) throw new Error('bot_preview_expired');
    const { pack } = prepared;
    const stage = await mkdtemp(join(this.root, 'import-'));
    try {
      await writePackage(stage, pack);
      const destination = join(this.root, 'packages', pack.revision);
      try {
        await rename(stage, destination);
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
        const existing = await readLocalPackage(destination).catch((): undefined => undefined);
        if (existing?.revision !== pack.revision) {
          const backup = join(this.root, `changed-${randomUUID()}`);
          await rename(destination, backup);
          try {
            await rename(stage, destination);
          } catch (failure) {
            await rename(backup, destination);
            throw failure;
          }
        }
      }
      await this.change((state) => {
        state.bots[pack.manifest.id] = {
          ...pack.manifest,
          source: pack.source,
          revision: pack.revision,
          installedAt: Date.now(),
          favorite: state.bots[pack.manifest.id]?.favorite ?? false,
        };
      });
      this.pending.delete(token);
      return this.get(pack.manifest.id);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  async favorite(id: string, favorite: boolean): Promise<void> {
    this.get(id);
    await this.change((state) => {
      if (state.bots[id]) state.bots[id].favorite = favorite;
    });
  }
  async remove(id: string): Promise<void> {
    this.get(id);
    // Retain immutable packages and conversation bindings so history can still resume.
    await this.change((state) => {
      delete state.bots[id];
    });
  }
  async bind(sessionId: string, binding: BotBinding): Promise<void> {
    await this.change((state) => {
      state.sessions[sessionId] = binding;
    });
  }
  async args(binding: BotBinding): Promise<string[]> {
    if (!/^[a-f0-9]{64}$/.test(binding.revision)) throw new Error('bot_package_read');
    const root = join(this.root, 'packages', binding.revision);
    let pack: BotPackage;
    try {
      pack = await readLocalPackage(root);
    } catch {
      throw new Error('bot_package_read');
    }
    if (pack.revision !== binding.revision || pack.manifest.id !== binding.id) throw new Error('bot_package_changed');
    if (this.missing(pack.manifest.requiredCapabilities).length) throw new Error('bot_tools_missing');
    const prompt = [
      `You are the user's selected Bot: ${pack.manifest.name}.`,
      pack.manifest.instructions,
      'Use the attached skills for this Bot. Read the relevant SKILL.md before performing its task; resolve its relative resources from its own directory.',
      'A skill describes a workflow, not proof that a tool or external service is available. Report missing capabilities instead of fabricating execution or results.',
    ].join('\n\n');
    return [
      '--no-skills',
      ...pack.manifest.skills.flatMap((skill) => ['--skill', join(root, skill)]),
      '--append-system-prompt',
      prompt,
    ];
  }
}
