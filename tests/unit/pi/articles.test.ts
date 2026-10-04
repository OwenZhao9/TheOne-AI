import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArticleLibrary, parseArticleMarkdown } from '@/process/services/pi/content';

const roots: string[] = [];
const temporary = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'theone-articles-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Article library', () => {
  it('reads human-friendly metadata and removes the duplicate page title', () => {
    const article = parseArticleMarkdown(`---
title: A useful article
date: 2026-10-04
period: 2026-09-27 to 2026-10-04
tags: [AI, Agent]
summary: Read this first.
---
# A useful article

## Key point

Body with a [source](https://example.com).`);
    expect(article.title).toBe('A useful article');
    expect(article.summary).toBe('Read this first.');
    expect(article.content.startsWith('## Key point')).toBe(true);
  });

  it('lists valid articles newest first and skips malformed documents', async () => {
    const root = await temporary();
    await mkdir(join(root, '2026'));
    await writeFile(join(root, '2026', 'older.md'), '# Older\n\nA complete older article.');
    await writeFile(
      join(root, '2026', '2026-10-04-newer.md'),
      '---\ntitle: Newer\ndate: 2026-10-04\ntags: [AI]\n---\n# Newer\n\nUseful summary.'
    );
    await writeFile(join(root, '2026', 'broken.md'), 'No title');
    const cards = await new ArticleLibrary(root, root).list();
    expect(cards.map((card) => card.title)).toEqual(['Newer', 'Older']);
    expect(cards[0].id).toBe('2026/2026-10-04-newer.md');
  });

  it('rejects traversal and symbolic links outside the library', async () => {
    const root = await temporary();
    const outside = await temporary();
    await writeFile(join(outside, 'private.md'), '# Private\n\nDo not expose.');
    await symlink(join(outside, 'private.md'), join(root, 'linked.md'));
    const library = new ArticleLibrary(root, root);
    await expect(library.read('../private.md')).rejects.toThrow('article_invalid_path');
    await expect(library.read('linked.md')).rejects.toThrow('article_invalid_path');
  });
});
