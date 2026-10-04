import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, ConfigProvider, Modal, Spin } from '@arco-design/web-react';
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import enUS from '@arco-design/web-react/es/locale/en-US';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';
import { FolderOpen } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { setActiveTheme } from '@/renderer/utils/theme/applyTheme';
import { configService } from '@/common/config/configService';
import '@/renderer/services/i18n';
import '@/renderer/styles/themes/index.css';
import '@/renderer/styles/arco-override.css';
import '@/renderer/styles/markdown.css';
import 'virtual:uno.css';
import type { PiConversation, PiSnapshot, PiTaskTree } from '@/common/pi';
import GuidPageFrame from '@/renderer/pages/guid/components/GuidPageFrame';
import { invoke, errorText } from './utils/client';
import { getDraft, saveDraft } from './utils/drafts';
import { useConversation } from './useConversation';
import Sidebar from './components/Sidebar';
import Settings from './components/Settings';
import AuthDialog from './components/AuthDialog';
import PiDialog from './components/PiDialog';
import NativeLayout from './components/NativeLayout';
import NativeConversation from './components/NativeConversation';
import FilesPanel from './components/FilesPanel';
import BotPlaza from './BotPlaza';
import ArticleLibrary from './ArticleLibrary';
import './PiDesktop.module.css';

function App() {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<string | undefined>(localStorage.getItem('pi.selected') || undefined);
  const [conversations, setConversations] = useState<PiConversation[]>([]);
  const [taskTree, setTaskTree] = useState<PiTaskTree>({
    version: 1,
    limits: {
      maxDepth: 3,
      maxTotalTasks: 12,
      maxConcurrent: 4,
      maxModelCalls: 24,
      maxInputTokens: 200000,
      maxOutputTokens: 100000,
    },
    nodes: [],
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const creatingInitial = useRef(false);
  const [settings, setSettings] = useState(false);
  const [page, setPage] = useState<'chat' | 'bots' | 'articles'>(() => {
    const saved = localStorage.getItem('pi.page');
    return saved === 'bots' || saved === 'articles' ? saved : 'chat';
  });
  const [newDialog, setNewDialog] = useState(false);
  const [panel, setPanel] = useState(localStorage.getItem('pi.panel') !== 'false');
  const [unread, setUnread] = useState(new Set<string>());
  const [requested, setRequested] = useState<{ path: string; nonce: number }>();
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(false);
  const { snapshot, error: openError, reload } = useConversation(selected);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextConversations, nextTaskTree] = await Promise.all([
        invoke('list', undefined),
        invoke('taskTree', undefined),
      ]);
      setConversations(nextConversations);
      setTaskTree(nextTaskTree);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  const checkConfig = useCallback(async (): Promise<void> => {
    try {
      const catalog = await invoke('catalog', undefined);
      setConfigured(
        Boolean(
          catalog.settings.provider &&
          catalog.settings.model &&
          catalog.providers.some((p) => p.id === catalog.settings.provider && p.configured)
        )
      );
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  const select = useCallback((id?: string) => {
    setPage('chat');
    localStorage.setItem('pi.page', 'chat');
    setSelected(id);
    setRequested(undefined);
    setError('');
    if (id) localStorage.setItem('pi.selected', id);
    else localStorage.removeItem('pi.selected');
    setUnread((old) => {
      const next = new Set(old);
      if (id) next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    void refresh();
    void checkConfig();
  }, [refresh, checkConfig]);
  useEffect(() => {
    const changeTheme = (): void => {
      const preference = localStorage.getItem('pi.theme') || 'system';
      void configService
        .whenReady()
        .then(() => setActiveTheme(preference))
        .catch((e) => setError(errorText(e)));
    };
    changeTheme();
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', changeTheme);
    window.addEventListener('pi-theme', changeTheme);
    return () => {
      media.removeEventListener('change', changeTheme);
      window.removeEventListener('pi-theme', changeTheme);
    };
  }, []);
  useEffect(
    () =>
      window.aionPi?.subscribe((event) => {
        if (event.kind === 'changed') void refresh();
        if (event.kind === 'navigate') select(event.id);
        if (event.kind === 'attention' && (event.id !== selected || !document.hasFocus()))
          setUnread((old) => new Set([...old, event.id]));
      }),
    [refresh, selected, select]
  );
  useEffect(() => {
    const focus = (): void => {
      void refresh();
      if (selected)
        setUnread((old) => {
          const next = new Set(old);
          next.delete(selected);
          return next;
        });
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh, selected]);
  const create = async (cwd?: string): Promise<void> => {
    try {
      const created = await invoke('create', { cwd });
      setNewDialog(false);
      select(created.conversation.id);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    if (selected || page !== 'chat') {
      creatingInitial.current = false;
      return;
    }
    if (creatingInitial.current) return;
    creatingInitial.current = true;
    let cancelled = false;
    void invoke('create', {})
      .then((created) => {
        if (!cancelled) select(created.conversation.id);
        void refresh();
      })
      .catch((failure) => {
        if (!cancelled) setError(errorText(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [selected, page, select, refresh]);
  const forked = (next: PiSnapshot, text: string): void => {
    const draft = getDraft(next.conversation.id);
    saveDraft(next.conversation.id, { ...draft, text: [draft.text, text].filter(Boolean).join('\n\n') });
    select(next.conversation.id);
    void refresh();
  };
  const showPreview = (path: string): void => {
    setPanel(true);
    setRequested({ path, nonce: Date.now() });
  };
  const visibleError = error || openError || (snapshot?.view.error ? errorText(snapshot.view.error) : '');
  return (
    <ConfigProvider locale={i18n.language === 'zh-CN' ? zhCN : i18n.language === 'zh-TW' ? zhTW : enUS}>
      <NativeLayout
        search={() => setSearchOpen(true)}
        sider={
          <Sidebar
            searchOpen={searchOpen}
            closeSearch={() => setSearchOpen(false)}
            conversations={conversations}
            taskTree={taskTree}
            selected={page === 'chat' ? selected : undefined}
            unread={unread}
            select={select}
            create={() => void create()}
            settings={() => setSettings(true)}
            refresh={() => void refresh()}
            onError={setError}
            plazaOpen={page === 'bots'}
            plaza={() => {
              setPage('bots');
              localStorage.setItem('pi.page', 'bots');
            }}
            articlesOpen={page === 'articles'}
            articles={() => {
              setPage('articles');
              localStorage.setItem('pi.page', 'articles');
            }}
          />
        }
        adjacent={
          page === 'chat' &&
          snapshot &&
          panel &&
          (snapshot.view.messages.length > 0 || !snapshot.conversation.managedFolder) ? (
            <FilesPanel
              key={selected}
              id={snapshot.conversation.id}
              running={snapshot.view.streaming}
              requested={requested}
            />
          ) : undefined
        }
      >
        {page === 'bots' ? (
          <div className='flex flex-1 min-h-0 bg-base'>
            <BotPlaza
              opened={(created) => {
                select(created.conversation.id);
                void refresh();
              }}
              configure={() => setSettings(true)}
            />
          </div>
        ) : page === 'articles' ? (
          <div className='flex flex-1 min-h-0 bg-base'>
            <ArticleLibrary />
          </div>
        ) : (
          <>
            {(visibleError || !configured) && (
              <Alert
                data-testid={visibleError ? 'pi-error' : 'pi-setup-notice'}
                type={visibleError ? 'error' : 'info'}
                content={visibleError || t('common.pi.needsSetup')}
                action={
                  !configured ? (
                    <Button data-testid='pi-configure' size='small' onClick={() => setSettings(true)}>
                      {t('common.pi.configure')}
                    </Button>
                  ) : openError ? (
                    <Button size='mini' onClick={() => void reload()}>
                      {t('common.pi.retry')}
                    </Button>
                  ) : undefined
                }
              />
            )}
            {snapshot ? (
              <>
                <NativeConversation
                  key={selected}
                  snapshot={snapshot}
                  task={taskTree.nodes.find((node) => node.sessionId === selected)}
                  refresh={() => void refresh()}
                  onError={setError}
                  forked={forked}
                  preview={showPreview}
                  chooseFolder={() => setNewDialog(true)}
                  headerExtra={
                    <Button
                      size='small'
                      type='text'
                      icon={<FolderOpen />}
                      onClick={() => {
                        setPanel(!panel);
                        localStorage.setItem('pi.panel', String(!panel));
                      }}
                    >
                      {t(panel ? 'common.pi.hidePanel' : 'common.pi.showPanel')}
                    </Button>
                  }
                />
                <PiDialog
                  dialog={snapshot.view.dialogs[0]}
                  respond={async (response) => {
                    try {
                      await invoke('respond', { id: snapshot.conversation.id, response });
                    } catch (e) {
                      setError(errorText(e));
                    }
                  }}
                />
              </>
            ) : (
              <GuidPageFrame>
                <div className='flex justify-center py-24px'>
                  <Spin tip={t('common.pi.loading')} />
                </div>
              </GuidPageFrame>
            )}
          </>
        )}
      </NativeLayout>
      <Settings
        visible={settings}
        close={() => setSettings(false)}
        changed={() => {
          void checkConfig();
          void reload();
        }}
      />
      <AuthDialog />
      <Modal
        title={t('common.pi.newConversation')}
        visible={newDialog}
        footer={null}
        onCancel={() => setNewDialog(false)}
      >
        <Button
          long
          type='primary'
          icon={<FolderOpen />}
          onClick={() =>
            void invoke('chooseFolder', undefined)
              .then((cwd) => (cwd ? create(cwd) : undefined))
              .catch((e) => setError(errorText(e)))
          }
        >
          {t('common.pi.chooseFolder')}
        </Button>
        {conversations.some((c) => !c.managedFolder) && (
          <>
            <h4>{t('common.pi.recentFolders')}</h4>
            {[...new Set(conversations.filter((c) => !c.managedFolder).map((c) => c.cwd))].slice(0, 8).map((cwd) => (
              <Button long className='justify-start mt-6px' type='text' key={cwd} onClick={() => void create(cwd)}>
                {cwd}
              </Button>
            ))}
          </>
        )}
      </Modal>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
