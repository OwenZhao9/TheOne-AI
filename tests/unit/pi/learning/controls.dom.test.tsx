import React from 'react';
import '@arco-design/web-react/lib/_util/react-19-adapter';
import { Message } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPiLearningProfile, emptyView, type PiSnapshot } from '@/common/pi';
import LearningLevelControls from '@/renderer/pages/PiDesktop/LearningLevelControls';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const snapshot = (id = 'a'): PiSnapshot => ({
  conversation: {
    id,
    cwd: '/test',
    title: '',
    updatedAt: 0,
    messageCount: 0,
    running: false,
    pinned: false,
    learning: defaultPiLearningProfile(),
  },
  view: emptyView(),
  seq: 0,
  phase: 'idle',
});
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  Message.clear();
  invoke.mockReset();
});
const open = () => fireEvent.click(screen.getByTestId('pi-learning-level'));

describe('conversation learning controls', () => {
  it('saves the chosen level only for the selected conversation', async () => {
    invoke.mockResolvedValue(undefined);
    render(<LearningLevelControls snapshot={snapshot()} onError={vi.fn()} />);
    open();
    fireEvent.click(screen.getByText('common.pi.learning.levels.expert'));
    fireEvent.click(screen.getByText('common.pi.save'));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('setLearning', {
        id: 'a',
        profile: expect.objectContaining({ level: 'expert', source: 'manual' }),
      })
    );
  });

  it('closes an unsaved editor when switching conversations, even with equal profiles', async () => {
    const view = render(<LearningLevelControls snapshot={snapshot()} onError={vi.fn()} />);
    open();
    fireEvent.click(screen.getByText('common.pi.learning.levels.expert'));
    view.rerender(<LearningLevelControls snapshot={snapshot('b')} onError={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('common.pi.learning.title')).toBeNull());
    open();
    expect(screen.getByRole('radio', { name: /common.pi.learning.levels.familiar/ })).toBeChecked();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('retains the selected value after saving fails', async () => {
    const onError = vi.fn();
    invoke.mockRejectedValue(new Error('disk_full'));
    render(<LearningLevelControls snapshot={snapshot()} onError={onError} />);
    open();
    fireEvent.click(screen.getByText('common.pi.learning.levels.expert'));
    fireEvent.click(screen.getByText('common.pi.save'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Error: disk_full'));
    expect(screen.getByRole('radio', { name: /common.pi.learning.levels.expert/ })).toBeChecked();
    expect(screen.getByText('common.pi.learning.title')).toBeTruthy();
  });

  it('does not permit changing the level while a reply is running', () => {
    const value = snapshot();
    value.view.streaming = true;
    render(<LearningLevelControls snapshot={value} onError={vi.fn()} />);
    expect(screen.getByTestId('pi-learning-level')).toBeDisabled();
  });
});
