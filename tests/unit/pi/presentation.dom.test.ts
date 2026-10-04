import { afterEach, describe, expect, it, vi } from 'vitest';
import { configService } from '@/common/config/configService';
import type { PiAPI } from '@/common/pi';

afterEach(() => {
  delete window.aionPi;
  localStorage.removeItem('pi.presentation');
  configService.reset();
  vi.unstubAllGlobals();
});
describe('independent presentation preferences', () => {
  it('stores AionPi appearance locally without connecting to AionCore', async () => {
    window.aionPi = {} as PiAPI;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await configService.initialize();
    await configService.set('theme.activeId', 'dark');
    configService.reset();
    await configService.initialize();
    expect(configService.get('theme.activeId')).toBe('dark');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps the original AionUI settings route when the Pi bridge is absent', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { 'theme.activeId': 'light' } }),
    });
    vi.stubGlobal('fetch', fetch);
    await configService.initialize();
    await configService.set('theme.activeId', 'dark');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toContain('/api/settings/client');
    expect(fetch.mock.calls[1][1].method).toBe('PUT');
    expect(localStorage.getItem('pi.presentation')).toBeNull();
  });
});
