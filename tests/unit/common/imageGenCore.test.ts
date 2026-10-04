/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { processImageUri, saveGeneratedImage, executeImageGeneration } from '@/common/chat/imageGenCore';

let cleanupDirs: string[] = [];

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aionui-image-gen-test-'));
  cleanupDirs.push(dir);
  return dir;
}

function createImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, PNG_1x1);
  return filePath;
}

function createNonImageFile(dir: string, name: string): string {
  const filePath = join(dir, name);
  writeFileSync(filePath, 'hello world');
  return filePath;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of cleanupDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  cleanupDirs = [];
});

// Minimal valid 1×1 PNG
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const DATA_URL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('processImageUri', () => {
  it('should fetch an HTTP image with a bounded response and convert it to data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(PNG_1x1, { headers: { 'content-type': 'image/png' } }))
    );

    const result = await processImageUri('https://example.com/photo.png', '/nonexistent');

    expect(result?.type).toBe('image_url');
    expect(result?.image_url.url).toContain('data:image/png;base64,');
    vi.unstubAllGlobals();
  });

  it('should resolve a relative path within the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    const result = await processImageUri('test.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
    expect(result!.image_url.url).toContain('base64');
  });

  it('should resolve a path with @ prefix within the workspace', async () => {
    const ws = createWorkspace();
    createImageFile(ws, 'test.png');

    const result = await processImageUri('@test.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should block path traversal via ../ from escaping the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('../../../etc/passwd', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block path traversal for ".." (parent without trailing path)', async () => {
    const ws = createWorkspace();
    // ".." triggers relative !== '..' short-circuit branch in isWithin
    await expect(processImageUri('..', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block absolute path outside the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('/etc/passwd', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should allow an absolute path that is inside the workspace', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'test.png');

    const result = await processImageUri(imgPath, ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should reject a non-image file even when within the workspace', async () => {
    const ws = createWorkspace();
    createNonImageFile(ws, 'notes.txt');

    await expect(processImageUri('notes.txt', ws)).rejects.toThrow('not a supported image type');
  });

  it('should resolve a "." path to the workspace directory itself', async () => {
    const ws = createWorkspace();
    // "." resolves to workspace dir — isWithin returns true via relative === '' branch
    await expect(processImageUri('.', ws)).rejects.toThrow('not a supported image type');
  });

  it('should resolve a path with dot segments within the workspace', async () => {
    const ws = createWorkspace();
    const subDir = join(ws, 'subdir');
    mkdirSync(subDir);
    createImageFile(subDir, 'image.png');

    const result = await processImageUri('subdir/../subdir/image.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });

  it('should reject a missing file within the workspace', async () => {
    const ws = createWorkspace();

    await expect(processImageUri('nonexistent.png', ws)).rejects.toThrow('Image file not found');
  });

  it('should block a symlink inside the workspace that points outside', async () => {
    const ws = createWorkspace();
    // Secret image lives outside the workspace; a symlink inside the workspace
    // points to it. The lexical containment check passes for the link path, but
    // realpath must reveal the escape and block the read.
    const outsideDir = createWorkspace();
    const secretImg = createImageFile(outsideDir, 'secret.png');
    symlinkSync(secretImg, join(ws, 'linked.png'));

    await expect(processImageUri('linked.png', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should block a symlinked directory inside the workspace that points outside', async () => {
    const ws = createWorkspace();
    const outsideDir = createWorkspace();
    createImageFile(outsideDir, 'secret.png');
    symlinkSync(outsideDir, join(ws, 'linked-dir'), 'dir');

    await expect(processImageUri('linked-dir/secret.png', ws)).rejects.toThrow('Path traversal blocked');
  });

  it('should allow a symlink inside the workspace that stays inside', async () => {
    const ws = createWorkspace();
    const imgPath = createImageFile(ws, 'real.png');
    symlinkSync(imgPath, join(ws, 'alias.png'));

    const result = await processImageUri('alias.png', ws);

    expect(result).toBeDefined();
    expect(result!.type).toBe('image_url');
  });
});

describe('saveGeneratedImage', () => {
  it('should save an image to the workspace directory', async () => {
    const ws = createWorkspace();

    const filePath = await saveGeneratedImage(DATA_URL_PNG, ws);

    expect(filePath.startsWith(ws)).toBe(true);
    expect(filePath).toMatch(/img-\d+\.png$/);
  });

  it('should resolve a workspace directory with trailing dot segments', async () => {
    const ws = createWorkspace();
    const subDir = join(ws, 'sub');
    mkdirSync(subDir);
    const trickyDir = join(ws, 'sub', '..', 'sub', '.');

    const filePath = await saveGeneratedImage(DATA_URL_PNG, trickyDir);

    expect(filePath.startsWith(pathResolve(ws))).toBe(true);
  });

  it('should not overwrite an earlier image when callbacks share a timestamp', async () => {
    const ws = createWorkspace();

    const first = await saveGeneratedImage(DATA_URL_PNG, ws);
    const second = await saveGeneratedImage(DATA_URL_PNG, ws);

    expect(second).not.toBe(first);
  });

  it('should reject an oversized data URL before writing it', async () => {
    const ws = createWorkspace();
    const oversized = `data:image/png;base64,${'A'.repeat(35_000_000)}`;

    await expect(saveGeneratedImage(oversized, ws)).rejects.toThrow('exceeds 25 MB');
  });
});

describe('executeImageGeneration', () => {
  it('uses the Ark image-generation endpoint and saves the returned image', async () => {
    const ws = createWorkspace();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ b64_json: DATA_URL_PNG.split(',', 2)[1] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    );

    const result = await executeImageGeneration(
      { prompt: 'a red paper lantern' },
      {
        id: 'theone-image-generation',
        name: 'TheOne image generation',
        platform: 'volcengine',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'test-image-key',
        use_model: 'doubao-seedream-5-0-flash-260915',
      },
      ws
    );

    expect(result.success).toBe(true);
    expect(result.relativeImagePath).toMatch(/^img-\d+\.png$/);
    const request = vi.mocked(fetch).mock.calls[0];
    expect(request[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      model: 'doubao-seedream-5-0-flash-260915',
      size: '2K',
      response_format: 'url',
      stream: false,
    });
  });

  it('rejects an oversized Ark JSON response before parsing or saving', async () => {
    const ws = createWorkspace();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{}', { status: 200, headers: { 'content-length': String(25 * 1024 * 1024 + 1) } })
        )
    );
    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      {
        id: 'theone-image-generation',
        name: 'TheOne image generation',
        platform: 'volcengine',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'test-image-key',
        use_model: 'doubao-seedream-5-0-flash-260915',
      },
      ws
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds 25 MB');
  });

  it('does not send an Ark request when already aborted', async () => {
    const ws = createWorkspace();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      {
        id: 'theone-image-generation',
        name: 'TheOne image generation',
        platform: 'volcengine',
        base_url: 'https://ark.cn-beijing.volces.com/api/v3',
        api_key: 'test-image-key',
        use_model: 'doubao-seedream-5-0-flash-260915',
      },
      ws,
      undefined,
      controller.signal
    );
    expect(result.error).toBe('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should return error for a non-existent workspace directory', async () => {
    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      { id: 'test', name: 'test', platform: 'openai', base_url: '', api_key: 'sk-test', use_model: 'dall-e-3' },
      '/nonexistent/workspace'
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain('not found');
  });

  it('should return error when workspace path is a file, not a directory', async () => {
    const ws = createWorkspace();
    const filePath = createImageFile(ws, 'not-a-dir.png');

    const result = await executeImageGeneration(
      { prompt: 'a cat' },
      { id: 'test', name: 'test', platform: 'openai', base_url: '', api_key: 'sk-test', use_model: 'dall-e-3' },
      filePath
    );

    expect(result.success).toBe(false);
    expect(result.text).toContain('not a directory');
  });
});
