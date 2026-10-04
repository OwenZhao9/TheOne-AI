import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Space, Spin, Tag } from '@arco-design/web-react';
import { BookOpen, Calendar, Left, LinkOne, Search, Time } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ArticleCard, ArticleDocument } from '@/common/pi';
import MarkdownView from '@/renderer/components/Markdown';
import { errorText, invoke } from '../utils/client';
import styles from './ArticleLibrary.module.css';

export default function ArticleLibrary() {
  const { t, i18n } = useTranslation();
  const [articles, setArticles] = useState<ArticleCard[]>([]);
  const [selected, setSelected] = useState<ArticleDocument>();
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void invoke('articles', undefined)
      .then(setArticles)
      .catch((failure) => setError(errorText(failure)))
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(
    () => [...new Set(articles.map((article) => article.date.slice(0, 4)))].filter(Boolean),
    [articles]
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(i18n.language);
    return articles.filter(
      (article) =>
        (!year || article.date.startsWith(year)) &&
        (!needle ||
          `${article.title} ${article.summary} ${article.tags.join(' ')}`
            .toLocaleLowerCase(i18n.language)
            .includes(needle))
    );
  }, [articles, i18n.language, query, year]);

  const open = (card: ArticleCard): void => {
    setReading(true);
    setError('');
    void invoke('article', { id: card.id })
      .then(setSelected)
      .catch((failure) => setError(errorText(failure)))
      .finally(() => setReading(false));
  };

  if (selected) {
    return (
      <section className={styles.reader} data-testid='article-reader'>
        <div className={styles.readerToolbar}>
          <Button type='text' icon={<Left />} onClick={() => setSelected(undefined)}>
            {t('common.pi.articles.back')}
          </Button>
        </div>
        <article className={styles.paper}>
          <header className={styles.articleHeader}>
            <div className={styles.eyebrow}>{t('common.pi.articles.eyebrow')}</div>
            <h1>{selected.title}</h1>
            {selected.summary && <p className={styles.lead}>{selected.summary}</p>}
            <Space wrap className={styles.articleMeta}>
              <span>
                <Calendar size={15} />
                {selected.date}
              </span>
              <span>
                <Time size={15} />
                {t('common.pi.articles.readingTime', { count: selected.readingMinutes })}
              </span>
              <span>
                <LinkOne size={15} />
                {t('common.pi.articles.sourceCount', { count: selected.sourceLinks })}
              </span>
            </Space>
            {!!selected.tags.length && (
              <Space wrap>
                {selected.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            )}
          </header>
          <div className={styles.articleBody}>
            <MarkdownView>{selected.content}</MarkdownView>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section className={styles.library} data-testid='article-library'>
      <header className={styles.header}>
        <div>
          <h1>{t('common.pi.articles.title')}</h1>
          <p>{t('common.pi.articles.subtitle')}</p>
        </div>
        <div className={styles.count}>{t('common.pi.articles.total', { count: articles.length })}</div>
      </header>
      {error && <Alert type='error' content={error} />}
      <div className={styles.filters}>
        <Input
          prefix={<Search />}
          value={query}
          onChange={setQuery}
          allowClear
          placeholder={t('common.pi.articles.search')}
        />
        <Select
          value={year}
          onChange={setYear}
          aria-label={t('common.pi.articles.year')}
          options={[
            { value: '', label: t('common.pi.articles.allYears') },
            ...years.map((value) => ({ value, label: value })),
          ]}
        />
      </div>
      {loading || reading ? (
        <div className={styles.loading}>
          <Spin />
        </div>
      ) : !visible.length ? (
        <div className={styles.empty}>
          <Empty description={t(articles.length ? 'common.pi.noMatch' : 'common.pi.articles.empty')} />
          {!articles.length && <p>{t('common.pi.articles.emptyHint')}</p>}
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((article) => (
            <article className={styles.card} key={article.id} data-testid='article-card'>
              <div className={styles.cardTop}>
                <span className={styles.icon}>
                  <BookOpen size={23} />
                </span>
                <div className={styles.cardDate}>{article.date}</div>
              </div>
              <h2>{article.title}</h2>
              <p className={styles.summary}>{article.summary}</p>
              {!!article.tags.length && (
                <Space wrap>
                  {article.tags.slice(0, 4).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              )}
              <div className={styles.cardFooter}>
                <span>
                  <Time size={14} />
                  {t('common.pi.articles.readingTime', { count: article.readingMinutes })}
                </span>
                <span>
                  <LinkOne size={14} />
                  {t('common.pi.articles.sourceCount', { count: article.sourceLinks })}
                </span>
              </div>
              <Button type='primary' className={styles.open} onClick={() => open(article)}>
                {t('common.pi.articles.read')}
              </Button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
