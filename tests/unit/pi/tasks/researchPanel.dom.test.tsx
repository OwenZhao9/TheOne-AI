import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiTaskNode } from '@/common/pi';
import ResearchPanel from '@/renderer/pages/PiDesktop/components/NativeConversation/ResearchPanel';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
const task = {
  sessionId: 'frontend',
  research: { state: 'awaiting_approval', version: 3, queries: ['frontend'], sources: [], proposal: '先做页面布局' },
} as PiTaskNode;
describe('research review in a child conversation', () => {
  it('shows the concrete proposal and approves only the displayed version', async () => {
    invoke.mockResolvedValue(undefined);
    render(<ResearchPanel task={task} onError={vi.fn()} />);
    expect(screen.getByText('先做页面布局')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '同意并开始' }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('reviewTaskResearch', {
        id: 'frontend',
        version: 3,
        accepted: true,
        feedback: '',
        searchTerms: '',
      })
    );
  });
  it('retains revision input when saving fails', async () => {
    invoke.mockRejectedValue(new Error('offline'));
    const error = vi.fn();
    render(<ResearchPanel task={task} onError={error} />);
    fireEvent.change(screen.getByRole('textbox', { name: '方案修改意见' }), { target: { value: '用更简洁的案例' } });
    fireEvent.click(screen.getByRole('button', { name: '按意见重新调研' }));
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect((screen.getByRole('textbox', { name: '方案修改意见' }) as HTMLTextAreaElement).value).toBe('用更简洁的案例');
  });
  it('does not offer an approval button while research is incomplete', () => {
    render(
      <ResearchPanel task={{ ...task, research: { ...task.research!, state: 'researching' } }} onError={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: '同意并开始' })).toBeNull();
  });
});
