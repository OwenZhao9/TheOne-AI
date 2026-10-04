import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BotPlaza from '@/renderer/pages/PiDesktop/BotPlaza';
import type { BotCard } from '@/common/pi/bots';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/pages/PiDesktop/utils/client', () => ({ invoke, errorText: String }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const bot: BotCard = {
  schemaVersion: 1,
  id: 'writer',
  name: 'Writing Bot',
  version: '1.0.0',
  description: 'Write clearly',
  instructions: '',
  skills: ['skills/writing/SKILL.md'],
  requiredCapabilities: ['files'],
  tags: ['Writing'],
  starters: [],
  revision: 'a'.repeat(64),
  source: 'https://github.com/owner/repo',
  installedAt: 1,
  favorite: false,
  missingCapabilities: [],
};
afterEach(() => {
  cleanup();
  invoke.mockReset();
});
describe('Bot plaza import and availability', () => {
  it('previews a GitHub package before installing it and then shows the Bot', async () => {
    let installed = false;
    invoke.mockImplementation(async (method) => {
      if (method === 'bots') return installed ? [bot] : [];
      if (method === 'botPreview')
        return { token: 'preview', manifest: bot, source: bot.source, missingCapabilities: [] };
      if (method === 'botInstall') {
        installed = true;
        return bot;
      }
    });
    render(<BotPlaza opened={vi.fn()} configure={vi.fn()} />);
    fireEvent.click(screen.getByTestId('bot-import'));
    fireEvent.change(screen.getByTestId('bot-github-url'), { target: { value: bot.source } });
    fireEvent.click(screen.getByTestId('bot-read-github'));
    await waitFor(() => expect(screen.getByText('Writing Bot')).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith('botPreview', { github: bot.source });
    expect(screen.getByTestId('bot-confirm-import').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('common.pi.bots.trust'));
    fireEvent.click(screen.getByTestId('bot-confirm-import'));
    await waitFor(() => expect(screen.getByTestId('bot-card')).toBeTruthy());
    expect(invoke).toHaveBeenCalledWith('botInstall', { token: 'preview' });
  });
  it('retains the GitHub URL and displays failures without claiming import succeeded', async () => {
    invoke.mockImplementation(async (method) => {
      if (method === 'bots') return [];
      throw new Error('bot_github_missing');
    });
    render(<BotPlaza opened={vi.fn()} configure={vi.fn()} />);
    fireEvent.click(screen.getByTestId('bot-import'));
    fireEvent.change(screen.getByTestId('bot-github-url'), { target: { value: bot.source } });
    fireEvent.click(screen.getByTestId('bot-read-github'));
    await waitFor(() => expect(screen.getByText('Error: bot_github_missing')).toBeTruthy());
    expect((screen.getByTestId('bot-github-url') as HTMLInputElement).value).toBe(bot.source);
    expect(screen.queryByTestId('bot-card')).toBeNull();
  });
  it('keeps imported Bots visible but disables launch when required tools are absent', async () => {
    invoke.mockResolvedValue([
      { ...bot, requiredCapabilities: ['computer-use'], missingCapabilities: ['computer-use'] },
    ]);
    render(<BotPlaza opened={vi.fn()} configure={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Writing Bot')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'common.pi.bots.use' }).hasAttribute('disabled')).toBe(true);
  });
});
