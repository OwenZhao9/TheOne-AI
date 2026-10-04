export type ArticleCard = {
  id: string;
  title: string;
  date: string;
  period?: string;
  summary: string;
  tags: string[];
  sourceLinks: number;
  readingMinutes: number;
  updatedAt: number;
};

export type ArticleDocument = ArticleCard & {
  content: string;
};
