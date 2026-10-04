import React, { useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Message, Modal, Radio, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { defaultPiLearningProfile, type PiLearningLevel, type PiLearningProfile, type PiSnapshot } from '@/common/pi';
import { invoke, errorText } from './utils/client';

const LEVELS: PiLearningLevel[] = ['beginner', 'familiar', 'expert', 'custom'];

type Props = {
  snapshot: PiSnapshot;
  onError: (value: string) => void;
};

export default function LearningLevelControls(props: Props) {
  return <LearningLevelEditor key={props.snapshot.conversation.id} {...props} />;
}

function LearningLevelEditor({ snapshot, onError }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [level, setLevel] = useState<PiLearningLevel>('familiar');
  const [customDescription, setCustomDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const profile = snapshot.conversation.learning || defaultPiLearningProfile();
  const disabled =
    snapshot.phase === 'starting' ||
    snapshot.view.streaming ||
    snapshot.view.syncing ||
    snapshot.view.dialogs.length > 0;

  useEffect(() => {
    if (!visible) return;
    setLevel(profile.level);
    setCustomDescription(profile.customDescription);
  }, [profile.customDescription, profile.level, visible]);

  const open = (): void => {
    setLevel(profile.level);
    setCustomDescription(profile.customDescription);
    setVisible(true);
  };
  const save = async (): Promise<void> => {
    if (disabled || saving) return;
    if (level === 'custom' && !customDescription.trim()) return;
    setSaving(true);
    onError('');
    try {
      const next: PiLearningProfile = {
        level,
        customDescription: customDescription.trim(),
        source: 'manual',
        updatedAt: Date.now(),
      };
      await invoke('setLearning', { id: snapshot.conversation.id, profile: next });
      if (!active.current) return;
      setVisible(false);
      Message.success(t('common.pi.learning.saved'));
    } catch (error) {
      if (active.current) onError(errorText(error));
    } finally {
      if (active.current) setSaving(false);
    }
  };
  const levelLabel = t(`common.pi.learning.levels.${profile.level}`);
  return (
    <>
      <Button data-testid='pi-learning-level' size='small' type='text' disabled={disabled} onClick={open}>
        {t('common.pi.learning.button', { level: levelLabel })}
      </Button>
      <Modal
        visible={visible}
        title={t('common.pi.learning.title')}
        onCancel={() => setVisible(false)}
        onOk={() => void save()}
        okButtonProps={{ loading: saving, disabled: disabled || (level === 'custom' && !customDescription.trim()) }}
        cancelText={t('common.pi.cancel')}
        okText={t('common.pi.save')}
        unmountOnExit
      >
        <Form layout='vertical'>
          <p className='text-12px text-t-secondary mt-0'>{t('common.pi.learning.hint')}</p>
          <Form.Item label={t('common.pi.learning.levelLabel')}>
            <Radio.Group value={level} onChange={(value) => setLevel(value as PiLearningLevel)}>
              <Space direction='vertical' size={10}>
                {LEVELS.map((option) => (
                  <Radio key={option} value={option}>
                    <div>
                      <div>{t(`common.pi.learning.levels.${option}`)}</div>
                      <div className='text-12px text-t-secondary'>{t(`common.pi.learning.descriptions.${option}`)}</div>
                    </div>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          {level === 'custom' && (
            <Form.Item label={t('common.pi.learning.levels.custom')}>
              <Input.TextArea
                value={customDescription}
                onChange={setCustomDescription}
                maxLength={2000}
                showWordLimit
                autoSize={{ minRows: 3, maxRows: 7 }}
                placeholder={t('common.pi.learning.customPlaceholder')}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
