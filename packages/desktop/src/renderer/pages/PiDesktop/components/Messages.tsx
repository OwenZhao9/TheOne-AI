import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Image, Message, Space, Spin, Tooltip } from '@arco-design/web-react';
import { Copy, Branch } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '@/renderer/components/Markdown';
import {
  MessageBubble,
  MessageActionRow,
} from '@/renderer/pages/conversation/Messages/components/MessageText/MessageBubble';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import MessageThinking from '@/renderer/pages/conversation/Messages/components/MessageThinking';
import '@/renderer/pages/conversation/Messages/messages.css';
import type { IMessageToolCall } from '@/common/chat/chatLib';
import MessageToolGroupSummary from '@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary';
import type { PiMessage, PiSnapshot } from '@/common/pi';
import { invoke, errorText, messageText } from '../utils/client';
import styles from '../PiDesktop.module.css';

export default function Messages({
  snapshot,
  forked,
  preview,
  onError,
}: {
  snapshot: PiSnapshot;
  forked: (snapshot: PiSnapshot, text: string) => void;
  preview: (path: string) => void;
  onError: (value: string) => void;
}) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [count, setCount] = useState(120);
  const [branching, setBranching] = useState(false);
  const messages = snapshot.view.messages;
  const toolResults = new Map(
    messages.filter((m) => m.role === 'toolResult' && m.toolCallId).map((m) => [m.toolCallId!, m])
  );
  const visibleMessages = messages.slice(-count).filter((m) => m.role !== 'system');
  const visibleCalls = new Set(
    visibleMessages.flatMap((m) => m.content.filter((b) => b.type === 'toolCall').map((b) => b.id))
  );
  useEffect(() => {
    if (follow.current) scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [messages, snapshot.view.streaming]);
  useEffect(() => {
    setCount(120);
    follow.current = true;
  }, [snapshot.conversation.id]);
  const branch = async (message: PiMessage): Promise<void> => {
    if (!message.entryId) return;
    setBranching(true);
    try {
      const result = await invoke('fork', { id: snapshot.conversation.id, entryId: message.entryId });
      if (!result.cancelled) {
        forked(result.snapshot, result.text);
        if (message.content.some((b) => b.type === 'image')) Message.info(t('common.pi.noImageRestore'));
      }
    } catch (error) {
      onError(errorText(error));
    } finally {
      setBranching(false);
    }
  };
  return (
    <div
      className='flex-1 min-h-0 overflow-y-auto pb-10px box-border -mx-20px px-20px'
      ref={scroll}
      data-testid='pi-messages'
      onScroll={() => {
        const el = scroll.current;
        if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      }}
    >
      {messages.length > count && (
        <Button type='text' long onClick={() => setCount((old) => old + 120)}>
          {t('common.pi.loadMore')}
        </Button>
      )}
      {visibleMessages.map((message) => {
        const user = message.role === 'user';
        const tool = message.role === 'toolResult';
        const text = messageText(message);
        const thinking = message.content
          .filter((b) => b.type === 'thinking')
          .map((b) => b.thinking || '')
          .join('\n');
        const images = message.content.filter((b) => b.type === 'image' && b.data && b.mimeType);
        const calls = message.content.filter((b) => b.type === 'toolCall');
        const tools: IMessageToolCall[] = calls.map((call, index) => {
          const result = call.id ? toolResults.get(call.id) : undefined;
          return {
            id: `${message.id}-tool-${index}`,
            msg_id: message.id,
            conversation_id: snapshot.conversation.id,
            type: 'tool_call',
            position: 'left',
            created_at: message.timestamp,
            content: {
              call_id: call.id || `${message.id}-${index}`,
              name: call.name || t('common.pi.tools'),
              args: call.arguments || {},
              output: result ? messageText(result) : undefined,
              status: result
                ? result.isError
                  ? 'error'
                  : 'completed'
                : snapshot.view.streaming
                  ? 'running'
                  : undefined,
            },
          };
        });
        if (tool && (!message.toolCallId || !visibleCalls.has(message.toolCallId)))
          tools.push({
            id: message.id,
            msg_id: message.id,
            conversation_id: snapshot.conversation.id,
            type: 'tool_call',
            position: 'left',
            created_at: message.timestamp,
            content: {
              call_id: message.toolCallId || message.id,
              name: message.toolName || t('common.pi.tools'),
              args: {},
              output: text,
              status: message.isError ? 'error' : 'completed',
            },
          });
        if (tool && !tools.length && !images.length && !message.errorMessage) return null;
        return (
          <div
            className={`${getChatSurfaceWidthClass()} min-w-0 message-item px-8px mt-10px flex flex-col group ${user ? 'items-end' : 'items-start'}`}
            key={message.id}
            data-testid={`pi-message-${message.role}`}
          >
            {thinking && (
              <MessageThinking
                message={{
                  id: `${message.id}-thinking`,
                  msg_id: message.id,
                  conversation_id: snapshot.conversation.id,
                  type: 'thinking',
                  position: 'left',
                  created_at: message.timestamp,
                  content: {
                    content: thinking,
                    status: message.entryId || !snapshot.view.streaming ? 'done' : 'thinking',
                  },
                }}
              />
            )}
            {!tool && text && (
              <MessageBubble user={user}>
                {user ? (
                  <div className='whitespace-pre-wrap [overflow-wrap:anywhere]'>{text}</div>
                ) : (
                  <MarkdownView onLocalFileLink={(path) => preview(path)}>{text}</MarkdownView>
                )}
              </MessageBubble>
            )}
            {tools.length > 0 && (
              <div className='w-full my-8px'>
                <MessageToolGroupSummary messages={tools} />
              </div>
            )}
            {images.length > 0 && (
              <Image.PreviewGroup>
                <Space wrap>
                  {images.map((block, index) => (
                    <Image
                      key={index}
                      src={`data:${block.mimeType};base64,${block.data}`}
                      width={140}
                      height={100}
                      className={styles.messageImage}
                    />
                  ))}
                </Space>
              </Image.PreviewGroup>
            )}
            {message.errorMessage && <Alert type='error' content={errorText(message.errorMessage)} />}
            {(user || message.role === 'assistant') && (
              <MessageActionRow user={user}>
                <Tooltip content={t('common.pi.copy')}>
                  <Button
                    type='text'
                    className='opacity-0 group-hover:opacity-100 focus-visible:opacity-100 !text-t-secondary'
                    size='mini'
                    aria-label={t('common.pi.copy')}
                    icon={<Copy />}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(text)
                        .then(() => Message.success(t('common.pi.copied')))
                        .catch((error) => onError(errorText(error)))
                    }
                  />
                </Tooltip>
                {message.entryId && !snapshot.view.streaming && !snapshot.view.syncing && (
                  <Tooltip content={t('common.pi.fork')}>
                    <Button
                      data-testid='pi-fork'
                      type='text'
                      className='opacity-0 group-hover:opacity-100 focus-visible:opacity-100 !text-t-secondary'
                      size='mini'
                      loading={branching}
                      aria-label={t('common.pi.fork')}
                      icon={<Branch />}
                      onClick={() => void branch(message)}
                    />
                  </Tooltip>
                )}
              </MessageActionRow>
            )}
          </div>
        );
      })}
      {snapshot.view.streaming && (
        <div className={`${getChatSurfaceWidthClass()} ${styles.runStatus} px-8px py-12px`}>
          <Spin size={14} /> {t('common.pi.running')}
        </div>
      )}
    </div>
  );
}
