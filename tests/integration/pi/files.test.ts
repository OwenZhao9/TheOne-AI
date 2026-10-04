import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitDiff, gitStatus } from '@/process/services/pi/content';

const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('shows changes relative to a selected subfolder without reading changes outside it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aionpi-git-test-'));
  roots.push(root);
  const cwd = join(root, 'nested');
  await mkdir(cwd);
  await execute('/usr/bin/git', ['init', '-q'], { cwd: root });
  await writeFile(join(cwd, 'tracked.txt'), 'before\n');
  await execute('/usr/bin/git', ['add', '.'], { cwd: root });
  await writeFile(join(cwd, 'tracked.txt'), 'after\n');
  await writeFile(join(cwd, 'untracked.txt'), 'inside');
  await writeFile(join(root, 'outside.txt'), 'outside');
  const status = await gitStatus(cwd);
  expect(status.files.map((file) => file.path).sort()).toEqual(['tracked.txt', 'untracked.txt']);
  expect(await gitDiff(cwd, 'tracked.txt')).toContain('+after');
  expect(await gitDiff(cwd, 'untracked.txt')).toBe('inside');
});
