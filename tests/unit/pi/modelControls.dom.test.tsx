import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PiSnapshot } from '@/common/pi';
import ModelControls from '@/renderer/pages/PiDesktop/components/ModelControls';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const snapshot = { conversation: { id: 'test' }, view: { model: { id: 'old', provider: 'openai' } } } as PiSnapshot;
afterEach(() => {
  cleanup();
  window.dispatchEvent(new Event('pi-catalog-invalidated'));
  invoke.mockReset();
});

describe('chat model selection', () => {
  const openModelMenu = async (): Promise<void> => {
    fireEvent.click(screen.getByTestId('pi-chat-model'));
    const title = await screen.findByText('common.pi.model');
    fireEvent.mouseEnter(title.closest('.arco-dropdown-menu-pop-header')!);
  };

  it('uses the same account catalog as settings and does not expose old RPC models', async () => {
    invoke.mockImplementation(async (method) =>
      method === 'catalog'
        ? {
            providers: [{ id: 'openai', configured: true }],
            models: [{ id: 'allowed', provider: 'openai' }],
          }
        : { levels: [] }
    );
    render(<ModelControls snapshot={snapshot} onError={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('catalog', undefined));
    await openModelMenu();
    await waitFor(() => expect(screen.getByText('allowed')).toBeTruthy());
    expect(invoke.mock.calls.some(([, input]) => input?.command?.type === 'get_available_models')).toBe(false);
    expect(screen.queryByText('old · common.pi.currentModel')).toBeNull();
    expect(invoke.mock.calls.some(([, input]) => input?.command?.type === 'set_model')).toBe(false);
  });

  it('clears previous choices when refreshing fails', async () => {
    const onError = vi.fn();
    invoke.mockImplementation(async (method) =>
      method === 'catalog'
        ? {
            providers: [{ id: 'openai', configured: true }],
            models: [{ id: 'allowed', provider: 'openai' }],
          }
        : { levels: [] }
    );
    render(<ModelControls snapshot={snapshot} onError={onError} />);
    await openModelMenu();
    await waitFor(() => expect(screen.getByText('allowed')).toBeTruthy());
    invoke.mockRejectedValue(new Error('account_models_failed'));
    window.dispatchEvent(new Event('pi-catalog-invalidated'));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Error: account_models_failed'));
    expect(screen.queryByText('allowed')).toBeNull();
  });
});

describe('new conversation model controls', () => {
  it('reuses loaded options without starting Pi or loading again for another empty chat', async () => {
    window.dispatchEvent(new Event('pi-catalog-invalidated'));
    invoke.mockImplementation(async () => ({
      providers: [{ id: 'openai', configured: true }],
      models: [{ id: 'old', provider: 'openai' }],
    }));
    const first = render(<ModelControls snapshot={snapshot} onError={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('catalog', undefined));
    await waitFor(() => expect(first.container.querySelector('.arco-select-loading')).toBeNull());
    first.unmount();
    invoke.mockClear();
    render(
      <ModelControls
        snapshot={{ ...snapshot, conversation: { ...snapshot.conversation, id: 'next' } }}
        onError={vi.fn()}
      />
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
