import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ArticleCard, ArticleDocument } from '@/common/pi/articles';

const MAX_ARTICLE_BYTES = 2 * 1024 * 1024;

type ParsedArticle = Omit<ArticleCard, 'id' | 'updatedAt'> & { content: string };

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
};

const listValue = (value?: string): string[] => {
  if (!value) return [];
  const body = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return body
    .split(',')
    .map((item) => unquote(item))
    .filter(Boolean)
    .slice(0, 12);
};

const readingMinutes = (content: string): number => {
  const chinese = (content.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (content.replace(/[\u3400-\u9fff]/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
  return Math.max(1, Math.ceil(chinese / 300 + words / 200));
};

export function parseArticleMarkdown(markdown: string, fallbackDate = ''): ParsedArticle {
  let body = markdown.replace(/^\uFEFF/, '').trim();
  const metadata = new Map<string, string>();
  const frontmatter = body.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (frontmatter) {
    for (const line of frontmatter[1].split('\n')) {
      const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (match) metadata.set(match[1], match[2]);
    }
    body = body.slice(frontmatter[0].length).trim();
  }

  const heading = body.match(/^#\s+(.+?)\s*$/m);
  const title = unquote(metadata.get('title') || heading?.[1] || '').trim();
  if (!title) throw new Error('article_title_missing');
  if (heading) body = `${body.slice(0, heading.index)}${body.slice((heading.index || 0) + heading[0].length)}`.trim();

  const summaryParagraph = body
    .split(/\n\s*\n/)
    .map((value) => value.replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim())
    .find((value) => value && !value.startsWith('#') && !value.startsWith('- '));
  const summary = unquote(metadata.get('summary') || summaryParagraph || '').slice(0, 240);
  const date = unquote(metadata.get('date') || fallbackDate);
  const content = body.trim();
  return {
    title,
    date,
    ...(metadata.get('period') ? { period: unquote(metadata.get('period') || '') } : {}),
    summary,
    tags: listValue(metadata.get('tags')),
    sourceLinks: (content.match(/\]\(https?:\/\//g) || []).length,
    readingMinutes: readingMinutes(content),
    content,
  };
}

async function markdownFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const visit = async (folder: string): Promise<void> => {
    await Promise.all(
      (await readdir(folder, { withFileTypes: true })).map(async (entry) => {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== 'readme.md')
          found.push(path);
      })
    );
  };
  await visit(root);
  return found;
}

function articleLibraryRoot(data: string): string {
  const configured = process.env.THEONE_ARTICLE_LIBRARY?.trim();
  if (configured) return resolve(configured.replace(/^~(?=$|\/)/, homedir()));
  const existingGetinfo = join(homedir(), 'getinfo', 'documents', 'ai-intelligence');
  return existsSync(existingGetinfo) ? existingGetinfo : join(data, 'ai-intelligence');
}

export class ArticleLibrary {
  readonly root: string;

  constructor(data: string, root = articleLibraryRoot(data)) {
    this.root = resolve(root);
  }

  async list(): Promise<ArticleCard[]> {
    const cards = await Promise.all(
      (await markdownFiles(this.root)).map(async (path): Promise<ArticleCard | undefined> => {
        try {
          const info = await stat(path);
          if (info.size > MAX_ARTICLE_BYTES) return undefined;
          const parsed = parseArticleMarkdown(await readFile(path, 'utf8'), /\d{4}-\d{2}-\d{2}/.exec(path)?.[0]);
          return {
            id: relative(this.root, path).split(sep).join('/'),
            title: parsed.title,
            date: parsed.date,
            ...(parsed.period ? { period: parsed.period } : {}),
            summary: parsed.summary,
            tags: parsed.tags,
            sourceLinks: parsed.sourceLinks,
            readingMinutes: parsed.readingMinutes,
            updatedAt: info.mtimeMs,
          };
        } catch {
          return undefined;
        }
      })
    );
    return cards
      .filter((card): card is ArticleCard => Boolean(card))
      .toSorted((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
  }

  async read(id: string): Promise<ArticleDocument> {
    if (
      !id ||
      isAbsolute(id) ||
      id.includes('\\') ||
      id.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('article_invalid_path');
    const requested = resolve(this.root, id);
    if (dirname(requested) === requested || !requested.startsWith(`${this.root}${sep}`))
      throw new Error('article_invalid_path');
    const root = await realpath(this.root).catch(() => this.root);
    const path = await realpath(requested).catch(() => requested);
    if (!path.startsWith(`${root}${sep}`)) throw new Error('article_invalid_path');
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ARTICLE_BYTES || !/\.md$/i.test(path)) throw new Error('article_unavailable');
    const parsed = parseArticleMarkdown(await readFile(path, 'utf8'), /\d{4}-\d{2}-\d{2}/.exec(path)?.[0]);
    return { ...parsed, id, updatedAt: info.mtimeMs };
  }
}
