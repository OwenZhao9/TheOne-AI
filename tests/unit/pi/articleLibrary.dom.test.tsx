import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ArticleLibrary from '@/renderer/pages/PiDesktop/ArticleLibrary';
import type { ArticleCard, ArticleDocument } from '@/common/pi';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
vi.mock('@/renderer/components/Markdown', () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }),
}));

const card: ArticleCard = {
  id: '2026/article.md',
  title: '持续工作的助手',
  date: '2026-10-04',
  period: '2026-09-27 至 2026-10-04',
  summary: '一段能让人快速判断是否值得阅读的摘要。',
  tags: ['AI情报', 'Agent'],
  sourceLinks: 6,
  readingMinutes: 5,
  updatedAt: 1,
};
const document: ArticleDocument = { ...card, content: '## 先看结论\n\n正文内容。' };

afterEach(() => {
  cleanup();
  invoke.mockReset();
});

describe('Article library reading flow', () => {
  it('shows article cards and opens the selected article inside TheOne', async () => {
    invoke.mockImplementation(async (method) => (method === 'articles' ? [card] : document));
    render(<ArticleLibrary />);
    await waitFor(() => expect(screen.getByText(card.title)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'common.pi.articles.read' }));
    await waitFor(() => expect(screen.getByTestId('article-reader')).toBeTruthy());
    expect(screen.getByText((text) => text.includes('正文内容。'))).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('article', { id: card.id });
  });

  it('shows loading failures without inventing article cards', async () => {
    invoke.mockRejectedValue(new Error('article_unavailable'));
    render(<ArticleLibrary />);
    await waitFor(() => expect(screen.getByText('Error: article_unavailable')).toBeTruthy());
    expect(screen.queryByTestId('article-card')).toBeNull();
  });
});
