export type BotCapability = 'files' | 'shell' | 'computer-use';
export type BotManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  instructions: string;
  skills: string[];
  requiredCapabilities: BotCapability[];
  tags: string[];
  starters: string[];
  author?: string;
};
export type BotBinding = { id: string; revision: string; name: string; version: string };
export type BotCard = BotManifest & {
  revision: string;
  source: string;
  installedAt: number;
  favorite: boolean;
  missingCapabilities: BotCapability[];
};
export type BotPreview = {
  token: string;
  manifest: BotManifest;
  source: string;
  replaces?: string;
  missingCapabilities: BotCapability[];
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bot_manifest_invalid');
  return value as Record<string, unknown>;
};
function text(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error('bot_manifest_invalid');
  return value.trim();
}
function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('bot_manifest_invalid');
  return value.map((item) => text(item, maxLength));
}
/** Portable package-relative paths; never absolute paths or parent traversal. */
export function botRelativePath(value: string): boolean {
  return (
    !/[\\:]/.test(value) &&
    ![...value].some((char) => char.charCodeAt(0) < 32) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'))
  );
}
export function parseBotManifest(input: unknown): BotManifest {
  const value = object(input);
  const known = new Set([
    'schemaVersion',
    'id',
    'name',
    'version',
    'description',
    'instructions',
    'skills',
    'requiredCapabilities',
    'tags',
    'starters',
    'author',
  ]);
  if (Object.keys(value).some((key) => !known.has(key)) || value.schemaVersion !== 1)
    throw new Error('bot_manifest_invalid');
  const id = text(value.id, 80);
  const version = text(value.version, 40);
  if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id) || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error('bot_manifest_invalid');
  const skills = strings(value.skills, 20, 240);
  if (
    !skills.length ||
    new Set(skills).size !== skills.length ||
    skills.some((path) => !botRelativePath(path) || !/^skills\/.+\/SKILL\.md$/.test(path))
  )
    throw new Error('bot_skill_invalid');
  const required = strings(value.requiredCapabilities ?? ['files'], 3, 30);
  if (required.some((cap) => !['files', 'shell', 'computer-use'].includes(cap)))
    throw new Error('bot_manifest_invalid');
  return {
    schemaVersion: 1,
    id,
    version,
    name: text(value.name, 80),
    description: text(value.description, 500),
    instructions: text(value.instructions ?? '', 16000, false),
    skills,
    requiredCapabilities: [...new Set(required)] as BotCapability[],
    tags: strings(value.tags ?? [], 8, 30),
    starters: strings(value.starters ?? [], 6, 500),
    ...(value.author === undefined ? {} : { author: text(value.author, 100) }),
  };
}
