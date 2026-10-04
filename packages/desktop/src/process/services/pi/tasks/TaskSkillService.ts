import type { Dirent } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PiSkillCandidate, PiSkillCatalog } from '@/common/pi';
import type { PiPaths } from '../paths';

const MAX_SKILL_BYTES = 2 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'CC-BY-4.0']);
const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const APPROVALS_FILE = 'task-skill-approvals.json';

type RegistryEntry = {
  name?: unknown;
  description?: unknown;
  version?: unknown;
  sourceUrl?: unknown;
  downloadUrl?: unknown;
  license?: unknown;
  compatibleAgents?: unknown;
  sha256?: unknown;
};
type Approval = { name: string; sourceUrl: string; sha256: string; approvedAt: number };

export class TaskSkillService {
  private approvals = new Map<string, Approval>();
  private rejected = new Set<string>();
  private online: PiSkillCandidate[] = [];
  private lastError?: string;

  constructor(
    private paths: PiPaths,
    private getRegistryUrl: () => string | undefined
  ) {}

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(join(this.paths.data, APPROVALS_FILE), 'utf8')) as unknown;
      const approvals = Array.isArray(saved)
        ? saved
        : saved && typeof saved === 'object' && Array.isArray((saved as { approvals?: unknown }).approvals)
          ? (saved as { approvals: unknown[] }).approvals
          : [];
      for (const item of approvals) {
        if (
          item &&
          typeof item === 'object' &&
          SAFE_NAME.test((item as Approval).name) &&
          typeof (item as Approval).sourceUrl === 'string' &&
          typeof (item as Approval).sha256 === 'string' &&
          /^[a-f0-9]{64}$/i.test((item as Approval).sha256) &&
          typeof (item as Approval).approvedAt === 'number'
        )
          this.approvals.set((item as Approval).name, item as Approval);
      }
      if (
        saved &&
        typeof saved === 'object' &&
        !Array.isArray(saved) &&
        Array.isArray((saved as { rejected?: unknown }).rejected)
      )
        for (const name of (saved as { rejected: unknown[] }).rejected)
          if (typeof name === 'string' && SAFE_NAME.test(name)) this.rejected.add(name);
      await this.migrateLegacyRemoteFiles();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('skill_approvals_read_failed');
    }
  }

  async refresh(): Promise<PiSkillCatalog> {
    const registryUrl = this.getRegistryUrl()?.trim();
    this.lastError = undefined;
    if (!registryUrl) {
      this.online = [];
      if (this.approvals.size) this.lastError = 'skill_registry_unavailable';
      return this.catalog();
    }
    let url: URL;
    try {
      url = new URL(registryUrl);
      if (url.protocol !== 'https:') throw new Error('skill_registry_https_required');
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'skill_registry_invalid';
      this.online = [];
      return this.catalog();
    }
    try {
      const response = await this.fetchBody(url, { accept: 'application/json' }, MAX_REGISTRY_BYTES, 'registry');
      const payload = JSON.parse(response.body.toString('utf8')) as { version?: unknown; skills?: unknown };
      if (payload.version !== 1 || !Array.isArray(payload.skills)) throw new Error('skill_registry_invalid');
      const registry = new URL(response.url || url.href);
      if (registry.protocol !== 'https:') throw new Error('skill_registry_https_required');
      const parsed = payload.skills
        .map((entry) => this.parseEntry(entry as RegistryEntry, registry))
        .filter((entry): entry is PiSkillCandidate => Boolean(entry));
      this.online = await Promise.all(
        parsed.map(async (entry) => ({
          ...entry,
          installed: await access(this.remoteSkillFile(entry.name))
            .then(() => true)
            .catch(() => false),
        }))
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'skill_registry_unavailable';
      this.online = [];
    }
    return this.catalog();
  }

  async catalog(): Promise<PiSkillCatalog> {
    return {
      ...(this.getRegistryUrl()?.trim() ? { registryUrl: this.getRegistryUrl()!.trim() } : {}),
      ...(this.online.length || this.lastError ? { fetchedAt: Date.now() } : {}),
      skills: [...this.online, ...(await this.persistedRemoteSkills()), ...(await this.localSkills())],
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async approve(name: string): Promise<PiSkillCatalog> {
    const candidate = this.online.find((item) => item.name === name);
    if (!candidate) throw new Error('task_skill_not_found');
    if (!candidate.trusted || candidate.compatibility !== 'compatible') throw new Error('task_skill_untrusted');
    if (!candidate.sourceUrl || !candidate.downloadUrl || !candidate.sha256)
      throw new Error('task_skill_integrity_missing');
    const response = await this.fetchBody(
      candidate.downloadUrl,
      { accept: 'text/markdown,text/plain' },
      MAX_SKILL_BYTES,
      'skill'
    );
    if (new URL(response.url || candidate.downloadUrl).origin !== new URL(candidate.downloadUrl).origin)
      throw new Error('task_skill_untrusted');
    const body = response.body;
    if (!body.length || body.length > MAX_SKILL_BYTES) throw new Error('task_skill_size_invalid');
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== candidate.sha256.toLowerCase()) throw new Error('task_skill_integrity_mismatch');
    const destination = join(this.paths.data, 'task-skills', candidate.name);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const file = join(destination, 'SKILL.md');
    await writeFile(`${file}.tmp`, body, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    this.approvals.set(name, {
      name,
      sourceUrl: candidate.sourceUrl,
      sha256: candidate.sha256.toLowerCase(),
      approvedAt: Date.now(),
    });
    this.rejected.delete(name);
    this.online = this.online.map((item) => (item.name === name ? { ...item, approved: true, installed: true } : item));
    await this.saveApprovals();
    return this.catalog();
  }

  async reject(name: string): Promise<PiSkillCatalog> {
    if (!SAFE_NAME.test(name)) throw new Error('task_skill_not_found');
    this.approvals.delete(name);
    this.rejected.add(name);
    await rm(join(this.paths.data, 'task-skills', name), { recursive: true, force: true });
    this.online = this.online.map((item) => (item.name === name ? { ...item, approved: false } : item));
    await this.migrateLegacyRemoteFiles();
    await this.saveApprovals();
    return this.catalog();
  }

  async resolve(name: string, cwd: string): Promise<string | undefined> {
    if (!SAFE_NAME.test(name)) return undefined;
    const online = this.online.find((item) => item.name === name);
    if (
      online?.approved &&
      online.installed &&
      online.trusted &&
      online.compatibility === 'compatible' &&
      !this.rejected.has(name)
    ) {
      const candidate = this.remoteSkillFile(name);
      if (
        await access(candidate)
          .then(() => true)
          .catch(() => false)
      ) {
        if (!(await this.verifyInstalledFile(candidate, online.sha256!)))
          throw new Error('task_skill_integrity_mismatch');
        return candidate;
      }
    }
    if (online)
      throw new Error(
        online.approved && !this.rejected.has(name) ? 'task_skill_unavailable' : 'task_skill_confirmation_required'
      );
    if (this.rejected.has(name)) throw new Error('task_skill_confirmation_required');
    if (this.approvals.has(name)) throw new Error('task_skill_registry_unavailable');
    const projectLocal = join(cwd, '.pi', 'skills', name, 'SKILL.md');
    if (
      await access(projectLocal)
        .then(() => true)
        .catch(() => false)
    )
      return projectLocal;
    const appLocal = join(this.paths.agent, 'skills', name, 'SKILL.md');
    if (
      await access(appLocal)
        .then(() => true)
        .catch(() => false)
    )
      return appLocal;
    return undefined;
  }

  private parseEntry(entry: RegistryEntry, registry: URL): PiSkillCandidate | undefined {
    const name = typeof entry.name === 'string' ? entry.name : '';
    const description = typeof entry.description === 'string' ? entry.description : '';
    const sourceUrl = typeof entry.sourceUrl === 'string' ? entry.sourceUrl : '';
    const downloadUrl = typeof entry.downloadUrl === 'string' ? entry.downloadUrl : '';
    const license = typeof entry.license === 'string' ? entry.license : '';
    const compatibleAgents = Array.isArray(entry.compatibleAgents)
      ? entry.compatibleAgents.filter((item): item is string => typeof item === 'string')
      : [];
    const sha256 = typeof entry.sha256 === 'string' ? entry.sha256.toLowerCase() : '';
    const version = typeof entry.version === 'string' ? entry.version : undefined;
    let trusted = false;
    let reason: string | undefined = 'skill_registry_entry_invalid';
    try {
      const source = new URL(sourceUrl);
      const download = new URL(downloadUrl);
      trusted =
        source.protocol === 'https:' &&
        download.protocol === 'https:' &&
        source.origin === registry.origin &&
        download.origin === registry.origin;
      if (!trusted) reason = 'skill_source_not_trusted';
      else if (!ALLOWED_LICENSES.has(license)) {
        trusted = false;
        reason = 'skill_license_not_allowed';
      } else if (!compatibleAgents.includes('pi') && !compatibleAgents.includes('all')) {
        trusted = false;
        reason = 'skill_agent_incompatible';
      } else if (!/^[a-f0-9]{64}$/.test(sha256)) {
        trusted = false;
        reason = 'skill_sha256_missing';
      } else reason = undefined;
    } catch {
      reason = 'skill_source_invalid';
    }
    if (!SAFE_NAME.test(name) || !description || !sourceUrl || !downloadUrl) return undefined;
    const approval = this.approvals.get(name);
    return {
      name,
      description,
      source: 'online',
      sourceUrl,
      downloadUrl,
      license,
      ...(version ? { version } : {}),
      compatibleAgents,
      ...(sha256 ? { sha256 } : {}),
      trusted,
      approved: Boolean(approval && approval.sourceUrl === sourceUrl && approval.sha256 === sha256),
      installed: false,
      compatibility:
        compatibleAgents.includes('pi') || compatibleAgents.includes('all')
          ? 'compatible'
          : compatibleAgents.length
            ? 'incompatible'
            : 'unknown',
      ...(reason ? { reason } : {}),
    };
  }

  private async localSkills(): Promise<PiSkillCandidate[]> {
    const onlineNames = new Set(this.online.map((skill) => skill.name));
    const entries = await readdir(join(this.paths.agent, 'skills'), { withFileTypes: true }).catch((): Dirent[] => []);
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          SAFE_NAME.test(entry.name) &&
          !onlineNames.has(entry.name) &&
          !this.approvals.has(entry.name) &&
          !this.rejected.has(entry.name)
      )
      .map((entry) => ({
        name: entry.name,
        description: 'Installed local skill',
        source: 'local' as const,
        location: join(this.paths.agent, 'skills', entry.name, 'SKILL.md'),
        compatibleAgents: ['pi'],
        trusted: true,
        approved: true,
        installed: true,
        compatibility: 'compatible' as const,
      }));
  }

  private saveApprovals(): Promise<void> {
    const file = join(this.paths.data, APPROVALS_FILE);
    return writeFile(
      `${file}.tmp`,
      JSON.stringify({ version: 1, approvals: [...this.approvals.values()], rejected: [...this.rejected] }, null, 2),
      { mode: 0o600 }
    ).then((): Promise<void> => rename(`${file}.tmp`, file));
  }

  private remoteSkillFile(name: string): string {
    return join(this.paths.data, 'task-skills', name, 'SKILL.md');
  }

  private async verifyInstalledFile(file: string, expected: string): Promise<boolean> {
    const info = await stat(file).catch((): undefined => undefined);
    if (!info || !info.isFile() || info.size > MAX_SKILL_BYTES) return false;
    const body = await readFile(file);
    return createHash('sha256').update(body).digest('hex') === expected.toLowerCase();
  }

  private async migrateLegacyRemoteFiles(): Promise<void> {
    const names = new Set([...this.approvals.keys(), ...this.rejected]);
    for (const name of names) {
      const legacy = join(this.paths.agent, 'skills', name);
      if (this.rejected.has(name)) await rm(this.remoteSkillFile(name), { recursive: true, force: true });
      if (
        !(await access(legacy)
          .then(() => true)
          .catch(() => false))
      )
        continue;
      if (this.rejected.has(name)) {
        const quarantine = join(this.paths.data, 'task-skills-quarantine', `${name}-${Date.now()}`);
        await mkdir(dirname(quarantine), { recursive: true, mode: 0o700 });
        await rename(legacy, quarantine);
        continue;
      }
      const destination = join(this.paths.data, 'task-skills', name);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      if (
        !(await access(destination)
          .then(() => true)
          .catch(() => false))
      )
        await rename(legacy, destination);
      else {
        const quarantine = join(this.paths.data, 'task-skills-quarantine', `${name}-${Date.now()}`);
        await mkdir(dirname(quarantine), { recursive: true, mode: 0o700 });
        await rename(legacy, quarantine);
      }
    }
  }

  private async persistedRemoteSkills(): Promise<PiSkillCandidate[]> {
    const onlineNames = new Set(this.online.map((skill) => skill.name));
    return [...this.approvals.values()]
      .filter((approval) => !onlineNames.has(approval.name))
      .map((approval) => ({
        name: approval.name,
        description: 'Installed online Skill; registry verification is required before use',
        source: 'online' as const,
        sourceUrl: approval.sourceUrl,
        compatibleAgents: ['pi'],
        sha256: approval.sha256,
        trusted: false,
        approved: true,
        installed: true,
        compatibility: 'unknown' as const,
        reason: 'skill_registry_unavailable',
      }));
  }

  private async fetchBody(
    url: URL | string,
    headers: Record<string, string>,
    maxBytes: number,
    kind: 'registry' | 'skill'
  ): Promise<{ body: Buffer; url: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers, redirect: 'error' });
      if (!response.ok)
        throw new Error(`${kind === 'registry' ? 'skill_registry' : 'task_skill_download'}_http_${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > maxBytes)
        throw new Error(maxBytes === MAX_SKILL_BYTES ? 'task_skill_size_invalid' : 'skill_registry_too_large');
      if (!response.body) throw new Error('skill_registry_body_unavailable');
      const reader = response.body.getReader();
      const chunks: Buffer[] = [];
      let total = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch((): undefined => undefined);
            throw new Error(maxBytes === MAX_SKILL_BYTES ? 'task_skill_size_invalid' : 'skill_registry_too_large');
          }
          chunks.push(Buffer.from(part.value));
        }
      } finally {
        reader.releaseLock();
      }
      return { body: Buffer.concat(chunks, total), url: response.url };
    } finally {
      clearTimeout(timer);
    }
  }
}
