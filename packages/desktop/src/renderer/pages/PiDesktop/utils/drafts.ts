import type { PiAttachment } from '@/common/pi';
export type Draft = { text: string; attachments: PiAttachment[] };
export function getDraft(id: string): Draft {
  try {
    return JSON.parse(localStorage.getItem(`pi.draft.${id}`) || '{"text":"","attachments":[]}') as Draft;
  } catch {
    return { text: '', attachments: [] };
  }
}
export function saveDraft(id: string, draft: Draft): void {
  try {
    localStorage.setItem(`pi.draft.${id}`, JSON.stringify(draft));
    window.dispatchEvent(new Event('pi-draft-changed'));
  } catch {
    /* Large pasted images stay in memory until sent. */
  }
}

export function hasDraft(id: string): boolean {
  const draft = getDraft(id);
  return Boolean(draft.text?.trim() || draft.attachments?.length);
}
