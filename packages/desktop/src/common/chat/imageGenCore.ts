/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared image generation logic used by both:
 * - The built-in MCP server (imageGenServer.ts)
 * - The legacy Gemini-specific tool (img-gen.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { jsonrepair } from 'jsonrepair';
import type OpenAI from 'openai';
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import type { TProviderWithModel } from '@/common/config/storage';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, MIME_TO_EXT_MAP, DEFAULT_IMAGE_EXTENSION } from '@/common/config/constants';

const API_TIMEOUT_MS = 120000; // 2 minutes for image generation API calls
const IMAGE_DOWNLOAD_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

// ===== Path Boundary Helpers =====

const isWithin = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/**
 * Resolve `candidate` against `workspaceDir` and verify the result stays inside
 * the workspace. A lexical containment check always applies; when the target
 * exists, it is additionally canonicalized with `realpath` so symlinks inside
 * the workspace cannot escape to arbitrary files outside it. Missing targets
 * resolve lexically — the caller's existence check reports "not found".
 */
const resolveSafePath = async (workspaceDir: string, candidate: string): Promise<string> => {
  const resolved = path.resolve(workspaceDir, candidate);
  if (!isWithin(workspaceDir, resolved)) {
    throw new Error(`Path traversal blocked: "${candidate}" resolves outside workspace`);
  }

  const realWorkspaceDir = await fs.promises.realpath(workspaceDir);
  let realTarget: string;
  try {
    realTarget = await fs.promises.realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return resolved;
    }
    throw error;
  }
  if (!isWithin(realWorkspaceDir, realTarget)) {
    throw new Error(`Path traversal blocked: "${candidate}" resolves outside workspace`);
  }
  return realTarget;
};

// ===== Utility Functions =====

export function safeJsonParse<T = unknown>(jsonString: string, fallbackValue: T): T {
  if (!jsonString || typeof jsonString !== 'string') {
    return fallbackValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (_error) {
    try {
      const repairedJson = jsonrepair(jsonString);
      return JSON.parse(repairedJson) as T;
    } catch (_repairError) {
      console.warn('[ImageGen] JSON parse failed:', jsonString.substring(0, 50));
      return fallbackValue;
    }
  }
}

export function isImageFile(file_path: string): boolean {
  const ext = path.extname(file_path).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext as ImageExtension);
}

export function isHttpUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

export async function fileToBase64(file_path: string): Promise<string> {
  try {
    const fileBuffer = await fs.promises.readFile(file_path);
    return fileBuffer.toString('base64');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      throw new Error(`Image file not found: ${file_path}`, { cause: error });
    }
    throw new Error(`Failed to read image file: ${errorMessage}`, { cause: error });
  }
}

export function getImageMimeType(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return MIME_TYPE_MAP[ext] || MIME_TYPE_MAP[DEFAULT_IMAGE_EXTENSION];
}

export function getFileExtensionFromDataUrl(dataUrl: string): string {
  const mimeTypeMatch = dataUrl.match(/^data:image\/([^;]+);base64,/);
  if (mimeTypeMatch && mimeTypeMatch[1]) {
    const mimeType = mimeTypeMatch[1].toLowerCase();
    return MIME_TO_EXT_MAP[mimeType] || DEFAULT_IMAGE_EXTENSION;
  }
  return DEFAULT_IMAGE_EXTENSION;
}

function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT_MAP[mimeType.toLowerCase().replace(/^image\//, '')] || DEFAULT_IMAGE_EXTENSION;
}

type ImagePayload = { bytes: Buffer; extension: string; mimeType: string };

function isVolcengineImageProvider(provider: TProviderWithModel): boolean {
  const platform = provider.platform.toLowerCase();
  return (
    platform.includes('volcengine') || platform === 'ark' || provider.base_url.includes('ark.cn-beijing.volces.com')
  );
}

async function executeVolcengineImageGeneration(
  provider: TProviderWithModel,
  prompt: string,
  imageInputs: string[],
  workspaceDir: string,
  signal?: AbortSignal
): Promise<ImageGenResult> {
  if (signal?.aborted) return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
  if (!provider.api_key)
    return { success: false, text: 'Image generation API key is not configured.', error: 'missing_api_key' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const abort = (): void => {
    controller.abort();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${provider.base_url.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider.use_model,
        prompt,
        ...(imageInputs.length ? { image: imageInputs.length === 1 ? imageInputs[0] : imageInputs } : {}),
        size: '2K',
        response_format: 'url',
        stream: false,
      }),
      signal: controller.signal,
    });
    let payload: { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } } | undefined;
    let payloadError: Error | undefined;
    try {
      payload = JSON.parse((await readResponseBodyBounded(response)).toString('utf8')) as typeof payload;
    } catch (error) {
      payloadError = error instanceof Error ? error : new Error(String(error));
      payload = undefined;
    }
    if (payloadError)
      return { success: false, text: `Error generating image: ${payloadError.message}`, error: payloadError.message };
    if (!response.ok) {
      const message = payload?.error?.message || `Image generation API returned HTTP ${response.status}`;
      return { success: false, text: `Error generating image: ${message}`, error: message };
    }
    const item = payload?.data?.[0];
    const imageData = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : undefined);
    if (!imageData)
      return { success: false, text: 'Image generation API returned no image.', error: 'no_image_output' };
    const imagePath = await saveGeneratedImage(imageData, workspaceDir, signal);
    return {
      success: true,
      text: `Generated image saved to: ${imagePath}`,
      imagePath,
      relativeImagePath: path.relative(workspaceDir, imagePath),
    };
  } catch (error) {
    if (signal?.aborted) return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    if (error instanceof DOMException && error.name === 'AbortError')
      return { success: false, text: 'Image generation timed out.', error: 'timeout' };
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, text: `Error generating image: ${message}`, error: message };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function parseDataUrl(value: string): ImagePayload {
  const match = value.match(/^data:(image\/[^;]+);base64,([\s\S]*)$/);
  if (!match) throw new Error('Image response was not a supported data URL');
  const base64 = match[2];
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) throw new Error('Generated image exceeds 25 MB');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Generated image exceeds 25 MB');
  return { bytes, extension: extensionForMimeType(match[1]), mimeType: match[1] };
}

async function fetchImageUrl(url: string, signal?: AbortSignal): Promise<ImagePayload> {
  if (signal?.aborted) throw new Error('Image download was cancelled');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Image response URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Image response URL must use HTTP or HTTPS');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(parsed, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image response download failed with status ${response.status}`);
    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType?.startsWith('image/')) throw new Error('Image response did not return an image');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Generated image exceeds 25 MB');
    const bytes = await readResponseBodyBounded(response);
    return { bytes, extension: extensionForMimeType(mimeType), mimeType };
  } catch (error) {
    if (signal?.aborted) throw new Error('Image download was cancelled', { cause: error });
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new Error('Image response download timed out', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function readResponseBodyBounded(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('Generated image exceeds 25 MB');
  if (!response.body) throw new Error('Image response body was empty');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('Generated image exceeds 25 MB');
    }
    chunks.push(chunk);
  }
  if (!size) throw new Error('Image response body was empty');
  return Buffer.concat(chunks);
}

export async function saveGeneratedImage(
  imageData: string,
  workspaceDir: string,
  signal?: AbortSignal
): Promise<string> {
  if (signal?.aborted) throw new Error('Image save was cancelled');
  const timestamp = Date.now();
  const parsed = imageData.startsWith('data:') ? parseDataUrl(imageData) : await fetchImageUrl(imageData, signal);
  let file_name = `img-${timestamp}${parsed.extension}`;
  const resolvedDir = path.resolve(workspaceDir);

  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const file_path = path.join(resolvedDir, file_name);
      try {
        await fs.promises.writeFile(file_path, parsed.bytes, { flag: 'wx' });
        return file_path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        file_name = `img-${timestamp}-${attempt + 1}${parsed.extension}`;
      }
    }
    throw new Error('Could not allocate a unique image filename');
  } catch (error) {
    console.error('[ImageGen] Failed to save image file:', error);
    throw new Error(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

// ===== Image Content Processing =====

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'low' | 'high';
  };
}

export async function processImageUri(
  imageUri: string,
  workspaceDir: string,
  signal?: AbortSignal
): Promise<ImageContent | null> {
  if (isHttpUrl(imageUri)) {
    const remote = await fetchImageUrl(imageUri, signal);
    return {
      type: 'image_url',
      image_url: { url: `data:${remote.mimeType};base64,${remote.bytes.toString('base64')}`, detail: 'auto' },
    };
  }

  let processedUri = imageUri;
  if (imageUri.startsWith('@')) {
    processedUri = imageUri.substring(1);
  }

  const fullPath = await resolveSafePath(workspaceDir, processedUri);

  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);

    if (!isImageFile(fullPath)) {
      throw new Error(`File is not a supported image type: ${fullPath}`);
    }

    const base64Data = await fileToBase64(fullPath);
    const mimeType = getImageMimeType(fullPath);
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'auto' },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('Path traversal blocked') ||
      errorMessage.includes('Image file not found') ||
      errorMessage.includes('not a supported image type')
    ) {
      throw error;
    }

    const possiblePaths = [imageUri, path.resolve(workspaceDir, imageUri)].filter((p, i, arr) => arr.indexOf(p) === i);
    throw new Error(
      `Image file not found. Searched paths:\n${possiblePaths.map((p) => `- ${p}`).join('\n')}\n\nPlease ensure the image file exists and has a valid image extension (.jpg, .png, .gif, .webp, etc.)`,
      { cause: error }
    );
  }
}

// ===== Core Execution =====

export interface ImageGenParams {
  prompt: string;
  image_uris?: string[] | string;
}

export interface ImageGenResult {
  success: boolean;
  text: string;
  imagePath?: string;
  relativeImagePath?: string;
  error?: string;
}

/**
 * Core image generation function shared between MCP server and Gemini tool.
 */
export async function executeImageGeneration(
  params: ImageGenParams,
  provider: TProviderWithModel,
  workspaceDir: string,
  proxy?: string,
  signal?: AbortSignal
): Promise<ImageGenResult> {
  if (signal?.aborted) {
    return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
  }

  // Resolve and validate workspaceDir once to prevent path traversal
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  // fs.realpath would reject if the directory does not exist, but we should
  // fail fast so the caller gets a clear error rather than a cascade.
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolvedWorkspaceDir);
  } catch {
    return {
      success: false,
      text: `Workspace directory not found: ${resolvedWorkspaceDir}`,
      error: `Workspace directory not found: ${resolvedWorkspaceDir}`,
    };
  }
  if (!stat.isDirectory()) {
    return {
      success: false,
      text: `Workspace path is not a directory: ${resolvedWorkspaceDir}`,
      error: `Workspace path is not a directory: ${resolvedWorkspaceDir}`,
    };
  }

  try {
    // Parse image URIs
    let imageUris: string[] = [];
    if (params.image_uris) {
      if (typeof params.image_uris === 'string') {
        const parsed = safeJsonParse<string[]>(params.image_uris, null);
        imageUris = Array.isArray(parsed) ? parsed : [params.image_uris];
      } else if (Array.isArray(params.image_uris)) {
        imageUris = params.image_uris;
      }
    }

    const hasImages = imageUris.length > 0;
    let enhancedPrompt: string;
    if (hasImages) {
      enhancedPrompt = `Analyze/Edit image: ${params.prompt}`;
    } else {
      enhancedPrompt = `Generate image: ${params.prompt}`;
    }

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: enhancedPrompt }];
    const imageInputs: string[] = [];

    // Process image URIs
    if (hasImages) {
      const imageResults = await Promise.allSettled(
        imageUris.map((uri) => processImageUri(uri, resolvedWorkspaceDir, signal))
      );

      const successful: ImageContent[] = [];
      const errors: string[] = [];

      imageResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          successful.push(result.value);
        } else {
          const error = result.status === 'rejected' ? result.reason : 'Unknown error';
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Image ${index + 1} (${imageUris[index]}): ${errorMessage}`);
        }
      });

      successful.forEach((imageContent) => contentParts.push(imageContent));
      successful.forEach((imageContent) => imageInputs.push(imageContent.image_url.url));

      if (successful.length === 0) {
        return {
          success: false,
          text: `Error: Failed to process any images. Errors:\n${errors.join('\n')}`,
          error: errors.join('\n'),
        };
      }
    }

    if (isVolcengineImageProvider(provider))
      return executeVolcengineImageGeneration(provider, params.prompt, imageInputs, resolvedWorkspaceDir, signal);

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: contentParts }];

    // Create client and call API
    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
    });

    const completion: UnifiedChatCompletionResponse = await rotatingClient.createChatCompletion(
      { model: provider.use_model, messages: messages as any },
      { signal, timeout: API_TIMEOUT_MS }
    );

    const choice = completion.choices[0];
    if (!choice) {
      return { success: false, text: 'No response from image generation API', error: 'No response' };
    }

    const responseText = choice.message.content || 'Image generated successfully.';
    let images = choice.message.images;

    // Extract images from markdown in content if not in images field
    if ((!images || images.length === 0) && responseText) {
      const dataUrlRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      const dataUrlMatches = [...responseText.matchAll(dataUrlRegex)];
      if (dataUrlMatches.length > 0) {
        images = dataUrlMatches.map((match) => ({
          type: 'image_url' as const,
          image_url: { url: match[1] },
        }));
      } else {
        const file_pathRegex = /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|svg))\)/gi;
        const file_pathMatches = [...responseText.matchAll(file_pathRegex)];
        if (file_pathMatches.length > 0) {
          const processedImages: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
          for (const match of file_pathMatches) {
            const file_path = match[1];
            try {
              const fullPath = await resolveSafePath(resolvedWorkspaceDir, file_path);
              await fs.promises.access(fullPath);
              const base64Data = await fileToBase64(fullPath);
              const mimeType = getImageMimeType(fullPath);
              processedImages.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
              });
            } catch (_fileError) {
              console.warn(`[ImageGen] Could not load image file: ${file_path}`);
            }
          }
          if (processedImages.length > 0) {
            images = processedImages;
          }
        }
      }
    }

    if (!images || images.length === 0) {
      const warningMessage = `Image generation did not produce any images.\n\nModel response: ${responseText}\n\nTip: Make sure your image generation model supports this type of request. Current model: ${provider.use_model}`;
      return { success: false, text: warningMessage, error: 'no_image_output' };
    }

    const firstImage = images[0];
    if (firstImage.type === 'image_url' && firstImage.image_url?.url) {
      const imagePath = await saveGeneratedImage(firstImage.image_url.url, resolvedWorkspaceDir, signal);
      const relativeImagePath = path.relative(resolvedWorkspaceDir, imagePath);

      // Strip any inline base64 data URLs from the human-readable text before
      // returning. The image is already saved to disk and referenced by path,
      // so re-emitting hundreds of MB of base64 in the MCP tool response just
      // forces the parent process to ship that payload through framed TCP again
      // (which is where the 2026-04-14 commit-charge blow-up happened).
      const cleanText = responseText.replace(
        /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]+\)/g,
        '[embedded image extracted]'
      );

      return {
        success: true,
        text: `${cleanText}\n\nGenerated image saved to: ${imagePath}`,
        imagePath,
        relativeImagePath,
      };
    }

    return { success: true, text: responseText };
  } catch (error) {
    if (signal?.aborted) {
      return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageGen] API call failed:`, error);
    return { success: false, text: `Error generating image: ${errorMessage}`, error: errorMessage };
  }
}
