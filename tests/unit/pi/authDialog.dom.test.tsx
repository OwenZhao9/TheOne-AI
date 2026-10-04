import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PiAPI, PiEvent } from '@/common/pi';
import AuthDialog from '@/renderer/pages/PiDesktop/components/AuthDialog';

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let listener: (event: PiEvent) => void;
beforeEach(() => {
  invoke.mockClear();
  window.aionPi = {
    subscribe: (callback) => {
      listener = callback;
      return () => {};
    },
  } as PiAPI;
});
afterEach(() => {
  cleanup();
  delete window.aionPi;
});
function emit(event: Record<string, unknown>) {
  act(() => listener({ kind: 'auth', event }));
}

describe('desktop authorization prompts', () => {
  it('opens the supplied official page and offers manual return input only when requested', async () => {
    render(<AuthDialog />);
    emit({ type: 'auth_event', event: { type: 'auth_url', url: 'https://auth.openai.com/authorize' } });
    emit({ type: 'prompt', id: 'auth-1', prompt: { type: 'manual_code', message: 'Return URL' } });
    expect(invoke).toHaveBeenCalledWith('external', { url: 'https://auth.openai.com/authorize' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByText('common.pi.authPasteLink'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://localhost/callback?code=example' } });
    fireEvent.click(screen.getByText('common.pi.confirm'));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('authRespond', {
        id: 'auth-1',
        value: 'http://localhost/callback?code=example',
      })
    );
  });

  it('opens device authorization and retains its code while waiting for confirmation', () => {
    render(<AuthDialog />);
    emit({
      type: 'auth_event',
      event: { type: 'device_code', verificationUri: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' },
    });
    emit({ type: 'auth_event', event: { type: 'progress', message: 'Waiting' } });
    expect(invoke).toHaveBeenCalledWith('external', { url: 'https://auth.openai.com/codex/device' });
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    fireEvent.click(screen.getByTestId('pi-auth-cancel'));
    expect(invoke).toHaveBeenCalledWith('cancelLogin', undefined);
  });

  it('keeps a newer question when an earlier prompt closes and clears state when login ends', async () => {
    render(<AuthDialog />);
    emit({ type: 'prompt', id: 'auth-2', prompt: { type: 'text', message: 'Current question' } });
    emit({ type: 'prompt_closed', id: 'auth-1' });
    expect(screen.getByText('Current question')).toBeTruthy();
    emit({ type: 'closed' });
    await waitFor(() => expect(screen.queryByText('Current question')).toBeNull());
  });
});
