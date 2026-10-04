import React, { useState } from 'react';
import { Button, Input, Tag } from '@arco-design/web-react';
import type { PiTaskNode } from '@/common/pi';
import { invoke, errorText } from '../../utils/client';

const errors: Record<string, string> = {
  task_research_network_failed: '网上资料暂时查询失败，请稍后重试。没有开始实现。',
  task_research_response_too_large: '资料过大，查询已停止。请缩小查找范围后重试。',
  task_research_interrupted: '调研被中断，请重试。没有开始实现。',
  task_research_empty_proposal: '没有收到完整方案，请重试。',
  task_research_stale: '方案已更新，请查看最新方案后再确认。',
  task_research_feedback_required: '请先填写你希望调整的内容。',
  task_research_approval_required: '请先查看方案，点击“同意并开始”后再继续。',
};

export default function ResearchPanel({
  task,
  onError,
  refresh,
}: {
  task: PiTaskNode;
  onError: (value: string) => void;
  refresh?: () => void;
}) {
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [searchTerms, setSearchTerms] = useState(task.research?.searchTerms || '');
  const research = task.research;
  if (!research) return null;
  const waiting = research.state === 'awaiting_approval';
  const failed = research.state === 'failed';
  const approved = research.state === 'approved';
  const review = async (accepted: boolean): Promise<void> => {
    setBusy(true);
    try {
      await invoke('reviewTaskResearch', {
        id: task.sessionId,
        version: research.version,
        accepted,
        feedback,
        searchTerms,
      });
      setFeedback('');
      refresh?.();
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      onError(errors[code] || errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label='开工前方案确认'
      className='rounded-16px border border-solid border-b-base bg-base p-16px mb-12px max-h-400px overflow-y-auto'
    >
      <div className='flex items-center gap-8px mb-8px'>
        <strong>开工前方案</strong>
        <Tag>{approved ? '已确认' : waiting ? '等你确认' : failed ? '需要重试' : '正在查找案例和技能'}</Tag>
      </div>
      {!approved && (
        <p className='text-t-secondary'>
          先比较网上案例和可用技能，再由你决定怎么做。确认之前不会执行代码、改文件或继续派任务。
        </p>
      )}
      {research.error && <p role='alert'>{errors[research.error] || errorText(research.error)}</p>}
      {research.queries.length > 0 && <p className='text-t-secondary'>查找内容：{research.queries.join('；')}</p>}
      {(['example', 'skill'] as const).map((kind) => (
        <div key={kind}>
          <h4>{kind === 'example' ? '网上案例' : 'Skill 候选（助手可参考的操作说明）'}</h4>
          {research.sources
            .filter((source) => source.kind === kind)
            .map((source, i) => (
              <div key={`${source.url}-${i}`} className='mb-8px'>
                <Button
                  type='text'
                  disabled={!source.url}
                  className='!p-0'
                  onClick={() =>
                    void invoke('external', { url: source.url }).catch((error) => onError(errorText(error)))
                  }
                >
                  {source.title}
                </Button>
                <p className='text-t-secondary m-0'>{source.description}</p>
                <span className='text-12px text-t-tertiary'>
                  {kind === 'skill'
                    ? source.available
                      ? '已获授权，可使用'
                      : '候选资料，使用前需检查并授权安装'
                    : '参考案例'}{' '}
                  ·{' '}
                  {source.license && source.license !== 'NOASSERTION' ? `许可：${source.license}` : '尚未确认复用许可'}
                </span>
              </div>
            ))}
          {research.queries.length > 0 && !research.sources.some((source) => source.kind === kind) && (
            <p className='text-t-secondary'>本次查询没有找到候选，可填写更具体的方向重新查找。</p>
          )}
        </div>
      ))}
      {research.proposal && <div className='whitespace-pre-wrap mb-12px'>{research.proposal}</div>}
      {(waiting || failed) && (
        <>
          <Input
            aria-label='查找关键词'
            value={searchTerms}
            onChange={setSearchTerms}
            placeholder='可选：重新查找的关键词，例如 React dashboard'
            maxLength={160}
            className='mb-8px'
          />
          <Input.TextArea
            aria-label='方案修改意见'
            value={feedback}
            onChange={setFeedback}
            placeholder='希望怎么调整？例如：换一组更简洁的前端案例，或指定一个技术方向。'
            maxLength={4000}
          />
          <div className='flex gap-8px mt-12px'>
            {waiting && (
              <Button
                type='primary'
                loading={busy}
                disabled={task.stopRequested || task.needsRevalidation}
                onClick={() => void review(true)}
              >
                同意并开始
              </Button>
            )}
            <Button loading={busy} disabled={waiting && !feedback.trim()} onClick={() => void review(false)}>
              {failed ? '重试调研' : '按意见重新调研'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
