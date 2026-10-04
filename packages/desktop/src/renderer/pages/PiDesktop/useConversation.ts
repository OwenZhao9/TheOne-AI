import { useCallback, useEffect, useRef, useState } from 'react';
import { reducePi, type PiEvent, type PiSnapshot } from '@/common/pi';
import { invoke, errorText } from './utils/client';

export function useConversation(id?: string) {
  const [snapshot, setSnapshot] = useState<PiSnapshot>();
  const [error, setError] = useState('');
  const pending = useRef<PiEvent[]>([]);
  const current = useRef(id);
  current.current = id;
  const refreshing = useRef<symbol | undefined>(undefined);
  const install = useCallback((value: PiSnapshot) => {
    if (value.conversation.id !== current.current) return;
    for (const event of pending.current)
      if (event.kind === 'record' && event.id === value.conversation.id && event.seq > value.seq) {
        value = { ...value, seq: event.seq, view: reducePi(value.view, event.record) };
      }
    pending.current = [];
    setSnapshot((old) => (old?.conversation.id === value.conversation.id && old.seq > value.seq ? old : value));
  }, []);
  const reload = useCallback(async () => {
    if (!id || refreshing.current) return;
    const request = Symbol(id);
    refreshing.current = request;
    try {
      install(await invoke('open', { id }));
      if (id === current.current) setError('');
    } catch (e) {
      if (id === current.current) setError(errorText(e));
    } finally {
      if (refreshing.current === request) refreshing.current = undefined;
    }
  }, [id, install]);
  useEffect(() => {
    setSnapshot(undefined);
    setError('');
    pending.current = [];
    refreshing.current = undefined;
    void invoke('focus', { id });
    void reload();
  }, [id, reload]);
  useEffect(
    () =>
      window.aionPi?.subscribe((event) => {
        if (id !== current.current) return;
        if (event.kind === 'snapshot' && event.snapshot.conversation.id === id) install(event.snapshot);
        if (event.kind !== 'record' || event.id !== id) return;
        setSnapshot((old) => {
          if (!old || old.conversation.id !== id) {
            pending.current.push(event);
            return old;
          }
          if (event.seq <= old.seq) return old;
          if (event.seq !== old.seq + 1) {
            pending.current.push(event);
            void reload();
            return old;
          }
          return { ...old, seq: event.seq, view: reducePi(old.view, event.record) };
        });
      }),
    [id, install, reload]
  );
  return { snapshot: snapshot?.conversation.id === id ? snapshot : undefined, error, reload };
}
