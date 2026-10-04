import React, { useEffect, useState } from 'react';
import { Button, Input, Modal } from '@arco-design/web-react';
import { BookOpen, Check, Delete, Down, Edit, Pin, Robot, Right, Pause, Message as ChatIcon } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { PiConversation, PiTaskNode, PiTaskTree } from '@/common/pi';
import SiderToolbar from '@/renderer/components/layout/Sider/SiderNav/SiderToolbar';
import SiderFooter from '@/renderer/components/layout/Sider/SiderFooter';
import SiderItem from '@/renderer/components/layout/Sider/SiderItem';
import { getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { invoke, errorText } from '../utils/client';
import { hasDraft } from '../utils/drafts';
import styles from '../PiDesktop.module.css';

export default function Sidebar({
  conversations,
  selected,
  unread,
  select,
  create,
  settings,
  refresh,
  onError,
  plaza,
  plazaOpen,
  articles,
  articlesOpen,
  searchOpen,
  closeSearch,
  taskTree,
}: {
  conversations: PiConversation[];
  selected?: string;
  unread: Set<string>;
  select: (id?: string) => void;
  create: () => void;
  settings: () => void;
  refresh: () => void;
  onError: (value: string) => void;
  plaza: () => void;
  plazaOpen: boolean;
  articles: () => void;
  articlesOpen: boolean;
  searchOpen: boolean;
  closeSearch: () => void;
  taskTree: PiTaskTree;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [, updateDrafts] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('pi.taskTree.expanded') || '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (!taskTree.nodes.length || localStorage.getItem('pi.taskTree.expanded') !== null) return;
    const roots = taskTree.nodes.filter((node) => !node.parentSessionId).map((node) => node.sessionId);
    setExpanded(new Set(roots));
    localStorage.setItem('pi.taskTree.expanded', JSON.stringify(roots));
  }, [taskTree.nodes]);
  useEffect(() => {
    const changed = () => updateDrafts((value) => value + 1);
    window.addEventListener('pi-draft-changed', changed);
    return () => window.removeEventListener('pi-draft-changed', changed);
  }, []);
  const [renaming, setRenaming] = useState<PiConversation>();
  const [title, setTitle] = useState('');
  const action = async (conversation: PiConversation, key: string): Promise<void> => {
    if (key === 'rename') {
      setRenaming(conversation);
      setTitle(conversation.title);
      return;
    }
    if (key === 'remove') {
      Modal.confirm({
        title: t('common.pi.confirmRemove'),
        content: conversation.title || t('common.pi.unnamed'),
        okText: t('common.pi.remove'),
        cancelText: t('common.pi.cancel'),
        onOk: async () => {
          try {
            await invoke('remove', { id: conversation.id });
            if (selected === conversation.id) select(undefined);
            refresh();
          } catch (error) {
            onError(errorText(error));
            throw error;
          }
        },
      });
      return;
    }
    try {
      await invoke('pin', { id: conversation.id, pinned: !conversation.pinned });
      refresh();
    } catch (error) {
      onError(errorText(error));
    }
  };
  const taskIds = new Set(taskTree.nodes.map((node) => node.sessionId));
  const visible = conversations.filter(
    (c) => !taskIds.has(c.id) && (c.messageCount > 0 || c.running || hasDraft(c.id))
  );
  const renderConversation = (c: PiConversation) => (
    <div
      key={c.id}
      title={`${c.title}\n${c.bot?.name || ''}\n${c.managedFolder ? t('common.pi.chatWithoutFolder') : c.cwd}`}
    >
      <SiderItem
        name={c.title || t('common.pi.unnamed')}
        selected={selected === c.id}
        pinned={c.pinned}
        icon={
          c.running ? (
            <span className={styles.runningDot} />
          ) : unread.has(c.id) ? (
            <span className={styles.unreadDot} />
          ) : (
            <ChatIcon size={16} />
          )
        }
        onClick={() => {
          select(c.id);
          closeSearch();
        }}
        menuItems={[
          { key: 'pin', icon: <Pin size={14} />, label: t(c.pinned ? 'common.pi.unpin' : 'common.pi.pin') },
          { key: 'rename', icon: <Edit size={14} />, label: t('common.pi.rename') },
          {
            key: 'remove',
            icon: <Delete size={14} />,
            label: t('common.pi.remove'),
            danger: true,
            disabled: c.running,
          },
        ]}
        onMenuAction={(key) => void action(c, key)}
      />
    </div>
  );
  const toggleExpanded = (id: string): void => {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('pi.taskTree.expanded', JSON.stringify([...next]));
      return next;
    });
  };
  const renderTask = (node: PiTaskNode, children: Map<string, PiTaskNode[]>): React.ReactNode => {
    const nested = children.get(node.sessionId) || [];
    const isExpanded = expanded.has(node.sessionId);
    const statusIcon =
      node.status === 'completed' ? (
        <Check size={14} className={node.acceptance.status === 'verified' ? 'text-success' : 'text-warning'} />
      ) : node.status === 'stopped' ? (
        <Pause size={14} className='text-t-tertiary' />
      ) : (
        <span className={`${styles.taskDot} ${styles[`taskDot-${node.status}`]}`} />
      );
    return (
      <React.Fragment key={node.sessionId}>
        <div
          data-testid={`pi-task-${node.sessionId}`}
          className='flex items-center min-w-0'
          style={{ paddingInlineStart: `${node.depth * 14}px` }}
        >
          <Button
            type='text'
            size='mini'
            className='!w-20px !h-26px !p-0 shrink-0 text-t-tertiary'
            aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
            icon={nested.length ? isExpanded ? <Down size={12} /> : <Right size={12} /> : undefined}
            onClick={() => toggleExpanded(node.sessionId)}
          />
          <div className='min-w-0 flex-1'>
            <SiderItem
              name={
                node.research && node.research.state !== 'approved'
                  ? `${node.title} · ${node.research.state === 'awaiting_approval' ? '等你确认' : node.research.state === 'failed' ? '调研需重试' : '查找案例和技能'}`
                  : node.title
              }
              selected={selected === node.sessionId}
              icon={statusIcon}
              onClick={() => {
                select(node.sessionId);
                closeSearch();
              }}
              menuItems={[
                ...(node.status === 'running' || node.status === 'waiting'
                  ? [
                      { key: 'stop', icon: <Pause size={14} />, label: t('common.pi.stopTask') },
                      { key: 'stopTree', icon: <Pause size={14} />, label: t('common.pi.stopSubtree') },
                    ]
                  : []),
                ...(node.status === 'stopped' ||
                node.status === 'failed' ||
                node.resumeState === 'needs_confirmation' ||
                node.needsRevalidation
                  ? [{ key: 'resume', icon: <Right size={14} />, label: t('common.pi.resumeTask') }]
                  : []),
                ...(node.status === 'completed' && node.acceptance.status !== 'verified'
                  ? [
                      { key: 'verify', icon: <Check size={14} />, label: t('common.pi.verifyTask') },
                      ...(node.acceptance.status === 'pending'
                        ? [{ key: 'reject', icon: <Pause size={14} />, label: t('common.pi.rejectTask') }]
                        : []),
                    ]
                  : []),
              ]}
              onMenuAction={(key) => {
                if (key === 'verify' || key === 'reject') {
                  let notes = '';
                  Modal.confirm({
                    title: key === 'verify' ? t('common.pi.verifyTask') : t('common.pi.rejectTask'),
                    content: (
                      <div>
                        <p>{node.acceptanceCriteria.join(' · ')}</p>
                        <Input.TextArea
                          placeholder={t('common.pi.taskReviewEvidence')}
                          onChange={(value) => {
                            notes = value;
                          }}
                        />
                      </div>
                    ),
                    onOk: async () => {
                      try {
                        await invoke('verifyTask', { id: node.sessionId, accepted: key === 'verify', notes });
                        await refresh();
                      } catch (error) {
                        onError(errorText(error));
                        throw error;
                      }
                    },
                  });
                  return;
                }
                const promise =
                  key === 'resume'
                    ? invoke('resumeTask', { id: node.sessionId, subtree: true })
                    : invoke('stopTask', { id: node.sessionId, subtree: key === 'stopTree' });
                void promise.then(refresh).catch((error) => onError(errorText(error)));
              }}
            />
          </div>
        </div>
        {isExpanded && nested.map((child) => renderTask(child, children))}
      </React.Fragment>
    );
  };
  const renderTaskTree = (): React.ReactNode => {
    if (!taskTree.nodes.length) return null;
    const children = new Map<string, PiTaskNode[]>();
    for (const node of taskTree.nodes) {
      const siblings = children.get(node.parentSessionId || '') || [];
      siblings.push(node);
      children.set(node.parentSessionId || '', siblings);
    }
    for (const siblings of children.values()) siblings.sort((a, b) => a.createdAt - b.createdAt);
    return (
      <section className='mt-12px'>
        <div className='sider-section-title text-12px text-t-tertiary px-12px py-8px flex items-center gap-4px'>
          <Robot size={13} />
          {t('common.pi.taskTree')}
        </div>
        {children.get('')?.map((node) => renderTask(node, children))}
      </section>
    );
  };
  return (
    <div className='size-full flex flex-col min-h-0'>
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden gap-2px'>
        <div data-testid='pi-new-conversation'>
          <SiderToolbar
            isMobile={false}
            isBatchMode={false}
            collapsed={false}
            siderTooltipProps={getSiderTooltipProps()}
            onNewChat={create}
          />
        </div>
        <div data-testid='pi-bot-plaza'>
          <SiderItem name={t('common.pi.bots.title')} icon={<Robot size={16} />} selected={plazaOpen} onClick={plaza} />
        </div>
        <div data-testid='pi-article-library'>
          <SiderItem
            name={t('common.pi.articles.title')}
            icon={<BookOpen size={16} />}
            selected={articlesOpen}
            onClick={articles}
          />
        </div>
        <nav className='flex-1 min-h-0 overflow-y-auto mt-16px'>
          <div className='sider-section-title text-12px text-t-tertiary px-12px py-8px'>
            {t('conversation.history.recents')}
          </div>
          {renderTaskTree()}
          {!visible.length && <p className={styles.muted}>{t('common.pi.emptyHistory')}</p>}
          {visible.map(renderConversation)}
        </nav>
      </div>
      <div data-testid='pi-settings'>
        <SiderFooter
          isMobile={false}
          isSettings={false}
          theme='light'
          siderTooltipProps={getSiderTooltipProps()}
          onSettingsClick={settings}
          onThemeToggle={() => undefined}
        />
      </div>
      <Modal title={t('common.pi.search')} visible={searchOpen} footer={null} onCancel={closeSearch} unmountOnExit>
        <Input.Search
          data-testid='pi-search'
          autoFocus
          value={query}
          onChange={setQuery}
          placeholder={t('common.pi.search')}
          allowClear
          className='mb-12px'
        />
        <div className='max-h-400px overflow-y-auto'>
          {conversations
            .filter((c) => `${c.title} ${c.cwd}`.toLowerCase().includes(query.toLowerCase()))
            .map(renderConversation)}
        </div>
      </Modal>
      <Modal
        title={t('common.pi.rename')}
        visible={Boolean(renaming)}
        okText={t('common.pi.save')}
        cancelText={t('common.pi.cancel')}
        onCancel={() => setRenaming(undefined)}
        onOk={async () => {
          if (!renaming) return;
          try {
            await invoke('rename', { id: renaming.id, title });
            setRenaming(undefined);
            refresh();
          } catch (error) {
            onError(errorText(error));
            throw error;
          }
        }}
      >
        <Input autoFocus value={title} onChange={setTitle} maxLength={200} aria-label={t('common.pi.rename')} />
      </Modal>
    </div>
  );
}
