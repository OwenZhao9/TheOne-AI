import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageGenerationConfigService } from '@/process/services/pi/ImageGenerationConfigService';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ImageGenerationConfigService', () => {
  it('stores the independent config with an encrypted key and redacts it from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-image-config-'));
    roots.push(root);
    const script = join(root, 'builtin-mcp-image-gen.js');
    await access(script).catch(async () => writeFile(script, ''));
    const service = new ImageGenerationConfigService(
      {
        data: root,
        agent: join(root, 'agent'),
        sessions: join(root, 'sessions'),
        runtime: root,
        node: process.execPath,
        cli: script,
        helper: script,
        builtinImageGenScript: script,
      },
      {
        seal: (value) => Buffer.from(value).toString('base64'),
        open: (value) => Buffer.from(value, 'base64').toString('utf8'),
      }
    );
    await service.load();
    expect(service.get()).toMatchObject({
      provider: 'volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-5-0-flash-260915',
      enabled: true,
      configured: false,
    });

    await service.save({
      provider: 'volcengine',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      model: 'doubao-seedream-5-0-flash-260915',
      apiKey: 'test-image-key',
      enabled: true,
    });
    expect(service.get()).toMatchObject({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', configured: true });
    const stored = await readFile(join(root, 'image-generation.json'), 'utf8');
    expect(stored).toContain(Buffer.from('test-image-key').toString('base64'));
    expect(stored).not.toContain('test-image-key');

    await service.prepareAgent(join(root, 'agent'));
    const mcp = JSON.parse(await readFile(join(root, 'agent/mcp.json'), 'utf8'));
    expect(mcp.mcpServers['theone-image-generation']).toMatchObject({
      command: process.execPath,
      exposure: 'direct',
      enabled: true,
      toolExposure: { aionui_image_generation: 'direct' },
    });
    expect(mcp.mcpServers['theone-image-generation'].env.AIONUI_IMG_API_KEY).toBe('${THEONE_IMAGE_API_KEY}');

    const importPath = join(root, 'image-config-import.json');
    await writeFile(
      importPath,
      JSON.stringify({
        provider: 'volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seedream-5-0-flash-260915',
        apiKey: 'imported-image-key',
        enabled: true,
      })
    );
    const imported = await service.importFromFile(importPath);
    expect(imported).toMatchObject({ configured: true, model: 'doubao-seedream-5-0-flash-260915' });
    expect(await readFile(join(root, 'image-generation.json'), 'utf8')).not.toContain('imported-image-key');
  });
});
