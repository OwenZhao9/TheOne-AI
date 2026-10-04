import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import type { PiImageGenerationConfig, PiImageGenerationInput } from '@/common/pi';
import type { SecretCodec } from '../../extensions/automation';
import type { PiPaths } from './paths';

export const DEFAULT_IMAGE_GENERATION_PROVIDER = 'volcengine';
export const DEFAULT_IMAGE_GENERATION_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const DEFAULT_IMAGE_GENERATION_MODEL = 'doubao-seedream-5-0-flash-260915';
export const IMAGE_GENERATION_MCP_SERVER = 'theone-image-generation';

type StoredImageGenerationConfig = {
  provider: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  apiKeyEncrypted?: string;
};

type McpConfig = { mcpServers?: Record<string, Record<string, unknown>>; [key: string]: unknown };

export class ImageGenerationConfigService {
  private readonly file: string;
  private state: StoredImageGenerationConfig = {
    provider: DEFAULT_IMAGE_GENERATION_PROVIDER,
    baseUrl: DEFAULT_IMAGE_GENERATION_BASE_URL,
    model: DEFAULT_IMAGE_GENERATION_MODEL,
    enabled: true,
  };

  constructor(
    private readonly paths: PiPaths,
    private readonly codec: SecretCodec
  ) {
    this.file = join(paths.data, 'image-generation.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoredImageGenerationConfig>;
      if (
        typeof parsed.provider !== 'string' ||
        typeof parsed.baseUrl !== 'string' ||
        typeof parsed.model !== 'string' ||
        typeof parsed.enabled !== 'boolean' ||
        (parsed.apiKeyEncrypted !== undefined && typeof parsed.apiKeyEncrypted !== 'string')
      )
        throw new Error('invalid');
      this.state = { ...this.state, ...parsed };
      this.validate(this.state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('image_generation_settings_invalid');
    }
  }

  get(): PiImageGenerationConfig {
    return {
      provider: this.state.provider,
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      enabled: this.state.enabled,
      configured: Boolean(this.state.apiKeyEncrypted),
    };
  }

  environment(): NodeJS.ProcessEnv {
    let apiKey = '';
    if (this.state.apiKeyEncrypted) {
      try {
        apiKey = this.codec.open(this.state.apiKeyEncrypted);
      } catch {
        apiKey = '';
      }
    }
    return {
      THEONE_IMAGE_PROVIDER: this.state.provider,
      THEONE_IMAGE_BASE_URL: this.state.baseUrl,
      THEONE_IMAGE_MODEL: this.state.model,
      ...(apiKey ? { THEONE_IMAGE_API_KEY: apiKey } : {}),
    };
  }

  async save(input: PiImageGenerationInput): Promise<PiImageGenerationConfig> {
    const next: StoredImageGenerationConfig = {
      provider: input.provider.trim(),
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
      model: input.model.trim(),
      enabled: input.enabled,
      apiKeyEncrypted: this.state.apiKeyEncrypted,
    };
    this.validate(next);
    if (input.apiKey?.trim()) next.apiKeyEncrypted = this.codec.seal(input.apiKey.trim());
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
    this.state = next;
    return this.get();
  }

  async importFromFile(filePath: string): Promise<PiImageGenerationConfig> {
    if (!filePath || !isAbsolute(filePath)) throw new Error('image_generation_import_path_invalid');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch {
      throw new Error('image_generation_import_invalid');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('image_generation_import_invalid');
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.provider !== 'string' ||
      typeof value.baseUrl !== 'string' ||
      typeof value.model !== 'string' ||
      typeof value.apiKey !== 'string' ||
      (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    )
      throw new Error('image_generation_import_invalid');
    return this.save({
      provider: value.provider,
      baseUrl: value.baseUrl,
      model: value.model,
      apiKey: value.apiKey,
      enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    });
  }

  async prepareAgent(agentDir: string): Promise<void> {
    const script = this.paths.builtinImageGenScript;
    if (!script) throw new Error('image_generation_runtime_missing');
    await access(script).catch(() => {
      throw new Error('image_generation_runtime_missing');
    });
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    let config: McpConfig = {};
    try {
      config = JSON.parse(await readFile(join(agentDir, 'mcp.json'), 'utf8')) as McpConfig;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('image_generation_mcp_config_invalid');
    }
    config.mcpServers = {
      ...config.mcpServers,
      [IMAGE_GENERATION_MCP_SERVER]: {
        command: this.paths.node,
        args: [script],
        exposure: 'direct',
        toolExposure: { aionui_image_generation: 'direct' },
        enabled: this.state.enabled,
        timeout: 180,
        description: 'Generate or edit real image files in the current workspace.',
        env: {
          AIONUI_IMG_PROVIDER_ID: IMAGE_GENERATION_MCP_SERVER,
          AIONUI_IMG_PLATFORM: '${THEONE_IMAGE_PROVIDER}',
          AIONUI_IMG_BASE_URL: '${THEONE_IMAGE_BASE_URL}',
          AIONUI_IMG_API_KEY: '${THEONE_IMAGE_API_KEY}',
          AIONUI_IMG_MODEL: '${THEONE_IMAGE_MODEL}',
        },
      },
    };
    await writeFile(join(agentDir, 'mcp.json.tmp'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(join(agentDir, 'mcp.json.tmp'), join(agentDir, 'mcp.json'));
  }

  private validate(value: StoredImageGenerationConfig): void {
    if (!/^[a-zA-Z0-9._-]+$/.test(value.provider)) throw new Error('image_generation_provider_invalid');
    let url: URL;
    try {
      url = new URL(value.baseUrl);
    } catch {
      throw new Error('image_generation_base_url_invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('image_generation_base_url_invalid');
    if (!/^[a-zA-Z0-9._:/-]+$/.test(value.model)) throw new Error('image_generation_model_invalid');
  }
}
