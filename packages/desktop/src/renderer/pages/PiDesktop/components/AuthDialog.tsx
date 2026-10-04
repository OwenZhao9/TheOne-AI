import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space, Alert } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { recordOf, textOf, type JsonRecord } from '@/common/pi';
import { invoke, errorText } from '../utils/client';

export default function AuthDialog() {
  const { t } = useTranslation();
  const [event, setEvent] = useState<JsonRecord>();
  const [prompt, setPrompt] = useState<JsonRecord>();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  useEffect(
    () =>
      window.aionPi?.subscribe((message) => {
        if (message.kind !== 'auth') return;
        const frame = message.event;
        if (frame.type === 'closed') {
          setEvent(undefined);
          setPrompt(undefined);
          setValue('');
          setError('');
          setPasting(false);
          return;
        }
        if (frame.type === 'prompt_closed') {
          setPrompt((current) => (current?.id === frame.id ? undefined : current));
          return;
        }
        if (frame.type === 'prompt') {
          setPrompt(frame);
          setValue('');
        }
        if (frame.type === 'auth_event') {
          const incoming = recordOf(frame.event);
          setEvent((current) => ({ ...current, ...incoming }));
          const link =
            incoming.type === 'auth_url'
              ? incoming.url
              : incoming.type === 'device_code'
                ? incoming.verificationUri
                : undefined;
          if (typeof link === 'string') void invoke('external', { url: link }).catch((e) => setError(errorText(e)));
        }
      }),
    []
  );
  const question = recordOf(prompt?.prompt);
  const manual = question.type === 'manual_code';
  const answer = async (): Promise<void> => {
    try {
      await invoke('authRespond', { id: textOf(prompt?.id), value });
      setPrompt(undefined);
      setValue('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  const url = textOf(event?.url || event?.verificationUri);
  return (
    <Modal
      data-testid='pi-auth-dialog'
      visible={Boolean(event || prompt)}
      title={t('common.pi.loginWaiting')}
      maskClosable={false}
      onCancel={() => void invoke('cancelLogin', undefined)}
      footer={
        <Space>
          <Button data-testid='pi-auth-cancel' onClick={() => void invoke('cancelLogin', undefined)}>
            {t('common.pi.loginCancel')}
          </Button>
          {prompt && (!manual || pasting) && (
            <Button type='primary' onClick={() => void answer()} disabled={!value}>
              {t('common.pi.confirm')}
            </Button>
          )}
        </Space>
      }
    >
      {error && <Alert type='error' content={error} />}
      {event?.type === 'auth_url' ? (
        <p>{t('common.pi.authBrowserHint')}</p>
      ) : (
        Boolean(event?.message || event?.instructions) && <p>{textOf(event?.message || event?.instructions)}</p>
      )}
      {Boolean(event?.userCode) && <TypographyCode value={textOf(event?.userCode)} />}
      {url && (
        <Button type='text' onClick={() => void invoke('external', { url }).catch((e) => setError(errorText(e)))}>
          {t('common.pi.authOpenBrowser')}
        </Button>
      )}
      {manual && !pasting && (
        <Button type='text' onClick={() => setPasting(true)}>
          {t('common.pi.authPasteLink')}
        </Button>
      )}
      {prompt && (!manual || pasting) && (
        <>
          <p>{manual ? t('common.pi.authPasteHint') : textOf(question.message)}</p>
          {question.type === 'select' ? (
            <Select
              value={value}
              onChange={setValue}
              options={(Array.isArray(question.options) ? question.options : []).map((item) => {
                const option = recordOf(item);
                return { value: textOf(option.id), label: textOf(option.label) };
              })}
            />
          ) : question.type === 'secret' ? (
            <Input.Password value={value} onChange={setValue} autoComplete='off' />
          ) : (
            <Input
              value={value}
              onChange={setValue}
              placeholder={textOf(question.placeholder)}
              onPressEnter={() => void answer()}
            />
          )}
        </>
      )}
    </Modal>
  );
}
function TypographyCode({ value }: { value: string }) {
  return <pre>{value}</pre>;
}
