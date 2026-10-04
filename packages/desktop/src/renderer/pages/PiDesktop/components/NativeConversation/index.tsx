import React from 'react';
import type { PiSnapshot, PiTaskNode } from '@/common/pi';
import ChatTitleEditor from '@/renderer/pages/conversation/components/ChatTitleEditor';
import { ChatContent, ChatHeader } from '@/renderer/pages/conversation/components/ChatLayout/ChatSurface';
import { useTitleRename } from '@/renderer/pages/conversation/hooks/useTitleRename';
import GuidPageFrame from '@/renderer/pages/guid/components/GuidPageFrame';
import { CHAT_SURFACE_CONTAINER_CLASS } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { useTranslation } from 'react-i18next';
import { invoke, errorText } from '../../utils/client';
import LearningLevelControls from '../../LearningLevelControls';
import Messages from '../Messages';
import Composer from '../Composer';
import ResearchPanel from './ResearchPanel';

export default function NativeConversation({
  snapshot,
  onError,
  forked,
  preview,
  chooseFolder,
  headerExtra,
  task,
  refresh,
}: {
  snapshot: PiSnapshot;
  onError: (value: string) => void;
  forked: (snapshot: PiSnapshot, text: string) => void;
  preview: (path: string) => void;
  chooseFolder: () => void;
  headerExtra?: React.ReactNode;
  task?: PiTaskNode;
  refresh?: () => void;
}) {
  const { t } = useTranslation();
  const title = snapshot.conversation.title || t('common.pi.newConversation');
  const rename = useTitleRename({
    title,
    onRename: async (value) => {
      try {
        await invoke('rename', { id: snapshot.conversation.id, title: value });
        return true;
      } catch (error) {
        onError(errorText(error));
        return false;
      }
    },
  });
  const welcome = !snapshot.view.messages.some((m) => m.role !== 'system') && !snapshot.view.streaming;
  return (
    <>
      {!welcome && (
        <ChatHeader
          title={
            <ChatTitleEditor
              {...rename}
              title={title}
              titleAreaMaxWidth={640}
              showMinimap={false}
              leading={
                snapshot.conversation.bot && (
                  <span
                    className='text-12px text-t-secondary whitespace-nowrap'
                    title={snapshot.conversation.bot.version}
                  >
                    {snapshot.conversation.bot.name}
                  </span>
                )
              }
            />
          }
          extra={
            <div className='flex items-center gap-4px'>
              <LearningLevelControls snapshot={snapshot} onError={onError} />
              {headerExtra}
            </div>
          }
        />
      )}
      <ChatContent>
        <div className={`${CHAT_SURFACE_CONTAINER_CLASS} flex-1 flex flex-col px-20px min-h-0`}>
          <div className={welcome ? 'hidden' : 'flex-1 min-h-0 flex flex-col'}>
            <Messages snapshot={snapshot} forked={forked} preview={preview} onError={onError} />
          </div>
          <GuidPageFrame welcome={welcome}>
            {welcome && (
              <div className='flex justify-end mb-8px'>
                <LearningLevelControls snapshot={snapshot} onError={onError} />
              </div>
            )}
            {welcome && snapshot.conversation.bot && (
              <div className='text-center text-14px text-t-secondary mb-16px'>{snapshot.conversation.bot.name}</div>
            )}
            {task?.research && <ResearchPanel key={task.sessionId} task={task} onError={onError} refresh={refresh} />}
            {(!task?.research || task.research.state === 'approved') && (
              <Composer snapshot={snapshot} onError={onError} chooseFolder={chooseFolder} welcome={welcome} />
            )}
          </GuidPageFrame>
        </div>
      </ChatContent>
    </>
  );
}
