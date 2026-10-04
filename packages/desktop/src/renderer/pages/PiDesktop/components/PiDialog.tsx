import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { PiDialog as Dialog, JsonRecord } from '@/common/pi';

export default function PiDialog({
  dialog,
  respond,
}: {
  dialog?: Dialog;
  respond: (response: JsonRecord) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setValue(dialog?.prefill || '');
  }, [dialog?.id, dialog?.prefill]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!dialog) return null;
  const expired = dialog.deadline !== undefined && dialog.deadline <= now;
  return (
    <Modal
      visible
      title={dialog.title || t('common.pi.question')}
      maskClosable={false}
      onCancel={() => void respond({ id: dialog.id, cancelled: true })}
      footer={
        <Space>
          <Button onClick={() => void respond({ id: dialog.id, cancelled: true })}>{t('common.pi.cancel')}</Button>
          <Button
            type='primary'
            disabled={expired || (dialog.method === 'select' && !value)}
            onClick={() =>
              void respond({ id: dialog.id, ...(dialog.method === 'confirm' ? { confirmed: true } : { value }) })
            }
          >
            {t('common.pi.confirm')}
          </Button>
        </Space>
      }
    >
      {dialog.message && <p>{dialog.message}</p>}
      {dialog.method === 'select' ? (
        <Select aria-label={t('common.pi.answer')} value={value} onChange={setValue} options={dialog.options || []} />
      ) : dialog.method === 'input' ? (
        <Input
          autoFocus
          value={value}
          onChange={setValue}
          placeholder={dialog.placeholder}
          aria-label={t('common.pi.answer')}
        />
      ) : dialog.method === 'editor' ? (
        <Input.TextArea
          autoFocus
          value={value}
          onChange={setValue}
          autoSize={{ minRows: 5, maxRows: 15 }}
          aria-label={t('common.pi.answer')}
        />
      ) : null}
      {dialog.deadline && (
        <p>
          {t('common.pi.deadline')}: {Math.max(0, Math.ceil((dialog.deadline - now) / 1000))} s
        </p>
      )}
    </Modal>
  );
}
