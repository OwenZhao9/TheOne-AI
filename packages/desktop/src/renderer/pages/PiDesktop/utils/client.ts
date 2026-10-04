import type { PiMethod, PiMethods } from '@/common/pi';
import i18n from '@/renderer/services/i18n';

export function invoke<K extends PiMethod>(method: K, input: PiMethods[K]['input']): Promise<PiMethods[K]['output']> {
  if (!window.aionPi) return Promise.reject(new Error('runtime_missing'));
  const result = window.aionPi.invoke(method, input);
  if (['saveConnection', 'saveSettings', 'login', 'logout', 'cancelLogin'].includes(method)) {
    return result.finally(() => window.dispatchEvent(new Event('pi-catalog-invalidated')));
  }
  return result;
}
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/no (available )?model|no api key|missing.*api.?key/i.test(text)) return i18n.t('common.pi.needsSetup');
  if (/\b401\b|authentication_error|invalid.*api.?key|incorrect.*api.?key/i.test(text))
    return `${i18n.t('common.pi.errors.authentication_failed')}\n${text}`;
  if (/connection error|ECONNREFUSED|ENOTFOUND|fetch failed|network error/i.test(text))
    return `${i18n.t('common.pi.errors.network_failed')}\n${text}`;
  const code = text.split(':')[0];
  const key = `common.pi.errors.${code}`;
  return i18n.exists(key) ? String(i18n.t(key)) : text;
}
export function messageText(message: { content: { type: string; text?: string }[] }): string {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n');
}
