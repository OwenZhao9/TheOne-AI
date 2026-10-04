import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Empty, Input, Modal, Select, Space, Spin, Tag } from '@arco-design/web-react';
import { AddOne, FolderOpen, Like, Robot, Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { BotCard, BotPreview } from '@/common/pi/bots';
import type { PiSnapshot } from '@/common/pi';
import { invoke, errorText } from '../utils/client';
import styles from './BotPlaza.module.css';

export default function BotPlaza({ opened }: { opened: (snapshot: PiSnapshot) => void; configure: () => void }) {
  const { t } = useTranslation();
  const [bots, setBots] = useState<BotCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [importing, setImporting] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<BotPreview>();
  const [trusted, setTrusted] = useState(false);
  const running = useRef(false);
  const reload = async (): Promise<void> => {
    setBots(await invoke('bots', undefined));
  };
  useEffect(() => {
    void reload()
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
  }, []);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const prepare = (github?: string): void => {
    void run(async () => {
      if (preview) await invoke('botDiscard', { token: preview.token });
      setPreview(undefined);
      setTrusted(false);
      setPreview(await invoke('botPreview', github ? { github } : {}));
    });
  };
  const closeImport = (): void => {
    if (busy) return;
    if (preview) void invoke('botDiscard', { token: preview.token });
    setPreview(undefined);
    setImporting(false);
    setTrusted(false);
    setError('');
  };
  const launch = async (bot: BotCard): Promise<void> => {
    const snapshot = await invoke('create', { botId: bot.id });
    opened(snapshot);
  };
  const visible = bots.filter(
    (bot) =>
      (!favorites || bot.favorite) &&
      (!tag || bot.tags.includes(tag)) &&
      `${bot.name} ${bot.description} ${bot.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())
  );
  return (
    <section className={styles.plaza} data-testid='bot-plaza'>
      <header className={styles.header}>
        <div>
          <h1>{t('common.pi.bots.title')}</h1>
          <p>{t('common.pi.bots.subtitle')}</p>
        </div>
        <Button
          type='primary'
          icon={<AddOne />}
          data-testid='bot-import'
          onClick={() => {
            setError('');
            setImporting(true);
          }}
        >
          {t('common.pi.bots.import')}
        </Button>
      </header>
      {error && !importing && <Alert type='error' content={error} />}
      <div className={styles.filters}>
        <Input
          prefix={<Search />}
          value={query}
          onChange={setQuery}
          allowClear
          placeholder={t('common.pi.bots.search')}
        />
        <Select
          value={tag}
          onChange={setTag}
          aria-label={t('common.pi.bots.category')}
          options={[
            { value: '', label: t('common.pi.bots.allCategories') },
            ...[...new Set(bots.flatMap((bot) => bot.tags))].map((value) => ({ value, label: value })),
          ]}
        />
        <Checkbox checked={favorites} onChange={setFavorites}>
          {t('common.pi.bots.favorites')}
        </Checkbox>
      </div>
      {loading ? (
        <Spin />
      ) : !visible.length ? (
        <div className={styles.empty}>
          <Empty description={t(bots.length ? 'common.pi.noMatch' : 'common.pi.bots.empty')} />
          {!bots.length && <p>{t('common.pi.bots.emptyHint')}</p>}
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((bot) => (
            <article className={styles.card} key={bot.id} data-testid='bot-card'>
              <div className={styles.cardTop}>
                <span className={styles.avatar}>
                  <Robot size={24} />
                </span>
                <div>
                  <h2>{bot.name}</h2>
                  <span className={styles.meta}>
                    {bot.version}
                    {bot.author ? ` · ${bot.author}` : ''}
                  </span>
                </div>
                <Button
                  type='text'
                  className={styles.cardControl}
                  disabled={busy}
                  aria-label={t(bot.favorite ? 'common.pi.bots.unfavorite' : 'common.pi.bots.favorite')}
                  icon={<Like theme={bot.favorite ? 'filled' : 'outline'} />}
                  onClick={() =>
                    void run(async () => {
                      await invoke('botFavorite', { id: bot.id, favorite: !bot.favorite });
                      await reload();
                    })
                  }
                />
              </div>
              <p className={styles.description}>{bot.description}</p>
              <Space wrap>
                {bot.tags.map((value) => (
                  <Tag key={value}>{value}</Tag>
                ))}
              </Space>
              <div className={styles.meta}>{t('common.pi.bots.skillCount', { count: bot.skills.length })}</div>
              {!!bot.missingCapabilities.length && (
                <Alert
                  type='warning'
                  content={t('common.pi.bots.missing', {
                    tools: bot.missingCapabilities.map((cap) => t(`common.pi.bots.capabilities.${cap}`)).join('、'),
                  })}
                />
              )}
              <div className={styles.actions}>
                <Button
                  type='primary'
                  disabled={busy || !!bot.missingCapabilities.length}
                  className={styles.enter}
                  onClick={() => void run(() => launch(bot))}
                >
                  {t('common.pi.bots.use')}
                </Button>
                <Button
                  type='text'
                  className={styles.cardControl}
                  disabled={busy}
                  onClick={() =>
                    Modal.confirm({
                      title: t('common.pi.bots.remove'),
                      content: t('common.pi.bots.removeHint'),
                      okText: t('common.pi.remove'),
                      cancelText: t('common.pi.cancel'),
                      onOk: () =>
                        run(async () => {
                          await invoke('botRemove', { id: bot.id });
                          await reload();
                        }),
                    })
                  }
                >
                  {t('common.pi.remove')}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal
        title={t('common.pi.bots.import')}
        visible={importing}
        onCancel={closeImport}
        footer={null}
        className={styles.modal}
        maskClosable={!busy}
      >
        {error && <Alert type='error' content={error} />}
        <p>{t('common.pi.bots.importHint')}</p>
        <Input
          data-testid='bot-github-url'
          value={url}
          onChange={setUrl}
          disabled={busy}
          placeholder='https://github.com/owner/repository'
          aria-label={t('common.pi.bots.github')}
        />
        <Space className='mt-12px mb-16px'>
          <Button
            data-testid='bot-read-github'
            type='primary'
            loading={busy}
            disabled={!url.trim()}
            onClick={() => prepare(url.trim())}
          >
            {t('common.pi.bots.readGithub')}
          </Button>
          <Button data-testid='bot-local-folder' icon={<FolderOpen />} disabled={busy} onClick={() => prepare()}>
            {t('common.pi.bots.localFolder')}
          </Button>
        </Space>
        {preview && (
          <div className={styles.preview}>
            <h3>
              {preview.manifest.name} <span className={styles.meta}>{preview.manifest.version}</span>
            </h3>
            <p>{preview.manifest.description}</p>
            <p className={styles.source}>{preview.source}</p>
            <p>
              {t('common.pi.bots.skills')}: {preview.manifest.skills.map((path) => path.split('/').at(-2)).join('、')}
            </p>
            {!!preview.manifest.requiredCapabilities.length && (
              <p>
                {t('common.pi.bots.requires')}:{' '}
                {preview.manifest.requiredCapabilities.map((cap) => t(`common.pi.bots.capabilities.${cap}`)).join('、')}
              </p>
            )}
            {preview.replaces && (
              <Alert type='info' content={t('common.pi.bots.updateHint', { version: preview.replaces })} />
            )}
            {!!preview.missingCapabilities.length && (
              <Alert
                type='warning'
                content={t('common.pi.bots.missing', {
                  tools: preview.missingCapabilities.map((cap) => t(`common.pi.bots.capabilities.${cap}`)).join('、'),
                })}
              />
            )}
            <Checkbox className='my-16px' checked={trusted} onChange={setTrusted} data-testid='bot-trust'>
              {t('common.pi.bots.trust')}
            </Checkbox>
            <Button
              data-testid='bot-confirm-import'
              type='primary'
              long
              disabled={!trusted}
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('botInstall', { token: preview.token });
                  await reload();
                  setPreview(undefined);
                  setImporting(false);
                })
              }
            >
              {t(preview.replaces ? 'common.pi.bots.update' : 'common.pi.bots.import')}
            </Button>
          </div>
        )}
      </Modal>
    </section>
  );
}
