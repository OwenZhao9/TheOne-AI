import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskSkillService } from '@/process/services/pi/tasks/TaskSkillService';
import { piPaths } from '@/process/services/pi/paths';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(registryUrl: string | undefined = 'https://skills.example/registry.json') {
  const root = await mkdtemp(join(tmpdir(), 'aionpi-skill-test-'));
  roots.push(root);
  const paths = piPaths(join(root, 'data'), join(root, 'runtime'));
  await mkdir(paths.data, { recursive: true });
  return { paths, service: new TaskSkillService(paths, () => registryUrl) };
}

function registry(body: Buffer) {
  const sha256 = createHash('sha256').update(body).digest('hex');
  return {
    version: 1,
    skills: [
      {
        name: 'review-helper',
        description: 'Review helper',
        version: '1.0.0',
        sourceUrl: 'https://skills.example/review-helper',
        downloadUrl: 'https://skills.example/review-helper/SKILL.md',
        license: 'MIT',
        compatibleAgents: ['pi'],
        sha256,
      },
    ],
  };
}

describe('TaskSkillService trust boundary', () => {
  it('keeps approved remote skills out of the global local-skill scan and revokes them across restart', async () => {
    const body = Buffer.from('# review helper\n');
    const payload = registry(body);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        if (String(input).endsWith('/registry.json')) return new Response(JSON.stringify(payload), { status: 200 });
        return new Response(body, { status: 200 });
      })
    );
    const first = await setup();
    await first.service.load();
    await first.service.refresh();
    await first.service.approve('review-helper');
    expect(await first.service.resolve('review-helper', join(first.paths.data, 'project'))).toContain('task-skills');
    await expect(access(join(first.paths.agent, 'skills', 'review-helper'))).rejects.toThrow();

    // Simulate a legacy install from the old global directory before rejection.
    await mkdir(join(first.paths.agent, 'skills', 'review-helper'), { recursive: true });
    await writeFile(join(first.paths.agent, 'skills', 'review-helper', 'SKILL.md'), body);
    await first.service.reject('review-helper');
    expect(
      (await first.service.catalog()).skills.some((skill) => skill.name === 'review-helper' && skill.source === 'local')
    ).toBe(false);
    await expect(access(join(first.paths.data, 'task-skills', 'review-helper'))).rejects.toThrow();

    const restarted = new TaskSkillService(first.paths, () => undefined);
    await restarted.load();
    await restarted.refresh();
    expect(
      (await restarted.catalog()).skills.some((skill) => skill.name === 'review-helper' && skill.source === 'local')
    ).toBe(false);
    await expect(restarted.resolve('review-helper', join(first.paths.data, 'project'))).rejects.toThrow(
      'task_skill_confirmation_required'
    );
  });

  it('requires registry verification after restart when the network is unavailable', async () => {
    const body = Buffer.from('# review helper\n');
    const payload = registry(body);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) =>
        String(input).endsWith('/registry.json')
          ? new Response(JSON.stringify(payload), { status: 200 })
          : new Response(body, { status: 200 })
      )
    );
    const first = await setup();
    await first.service.load();
    await first.service.refresh();
    await first.service.approve('review-helper');

    const restarted = new TaskSkillService(first.paths, () => 'https://skills.example/registry.json');
    await restarted.load();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await restarted.refresh();
    await expect(restarted.resolve('review-helper', join(first.paths.data, 'project'))).rejects.toThrow(
      'task_skill_registry_unavailable'
    );
  });

  it('rejects a modified approved file before handing it to Pi', async () => {
    const body = Buffer.from('# review helper\n');
    const payload = registry(body);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) =>
        String(input).endsWith('/registry.json')
          ? new Response(JSON.stringify(payload), { status: 200 })
          : new Response(body, { status: 200 })
      )
    );
    const { paths, service } = await setup();
    await service.load();
    await service.refresh();
    await service.approve('review-helper');
    const file = join(paths.data, 'task-skills', 'review-helper', 'SKILL.md');
    await writeFile(file, '# changed\n');
    await expect(service.resolve('review-helper', join(paths.data, 'project'))).rejects.toThrow(
      'task_skill_integrity_mismatch'
    );
    expect(await readFile(file, 'utf8')).toBe('# changed\n');
  });

  it('bounds registry and skill response bodies instead of trusting headers alone', async () => {
    const body = Buffer.from('# review helper\n');
    const payload = registry(body);
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    let download = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: URL | string) => {
        if (String(input).endsWith('/registry.json')) return new Response(JSON.stringify(payload), { status: 200 });
        download = true;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(oversized);
              controller.close();
            },
          }),
          { status: 200 }
        );
      })
    );
    const { service } = await setup();
    await service.load();
    await service.refresh();
    await expect(service.approve('review-helper')).rejects.toThrow('task_skill_size_invalid');
    expect(download).toBe(true);
  });
});
