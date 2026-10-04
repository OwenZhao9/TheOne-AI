import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Image, Tabs, Tooltip } from '@arco-design/web-react';
import { FileText, Folder, Left, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import WorkspacePanelHeader from '@/renderer/pages/conversation/components/ChatLayout/WorkspacePanelHeader';
import MarkdownView from '@/renderer/components/Markdown';
import type { PiFile, PiGit, PiPreview } from '@/common/pi';
import { invoke, errorText } from '../utils/client';
import styles from '../PiDesktop.module.css';

export default function FilesPanel({
  id,
  running,
  requested,
}: {
  id: string;
  running: boolean;
  requested?: { path: string; nonce: number };
}) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [files, setFiles] = useState<PiFile[]>([]);
  const [git, setGit] = useState<PiGit>();
  const [tab, setTab] = useState('files');
  const [preview, setPreview] = useState<PiPreview>();
  const [source, setSource] = useState(false);
  const [error, setError] = useState('');
  const readGeneration = useRef(0);
  const listGeneration = useRef(0);
  const shown = useRef<{ path: string; diff: boolean } | undefined>(undefined);
  const read = async (file: string, diff = false): Promise<void> => {
    shown.current = { path: file, diff };
    const generation = ++readGeneration.current;
    try {
      const value: PiPreview = diff
        ? { kind: 'text', path: `${file}.diff`, content: await invoke('diff', { id, path: file }) }
        : await invoke('preview', { id, path: file });
      if (generation !== readGeneration.current) return;
      setPreview(value);
      setSource(diff);
      setError('');
    } catch (e) {
      if (generation === readGeneration.current) setError(errorText(e));
    }
  };
  const refresh = async (): Promise<void> => {
    const generation = ++listGeneration.current;
    try {
      if (tab === 'files') {
        const value = await invoke('files', { id, path });
        if (generation !== listGeneration.current) return;
        setFiles(value);
      } else {
        const value = await invoke('git', { id });
        if (generation !== listGeneration.current) return;
        setGit(value);
      }
      setError('');
      if (!running && shown.current) {
        await read(shown.current.path, shown.current.diff);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, [id, path, tab, running]);
  useEffect(() => {
    if (requested) void read(requested.path);
  }, [requested, id]);
  const isMarkdown = preview && /\.(md|mdx|markdown)$/i.test(preview.path);
  const isHtml = preview && /\.html?$/i.test(preview.path);
  return (
    <aside className={styles.filesPanel}>
      <WorkspacePanelHeader collapsed={false} onToggle={() => undefined}>
        <div className='flex items-center justify-between'>
          <span>{t('common.pi.files')}</span>
          <Tooltip content={t('common.pi.refresh')}>
            <Button aria-label={t('common.pi.refresh')} type='text' icon={<Refresh />} onClick={() => void refresh()} />
          </Tooltip>
        </div>
      </WorkspacePanelHeader>
      <Tabs activeTab={tab} onChange={setTab}>
        <Tabs.TabPane key='files' title={t('common.pi.files')} />
        <Tabs.TabPane key='git' title={t('common.pi.changes')} />
      </Tabs>
      {error && <Alert type='error' content={error} />}
      <div className={styles.fileList}>
        {tab === 'files' ? (
          <>
            {path && (
              <Button
                type='text'
                size='small'
                icon={<Left />}
                onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}
              >
                {t('common.pi.parent')}
              </Button>
            )}
            {files.map((file) => (
              <Button
                className={styles.fileButton}
                type='text'
                key={file.path}
                icon={file.directory ? <Folder /> : <FileText />}
                onClick={() => {
                  if (file.directory) setPath(file.path);
                  else void read(file.path);
                }}
              >
                {file.name}
              </Button>
            ))}
            {!files.length && !error && <p className={styles.muted}>{t('common.pi.noFiles')}</p>}
          </>
        ) : (
          <>
            {git && <p className={styles.muted}>{git.branch}</p>}
            {git?.files.map((file) => (
              <Button
                type='text'
                className={styles.fileButton}
                key={file.path}
                onClick={() => void read(file.path, true)}
              >
                <code>{file.status}</code> {file.path}
              </Button>
            ))}
            {git && !git.files.length && <p className={styles.muted}>{t('common.pi.noChanges')}</p>}
          </>
        )}
      </div>
      <div className={styles.previewHeader}>
        <span title={preview?.path}>{preview?.path || t('common.pi.preview')}</span>
        {(isMarkdown || isHtml) && (
          <Button size='mini' type='text' onClick={() => setSource(!source)}>
            {t(source ? 'common.pi.rendered' : 'common.pi.showSource')}
          </Button>
        )}
      </div>
      <div className={styles.preview} data-testid='pi-preview'>
        {!preview ? (
          <Empty description={t('common.pi.previewHint')} />
        ) : preview.kind === 'image' ? (
          <Image src={`data:${preview.mimeType};base64,${preview.content}`} width='100%' />
        ) : preview.kind === 'pdf' ? (
          <iframe
            title={preview.path}
            src={`data:application/pdf;base64,${preview.content}`}
            className={styles.previewFrame}
            sandbox=''
          />
        ) : preview.kind === 'binary' ? (
          <p>{t('common.pi.binary')}</p>
        ) : isMarkdown && !source ? (
          <MarkdownView onLocalFileLink={(file) => void read(file)}>{preview.content}</MarkdownView>
        ) : isHtml && !source ? (
          <iframe
            title={preview.path}
            sandbox=''
            srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${preview.content}`}
            className={styles.previewFrame}
          />
        ) : (
          <pre className={styles.source}>{preview.content}</pre>
        )}
      </div>
    </aside>
  );
}
