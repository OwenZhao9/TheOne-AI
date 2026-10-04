import { readdir, readFile, writeFile, rename, stat, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  defaultPiLearningProfile,
  emptyView,
  messagesFromEntries,
  normalizePiLearningProfile,
  recordOf,
  textOf,
  validatePiLearningProfile,
  type PiTaskLimits,
  type PiTaskNode,
  type PiTaskUsage,
  type PiTaskTree,
  type JsonRecord,
  type PiLearningProfile,
  type PiConversation,
  type PiView,
} from '@/common/pi';
import type { PiPaths } from './paths';

export type StoredSession = {
  conversation: PiConversation;
  file?: string;
  view: PiView;
  entries: JsonRecord[];
  leafId?: string;
};

export class SessionStore {
  private sessions = new Map<string, StoredSession>();
  private learningProfiles = new Map<string, PiLearningProfile>();
  private pinned = new Set<string>();
  private revisions = new Map<string, number>();
  private writes: Promise<void> = Promise.resolve();
  private taskWrites: Promise<void> = Promise.resolve();
  private taskMutations: Promise<void> = Promise.resolve();
  private tasks: PiTaskTree = {
    version: 1,
    limits: {
      maxDepth: 3,
      maxTotalTasks: 12,
      maxConcurrent: 4,
      maxModelCalls: 24,
      maxInputTokens: 200000,
      maxOutputTokens: 100000,
    },
    nodes: [],
  };
  constructor(private paths: PiPaths) {}

  async load(): Promise<void> {
    try {
      this.pinned = new Set(JSON.parse(await readFile(join(this.paths.data, 'pins.json'), 'utf8')) as string[]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('settings_read_failed');
    }
    try {
      const profiles = JSON.parse(await readFile(join(this.paths.data, 'learning.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      for (const [id, value] of Object.entries(profiles))
        this.learningProfiles.set(id, normalizePiLearningProfile(value));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('settings_read_failed');
    }
    try {
      const drafts = JSON.parse(await readFile(join(this.paths.data, 'drafts.json'), 'utf8')) as PiConversation[];
      for (const conversation of drafts) {
        if (typeof conversation.id !== 'string' || typeof conversation.cwd !== 'string') continue;
        const learning = normalizePiLearningProfile(
          this.learningProfiles.get(conversation.id) || conversation.learning
        );
        this.learningProfiles.set(conversation.id, learning);
        this.sessions.set(conversation.id, {
          conversation: { ...conversation, learning, running: false, pinned: this.pinned.has(conversation.id) },
          entries: [],
          view: emptyView(),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('settings_read_failed');
    }
    try {
      const saved = JSON.parse(await readFile(join(this.paths.data, 'task-tree.json'), 'utf8')) as Partial<PiTaskTree>;
      if (saved.version === 1 && Array.isArray(saved.nodes)) {
        const limits = saved.limits;
        this.tasks = {
          version: 1,
          limits: {
            maxDepth: this.positiveLimit(limits?.maxDepth, 3),
            maxTotalTasks: this.positiveLimit(limits?.maxTotalTasks, 12),
            maxConcurrent: this.positiveLimit(limits?.maxConcurrent, 4),
            maxModelCalls: this.positiveLimit(limits?.maxModelCalls, 24),
            maxInputTokens: this.positiveLimit(limits?.maxInputTokens, 200000, 100_000_000),
            maxOutputTokens: this.positiveLimit(limits?.maxOutputTokens, 100000, 100_000_000),
            ...(typeof limits?.maxCostUsd === 'number' && Number.isFinite(limits.maxCostUsd) && limits.maxCostUsd > 0
              ? { maxCostUsd: limits.maxCostUsd }
              : {}),
          },
          nodes: saved.nodes
            .map((node) => this.normalizeTaskNode(node))
            .filter((node): node is PiTaskNode => Boolean(node)),
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('settings_read_failed');
    }
    await this.refresh();
    const sessionIds = new Set(this.sessions.keys());
    this.tasks.nodes = this.tasks.nodes.filter((node) => sessionIds.has(node.sessionId));
  }

  private positiveLimit(value: unknown, fallback: number, maximum = 100): number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
  }

  private normalizeTaskNode(value: unknown): PiTaskNode | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const node = value as Partial<PiTaskNode>;
    if (
      !(
        typeof node.sessionId === 'string' &&
        typeof node.rootSessionId === 'string' &&
        (node.parentSessionId === undefined || typeof node.parentSessionId === 'string') &&
        typeof node.title === 'string' &&
        typeof node.objective === 'string' &&
        typeof node.reason === 'string' &&
        Array.isArray(node.deliverables) &&
        node.deliverables.every((item) => typeof item === 'string') &&
        Array.isArray(node.dependencies) &&
        node.dependencies.every((item) => typeof item === 'string') &&
        (node.candidateBot === undefined || typeof node.candidateBot === 'string') &&
        Array.isArray(node.candidateSkills) &&
        node.candidateSkills.every((item) => typeof item === 'string') &&
        ['waiting', 'running', 'failed', 'completed', 'stopped'].includes(node.status || '') &&
        typeof node.depth === 'number' &&
        typeof node.createdAt === 'number' &&
        typeof node.updatedAt === 'number' &&
        (node.stopRequested === undefined || typeof node.stopRequested === 'boolean') &&
        (node.result === undefined || typeof node.result === 'string') &&
        (node.error === undefined || typeof node.error === 'string')
      )
    )
      return undefined;
    const acceptance =
      node.acceptance?.status && ['pending', 'verified', 'rejected'].includes(node.acceptance.status)
        ? node.acceptance
        : { status: 'pending' as const };
    const usage =
      node.usage && typeof node.usage === 'object'
        ? {
            modelCalls: this.nonNegative(node.usage.modelCalls),
            inputTokens: this.nonNegative(node.usage.inputTokens),
            outputTokens: this.nonNegative(node.usage.outputTokens),
            ...(typeof node.usage.costUsd === 'number' && Number.isFinite(node.usage.costUsd)
              ? { costUsd: node.usage.costUsd }
              : {}),
            costKnown: node.usage.costKnown === true,
          }
        : { modelCalls: 0, inputTokens: 0, outputTokens: 0, costKnown: false };
    return {
      ...node,
      sessionId: node.sessionId,
      rootSessionId: node.rootSessionId,
      title: node.title,
      objective: node.objective,
      reason: node.reason,
      deliverables: node.deliverables,
      dependencies: node.dependencies,
      candidateSkills: node.candidateSkills,
      status: node.status as PiTaskNode['status'],
      depth: node.depth,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      acceptanceCriteria:
        Array.isArray(node.acceptanceCriteria) && node.acceptanceCriteria.every((item) => typeof item === 'string')
          ? node.acceptanceCriteria
          : node.deliverables,
      ownedPaths:
        Array.isArray(node.ownedPaths) && node.ownedPaths.every((item) => typeof item === 'string')
          ? node.ownedPaths
          : [],
      acceptance,
      usage,
      revision: this.positiveLimit(node.revision, 1, 1_000_000),
      contextVersion:
        typeof node.contextVersion === 'string' && node.contextVersion
          ? node.contextVersion
          : `legacy:${node.sessionId}`,
      dependencyRevisions:
        node.dependencyRevisions &&
        typeof node.dependencyRevisions === 'object' &&
        !Array.isArray(node.dependencyRevisions)
          ? Object.fromEntries(
              Object.entries(node.dependencyRevisions).filter(([, revision]) => typeof revision === 'number')
            )
          : {},
      resumeState:
        node.resumeState === 'needs_confirmation'
          ? 'needs_confirmation'
          : node.resumeState === 'safe'
            ? 'safe'
            : 'none',
    };
  }

  private nonNegative(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }

  async refresh(): Promise<void> {
    const files = (await readdir(this.paths.sessions, { recursive: true })).filter((n) => n.endsWith('.jsonl'));
    const present = new Set(files.map((f) => join(this.paths.sessions, f)));
    for (const [id, item] of this.sessions)
      if (item.file && this.revisions.has(item.file) && !present.has(item.file)) this.sessions.delete(id);
    for (const name of files) {
      const file = join(this.paths.sessions, name);
      const revision = (await stat(file)).mtimeMs;
      if (this.revisions.get(file) === revision) continue;
      try {
        const content = await readFile(file, 'utf8');
        const lines = content.split('\n');
        // A process may currently be appending its last record.
        if (!content.endsWith('\n')) lines.pop();
        const entries = lines.filter(Boolean).map((line) => recordOf(JSON.parse(line)));
        const header = entries.find((e) => e.type === 'session');
        if (!header?.id || !header.cwd) continue;
        const id = String(header.id);
        const leafId = textOf(entries.at(-1)?.id);
        const messages = messagesFromEntries(entries, leafId);
        const title = [...entries].reverse().find((e) => e.type === 'session_info' && e.name)?.name;
        const first = messages.find((m) => m.role === 'user')?.content.find((b) => b.type === 'text')?.text;
        const model = [...entries].reverse().find((e) => e.type === 'model_change');
        const thinking = [...entries].reverse().find((e) => e.type === 'thinking_level_change');
        const old = this.sessions.get(id);
        this.sessions.set(id, {
          file,
          entries,
          leafId,
          conversation: {
            id,
            cwd: String(header.cwd),
            title: textOf(title) || (first || '').split('\n')[0].slice(0, 90),
            updatedAt: revision,
            messageCount: messages.length,
            running: old?.conversation.running ?? false,
            pinned: this.pinned.has(id),
            learning: this.learningProfiles.get(id) || defaultPiLearningProfile(),
          },
          view: {
            ...emptyView(),
            messages,
            model: model ? { id: textOf(model.modelId), provider: textOf(model.provider) } : undefined,
            thinkingLevel: textOf(thinking?.thinkingLevel),
          },
        });
        this.revisions.set(file, revision);
      } catch {
        /* A corrupt session cannot prevent other sessions from opening. */
      }
    }
  }

  list(): PiConversation[] {
    return [...this.sessions.values()]
      .map((s) => s.conversation)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }
  get(id: string): StoredSession {
    const item = this.sessions.get(id);
    if (!item) throw new Error('session_missing');
    return item;
  }

  async create(cwd: string): Promise<StoredSession> {
    const folder = await realpath(cwd).catch(() => {
      throw new Error('folder_missing');
    });
    if (!(await stat(folder)).isDirectory()) throw new Error('folder_missing');
    const id = randomUUID();
    const item: StoredSession = {
      conversation: {
        id,
        cwd: folder,
        title: '',
        updatedAt: Date.now(),
        messageCount: 0,
        running: false,
        pinned: false,
        learning: defaultPiLearningProfile(),
      },
      view: emptyView(),
      entries: [],
    };
    this.sessions.set(id, item);
    this.learningProfiles.set(id, item.conversation.learning!);
    await this.saveDrafts();
    return item;
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    this.get(id).conversation.pinned = pinned;
    if (pinned) this.pinned.add(id);
    else this.pinned.delete(id);
    await writeFile(join(this.paths.data, 'pins.json.tmp'), JSON.stringify([...this.pinned]), { mode: 0o600 });
    await rename(join(this.paths.data, 'pins.json.tmp'), join(this.paths.data, 'pins.json'));
  }

  async remove(id: string, trash: (path: string) => Promise<void>): Promise<void> {
    const item = this.get(id);
    if (item.file) {
      const exists = await stat(item.file)
        .then(() => true)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        });
      if (exists) await trash(item.file);
    }
    await this.pin(id, false);
    this.sessions.delete(id);
    this.learningProfiles.delete(id);
    await this.saveLearningProfiles();
    await this.saveDrafts();
  }

  async setLearning(id: string, value: unknown): Promise<void> {
    this.get(id);
    const learning = validatePiLearningProfile(value);
    const operation = this.writes
      .catch((): void => {})
      .then(async () => {
        const item = this.get(id);
        const profiles = new Map(this.learningProfiles);
        profiles.set(id, learning);
        const file = join(this.paths.data, 'learning.json');
        await writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(profiles)), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
        // Publish only durable settings; failed writes must leave the prior level intact.
        this.learningProfiles = profiles;
        item.conversation.learning = learning;
      });
    this.writes = operation;
    await operation;
  }

  bind(id: string, file?: string): void {
    if (file && basename(file).endsWith('.jsonl')) this.get(id).file = file;
  }

  /** Only unsaved session metadata is stored here. Pi remains the transcript source. */
  saveDrafts(): Promise<void> {
    const drafts = [...this.sessions.values()]
      .filter((item) => !item.file || !this.revisions.has(item.file))
      .map((item) => item.conversation);
    this.writes = this.writes
      .catch((): void => {})
      .then(async () => {
        const file = join(this.paths.data, 'drafts.json');
        await writeFile(`${file}.tmp`, JSON.stringify(drafts), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
    return this.writes;
  }

  private saveLearningProfiles(): Promise<void> {
    this.writes = this.writes
      .catch((): void => {})
      .then(async () => {
        const file = join(this.paths.data, 'learning.json');
        await writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(this.learningProfiles)), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
    return this.writes;
  }

  taskTree(): PiTaskTree {
    return structuredClone(this.tasks);
  }

  taskNode(sessionId: string): PiTaskNode | undefined {
    return this.tasks.nodes.find((node) => node.sessionId === sessionId);
  }

  taskLimits(): PiTaskLimits {
    return { ...this.tasks.limits };
  }

  async upsertTask(node: PiTaskNode): Promise<void> {
    await this.enqueueTaskMutation(async () => {
      const index = this.tasks.nodes.findIndex((item) => item.sessionId === node.sessionId);
      if (index >= 0) this.tasks.nodes[index] = node;
      else this.tasks.nodes.push(node);
      await this.saveTasks();
    });
  }

  async updateTask(
    sessionId: string,
    patch: Partial<
      Pick<
        PiTaskNode,
        | 'status'
        | 'stopRequested'
        | 'result'
        | 'error'
        | 'title'
        | 'acceptance'
        | 'usage'
        | 'resumeState'
        | 'userModifiedAt'
        | 'needsRevalidation'
        | 'dependencyRevisions'
        | 'contextVersion'
        | 'research'
      >
    >
  ): Promise<void> {
    await this.enqueueTaskMutation(async () => {
      const current = this.taskNode(sessionId);
      if (!current) return;
      this.tasks.nodes[this.tasks.nodes.indexOf(current)] = {
        ...current,
        ...patch,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      await this.saveTasks();
    });
  }

  async updateTaskIfRevision(
    sessionId: string,
    expectedRevision: number,
    patch: Partial<
      Pick<
        PiTaskNode,
        | 'status'
        | 'stopRequested'
        | 'result'
        | 'error'
        | 'title'
        | 'acceptance'
        | 'usage'
        | 'resumeState'
        | 'userModifiedAt'
        | 'needsRevalidation'
        | 'dependencyRevisions'
        | 'contextVersion'
        | 'research'
      >
    >
  ): Promise<boolean> {
    return this.enqueueTaskMutation(async () => {
      const current = this.taskNode(sessionId);
      if (!current || current.revision !== expectedRevision) return false;
      this.tasks.nodes[this.tasks.nodes.indexOf(current)] = {
        ...current,
        ...patch,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      await this.saveTasks();
      return true;
    });
  }

  async incrementTaskModelCalls(sessionId: string): Promise<PiTaskUsage | undefined> {
    return this.enqueueTaskMutation(async () => {
      const current = this.taskNode(sessionId);
      if (!current) return undefined;
      const usage = { ...current.usage, modelCalls: current.usage.modelCalls + 1 };
      this.tasks.nodes[this.tasks.nodes.indexOf(current)] = {
        ...current,
        usage,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      await this.saveTasks();
      return usage;
    });
  }

  async mergeTaskUsage(sessionId: string, usage: PiTaskUsage): Promise<PiTaskUsage | undefined> {
    return this.enqueueTaskMutation(async () => {
      const current = this.taskNode(sessionId);
      if (!current) return undefined;
      const merged: PiTaskUsage = {
        modelCalls: Math.max(current.usage.modelCalls, usage.modelCalls),
        inputTokens: Math.max(current.usage.inputTokens, usage.inputTokens),
        outputTokens: Math.max(current.usage.outputTokens, usage.outputTokens),
        ...(current.usage.costUsd !== undefined || usage.costUsd !== undefined
          ? { costUsd: Math.max(current.usage.costUsd || 0, usage.costUsd || 0) }
          : {}),
        costKnown: current.usage.costKnown || usage.costKnown,
      };
      this.tasks.nodes[this.tasks.nodes.indexOf(current)] = {
        ...current,
        usage: merged,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
      await this.saveTasks();
      return merged;
    });
  }

  async updateTaskLimits(limits: PiTaskLimits): Promise<void> {
    await this.enqueueTaskMutation(async () => {
      this.tasks.limits = {
        maxDepth: this.positiveLimit(limits.maxDepth, this.tasks.limits.maxDepth),
        maxTotalTasks: this.positiveLimit(limits.maxTotalTasks, this.tasks.limits.maxTotalTasks),
        maxConcurrent: this.positiveLimit(limits.maxConcurrent, this.tasks.limits.maxConcurrent),
        maxModelCalls: this.positiveLimit(limits.maxModelCalls, this.tasks.limits.maxModelCalls),
        maxInputTokens: this.positiveLimit(limits.maxInputTokens, this.tasks.limits.maxInputTokens, 100_000_000),
        maxOutputTokens: this.positiveLimit(limits.maxOutputTokens, this.tasks.limits.maxOutputTokens, 100_000_000),
        ...(typeof limits.maxCostUsd === 'number' && Number.isFinite(limits.maxCostUsd) && limits.maxCostUsd > 0
          ? { maxCostUsd: limits.maxCostUsd }
          : {}),
      };
      await this.saveTasks();
    });
  }

  async removeTaskTree(sessionId: string): Promise<void> {
    const remove = new Set<string>([sessionId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.tasks.nodes) {
        if (node.parentSessionId && remove.has(node.parentSessionId) && !remove.has(node.sessionId)) {
          remove.add(node.sessionId);
          changed = true;
        }
      }
    }
    await this.enqueueTaskMutation(async () => {
      this.tasks.nodes = this.tasks.nodes.filter((node) => !remove.has(node.sessionId));
      await this.saveTasks();
    });
  }

  private enqueueTaskMutation<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.taskMutations.then(action, action);
    this.taskMutations = operation.then(
      (): void => {},
      (): void => {}
    );
    return operation;
  }

  private saveTasks(): Promise<void> {
    this.taskWrites = this.taskWrites
      .catch((): void => {})
      .then(async () => {
        const file = join(this.paths.data, 'task-tree.json');
        await writeFile(`${file}.tmp`, JSON.stringify(this.tasks), { mode: 0o600 });
        await rename(`${file}.tmp`, file);
      });
    return this.taskWrites;
  }
}
