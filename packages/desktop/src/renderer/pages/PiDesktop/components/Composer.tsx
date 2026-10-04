import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Space, Tag, Tooltip } from '@arco-design/web-react';
import { ArrowUp, FolderOpen, Peoples, Plus, Square } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import SlashCommandMenu from '@/renderer/components/chat/SlashCommandMenu';
import { SendBoxPanel, SendBoxActionRow } from '@/renderer/components/chat/SendBox/SendBoxSurface';
import GuidInputCard, { GuidSendButton } from '@/renderer/pages/guid/components/GuidInputCard';
import { getInputFocusRing } from '@/renderer/hooks/chat/useInputFocusRing';
import guidStyles from '@/renderer/pages/guid/index.module.css';
import { recordOf, textOf, type JsonRecord, type PiAttachment, type PiSnapshot } from '@/common/pi';
import { invoke, errorText } from '../utils/client';
import { getDraft, saveDraft } from '../utils/drafts';
import ModelControls from './ModelControls';
import styles from '../PiDesktop.module.css';

export default function Composer({
  snapshot,
  onError,
  initialText = '',
  chooseFolder,
  welcome = false,
}: {
  snapshot: PiSnapshot;
  onError: (value: string) => void;
  initialText?: string;
  chooseFolder?: () => void;
  welcome?: boolean;
}) {
  const { t } = useTranslation();
  const id = snapshot.conversation.id;
  const saved = useRef(getDraft(id));
  const [text, setText] = useState(saved.current.text || initialText);
  const [attachments, setAttachments] = useState<PiAttachment[]>(saved.current.attachments);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<'steer' | 'followUp'>('steer');
  const [commands, setCommands] = useState<JsonRecord[]>([]);
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const [active, setActive] = useState(0);
  const composition = useRef(false);
  const lastCommandLoad = useRef('');
  const lastSent = useRef<{ text: string; attachments: PiAttachment[] } | undefined>(undefined);
  const view = snapshot.view;
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [appearance, setAppearance] = useState(document.documentElement.getAttribute('data-theme') || 'light');
  useEffect(() => {
    const update = () => setAppearance(document.documentElement.getAttribute('data-theme') || 'light');
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const ring = getInputFocusRing(appearance);
  useEffect(() => {
    if (!view.error || !lastSent.current) return;
    const failed = lastSent.current;
    setText((current) => current || failed.text);
    setAttachments((current) => (current.length ? current : failed.attachments));
  }, [view.error]);
  useEffect(() => {
    saveDraft(id, { text, attachments });
  }, [id, text, attachments]);
  useEffect(
    () =>
      window.aionPi?.subscribe((event) => {
        if (
          event.kind === 'record' &&
          event.id === id &&
          event.record.type === 'extension_ui_request' &&
          event.record.method === 'set_editor_text'
        )
          setText(textOf(event.record.text));
      }),
    [id]
  );
  const slash = /^\/([^\s]*)$/.exec(text)?.[1];
  const mention = /(?:^|\s)@([^\s]*)$/.exec(text)?.[1];
  useEffect(() => {
    if (slash !== undefined && lastCommandLoad.current !== id) {
      lastCommandLoad.current = id;
      void invoke('command', { id, command: { type: 'get_commands' } })
        .then((result) => setCommands((Array.isArray(result.commands) ? result.commands : []).map(recordOf)))
        .catch((e) => {
          lastCommandLoad.current = '';
          onError(errorText(e));
        });
    }
  }, [id, slash, onError]);
  useEffect(() => {
    if (mention === undefined) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void invoke('files', { id, search: mention })
        .then((result) => {
          if (!cancelled) setFiles(result.filter((f) => !f.directory).slice(0, 8));
        })
        .catch((e) => {
          if (!cancelled) onError(errorText(e));
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, mention, onError]);
  const items =
    slash !== undefined
      ? commands
          .filter((c) => textOf(c.name).toLowerCase().includes(slash.toLowerCase()))
          .slice(0, 8)
          .map((c) => ({ key: textOf(c.name), label: `/${textOf(c.name)}`, description: textOf(c.description) }))
      : mention !== undefined
        ? files.map((f) => ({ key: f.path, label: f.path }))
        : [];
  const select = (key: string): void => {
    if (slash !== undefined) setText(`/${key} `);
    else {
      const path = `${snapshot.conversation.cwd}/${key}`;
      setAttachments((old) =>
        old.some((a) => a.path === path) ? old : [...old, { path, name: key.split('/').at(-1) || key }]
      );
      setText(text.replace(/@[^\s]*$/, `@${key} `));
    }
    setActive(0);
  };
  const send = async (): Promise<void> => {
    if (sending || (!text.trim() && !attachments.length)) return;
    const sentText = text;
    const sentAttachments = attachments;
    lastSent.current = { text: sentText, attachments: sentAttachments };
    setSending(true);
    onError('');
    setText('');
    setAttachments([]);
    try {
      await invoke('send', { id, text: sentText, attachments: sentAttachments, mode });
    } catch (e) {
      setText((current) => current || sentText);
      setAttachments((current) => (current.length ? current : sentAttachments));
      onError(errorText(e));
    } finally {
      setSending(false);
    }
  };
  const delegate = async (): Promise<void> => {
    const goal = text.trim();
    if (sending || !goal) return;
    setSending(true);
    onError('');
    try {
      await invoke('dispatch', { id, goal, attachments });
      setText('');
      setAttachments([]);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setSending(false);
    }
  };
  const attach = async (): Promise<void> => {
    try {
      const items = await invoke('chooseFiles', undefined);
      setAttachments((old) => [...old, ...items]);
    } catch (e) {
      onError(errorText(e));
    }
  };
  const addFiles = async (incoming: File[]): Promise<void> => {
    const additions: PiAttachment[] = [];
    for (const file of incoming) {
      const path = window.aionPi?.filePath(file);
      if (path) additions.push({ path, name: file.name });
      else if (
        ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) &&
        file.size <= 16 * 1024 * 1024
      ) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('attachment_invalid'));
          reader.readAsDataURL(file);
        });
        additions.push({ name: file.name, data, mimeType: file.type });
      } else throw new Error('file_too_large');
    }
    setAttachments((old) => [...old, ...additions]);
  };
  const changeInput = (value: string): void => {
    setText(value);
    setActive(0);
  };
  const paste: React.ClipboardEventHandler = (event) => {
    const incoming = Array.from(event.clipboardData.files);
    if (incoming.length) {
      event.preventDefault();
      void addFiles(incoming).catch((e) => onError(errorText(e)));
    }
  };
  const keyDown = (event: React.KeyboardEvent): void => {
    if (composition.current || event.nativeEvent.isComposing) return;
    if (items.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (items.length && ['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault();
      select(items[active % items.length].key);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const dragHandlers: React.HTMLAttributes<HTMLDivElement> = {
    onDragOver: (event) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event) => {
      event.preventDefault();
      setDragging(false);
      void addFiles(Array.from(event.dataTransfer.files)).catch((e) => onError(errorText(e)));
    },
  };
  const workspace = chooseFolder && (
    <div className='flex items-center mb-10px min-w-0'>
      <Button
        size='small'
        type='text'
        className={guidStyles.workspaceEmptyBtn}
        icon={<FolderOpen size={14} />}
        title={snapshot.conversation.managedFolder ? t('common.pi.chooseFolder') : snapshot.conversation.cwd}
        onClick={chooseFolder}
      >
        {snapshot.conversation.managedFolder
          ? t('common.pi.chooseFolder')
          : snapshot.conversation.cwd.split('/').at(-1)}
      </Button>
    </div>
  );
  const menu =
    items.length > 0 ? (
      <SlashCommandMenu
        title={t(slash !== undefined ? 'common.pi.commands' : 'common.pi.projectFiles')}
        items={items}
        activeIndex={active}
        onHoverItem={setActive}
        onSelectItem={(item) => select(item.key)}
        emptyText={t('common.pi.noMatch')}
        loadingText={t('common.pi.loading')}
      />
    ) : undefined;
  const attachmentList = attachments.length > 0 && (
    <Space wrap className='my-8px'>
      {attachments.map((item, index) => (
        <Tag
          key={`${item.name}-${index}`}
          closable
          onClose={() => setAttachments((old) => old.filter((_, i) => i !== index))}
        >
          {item.name}
        </Tag>
      ))}
    </Space>
  );
  const attachButton = (
    <Tooltip content={t('common.pi.attachments')}>
      <Button
        aria-label={t('common.pi.attachments')}
        shape='circle'
        className='!bg-2 !border-none'
        icon={<Plus size={14} />}
        onClick={() => void attach()}
      />
    </Tooltip>
  );
  const actions = (
    <>
      <div className={guidStyles.actionConfigGroup}>
        <ModelControls snapshot={snapshot} onError={onError} />
      </div>
      {view.streaming && (
        <Select
          size='small'
          className='w-110px'
          value={mode}
          onChange={setMode}
          options={[
            { value: 'steer', label: t('common.pi.steer') },
            { value: 'followUp', label: t('common.pi.followUp') },
          ]}
        />
      )}
      {view.streaming && (
        <Tooltip content={t('common.pi.stop')}>
          <Button
            data-testid='pi-stop'
            aria-label={t('common.pi.stop')}
            shape='circle'
            icon={<Square />}
            onClick={() =>
              void invoke('command', { id, command: { type: 'abort' } }).catch((e) => onError(errorText(e)))
            }
          />
        </Tooltip>
      )}
      {!view.streaming && text.trim() && (
        <Tooltip content={t('common.pi.delegateHint')}>
          <Button
            data-testid='pi-delegate'
            aria-label={t('common.pi.delegate')}
            type='text'
            shape='circle'
            icon={<Peoples size={16} />}
            onClick={() => void delegate()}
          />
        </Tooltip>
      )}
      <Tooltip content={t('common.pi.send')}>
        {welcome ? (
          <GuidSendButton
            loading={sending}
            disabled={!text.trim() && !attachments.length}
            onSend={() => void send()}
            label={t('common.pi.send')}
            testId='pi-send'
          />
        ) : (
          <Button
            data-testid='pi-send'
            aria-label={t('common.pi.send')}
            className={`send-button-custom ${!text.trim() && !attachments.length ? 'send-button-custom--disabled' : 'send-button-custom--enabled'}`}
            type='text'
            shape='circle'
            icon={<ArrowUp size={16} />}
            loading={sending}
            disabled={!text.trim() && !attachments.length}
            onClick={() => void send()}
          />
        )}
      </Tooltip>
    </>
  );
  const actionRow = welcome ? (
    <div className={guidStyles.actionRow}>
      <div className={guidStyles.actionTools}>{attachButton}</div>
      <div className={guidStyles.actionSubmit}>{actions}</div>
    </div>
  ) : (
    <SendBoxActionRow
      tools={
        <div className='sendbox-tools'>
          <span className='sendbox-left-tool-group'>{attachButton}</span>
        </div>
      }
      actions={actions}
    />
  );
  return (
    <div>
      {(view.queue.steering.length > 0 || view.queue.followUp.length > 0) && (
        <div className={styles.queue}>
          <strong>{t('common.pi.queue')}</strong>
          {[...view.queue.steering, ...view.queue.followUp].map((item, index) => (
            <p key={index}>{item}</p>
          ))}
          <Button
            size='mini'
            onClick={() =>
              void invoke('command', { id, command: { type: 'clear_queue' } })
                .then((result) => {
                  const returned = [
                    ...(Array.isArray(result.steering) ? result.steering : []),
                    ...(Array.isArray(result.followUp) ? result.followUp : []),
                  ];
                  setText((old) => [old, ...returned].filter(Boolean).join('\n\n'));
                })
                .catch((e) => onError(errorText(e)))
            }
          >
            {t('common.pi.clearQueue')}
          </Button>
        </div>
      )}
      {Object.values(view.widgets).map((lines, index) => (
        <div className={styles.widget} key={index}>
          {lines.join('\n')}
        </div>
      ))}
      {welcome ? (
        <GuidInputCard
          input={text}
          onInputChange={changeInput}
          onKeyDown={keyDown}
          onPaste={paste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('common.pi.placeholder')}
          isInputActive={focused}
          isFileDragging={dragging}
          {...ring}
          dragHandlers={dragHandlers}
          files={[]}
          onRemoveFile={() => undefined}
          actionRow={actionRow}
          slashCommandMenu={menu}
          inputHeader={workspace}
          attachmentsSlot={attachmentList}
          workspaceFootnote={null}
          showUploadProgress={false}
          inputTestId='pi-composer'
          menuPlacement='above'
          workspaceDir=''
          onSelectWorkspace={() => undefined}
          onClearWorkspace={() => undefined}
        />
      ) : (
        <SendBoxPanel
          isOverlayOpen={Boolean(menu)}
          isFileDragging={dragging}
          isInputActive={focused}
          {...ring}
          dragHandlers={dragHandlers}
        >
          {workspace}
          {menu && <div className='absolute start-0 end-0 bottom-[calc(100%+4px)] z-70'>{menu}</div>}
          {attachmentList}
          <Input.TextArea
            data-testid='pi-composer'
            value={text}
            onChange={changeInput}
            placeholder={t('common.pi.placeholder')}
            autoSize={{ minRows: 2, maxRows: 10 }}
            spellCheck={false}
            className='ps-0 pe-0 !b-none focus:shadow-none m-0 !bg-transparent !focus:bg-transparent !hover:bg-transparent lh-[20px] !resize-none text-14px mb-8px'
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onCompositionStart={() => {
              composition.current = true;
            }}
            onCompositionEnd={() => {
              composition.current = false;
            }}
            onPaste={paste}
            onKeyDown={keyDown}
          />
          {actionRow}
        </SendBoxPanel>
      )}
      <div className={styles.statusLine}>
        <span>
          {view.compacting
            ? t('common.pi.compacting')
            : view.streaming
              ? t('common.pi.running')
              : Object.values(view.statuses).filter(Boolean).join(' · ')}
        </span>
        <span>{formatStats(view.stats, t('common.pi.tokens'), t('common.pi.cost'))}</span>
      </div>
    </div>
  );
}

function formatStats(stats: JsonRecord | undefined, tokensLabel: string, costLabel: string): string {
  if (!stats) return '';
  const tokens = recordOf(stats.tokens);
  const cost = stats.cost;
  const total =
    typeof tokens.total === 'number' ? tokens.total : (Number(tokens.input) || 0) + (Number(tokens.output) || 0);
  return [
    total ? `${tokensLabel}: ${total.toLocaleString()}` : '',
    typeof cost === 'number' && cost > 0 ? `${costLabel}: $${cost.toFixed(4)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
