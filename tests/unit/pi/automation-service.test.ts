import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hasRequiredCuaPermissions, parseJevApiKey } from '@/process/extensions/automation/AutomationService';
import { AutomationService } from '@/process/extensions/automation/AutomationService';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AutomationService Jev environment loading', () => {
  it('reads a quoted key from a Jev .env file without exposing the file contents', () => {
    expect(parseJevApiKey('OTHER=value\nTYPESAFE_API_KEY="test-key"\n')).toBe('test-key');
  });

  it('supports export syntax and ignores an inline comment for an unquoted key', () => {
    expect(parseJevApiKey('export TYPESAFE_API_KEY=test-key # local Jev key\n')).toBe('test-key');
  });

  it('returns an empty value when the Jev key is absent', () => {
    expect(parseJevApiKey('JEV_PROJECT_DIR=/tmp/jev\n')).toBe('');
  });

  it('passes the configured project directory and its .env key to every Pi session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-automation-'));
    roots.push(root);
    const data = join(root, 'data');
    const project = join(root, 'jev');
    await mkdir(data, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(data, 'automation.json'), JSON.stringify({ judgeMode: 'shadow', jevProjectDir: project }));
    await writeFile(join(project, '.env'), 'TYPESAFE_API_KEY="from-jev-env"\n');

    const service = new AutomationService(
      {
        data,
        agent: join(root, 'agent'),
        sessions: join(root, 'sessions'),
        runtime: resolve('resources/aionpi-runtime'),
        node: '',
        cli: '',
        helper: '',
      },
      { seal: (value) => value, open: (value) => value }
    );
    await service.load();

    expect(service.environment()).toMatchObject({
      JEV_PROJECT_DIR: project,
      TYPESAFE_API_KEY: 'from-jev-env',
    });
  });
});

describe('AutomationService Cua permission detection', () => {
  it('accepts the current Cua Driver boolean permission response', () => {
    expect(hasRequiredCuaPermissions({ accessibility: true, screen_recording: true })).toBe(true);
    expect(hasRequiredCuaPermissions({ accessibility: true, screen_recording: false })).toBe(false);
  });

  it('keeps compatibility with the legacy granted response', () => {
    expect(hasRequiredCuaPermissions({ status: 'granted' })).toBe(true);
    expect(hasRequiredCuaPermissions({ status: 'denied' })).toBe(false);
  });
});
