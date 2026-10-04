import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  InputNumber,
  Message,
  Modal,
  Select,
  Space,
  Switch,
} from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type {
  PiAutomationStatus,
  PiCatalog,
  PiImageGenerationConfig,
  PiJudgeMode,
  PiSkillCatalog,
  PiTaskLimits,
} from '@/common/pi';
import { changeLanguage } from '@/renderer/services/i18n';
import { invoke, errorText } from '../utils/client';
import styles from '../PiDesktop.module.css';

export default function Settings({
  visible,
  close,
  changed,
}: {
  visible: boolean;
  close: () => void;
  changed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<PiCatalog>();
  const [taskLimits, setTaskLimits] = useState<PiTaskLimits>({
    maxDepth: 3,
    maxTotalTasks: 12,
    maxConcurrent: 4,
    maxModelCalls: 24,
    maxInputTokens: 200000,
    maxOutputTokens: 100000,
  });
  const [skillCatalog, setSkillCatalog] = useState<PiSkillCatalog>({ skills: [] });
  const [provider, setProvider] = useState('');
  const [key, setKey] = useState('');
  const [url, setUrl] = useState('');
  const [api, setApi] = useState('openai-completions');
  const [customModel, setCustomModel] = useState('');
  const [images, setImages] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [automation, setAutomation] = useState<PiAutomationStatus>();
  const [imageConfig, setImageConfig] = useState<PiImageGenerationConfig>();
  const [imageProvider, setImageProvider] = useState('volcengine');
  const [imageBaseUrl, setImageBaseUrl] = useState('https://ark.cn-beijing.volces.com/api/v3');
  const [imageModel, setImageModel] = useState('doubao-seedream-5-0-flash-260915');
  const [imageKey, setImageKey] = useState('');
  const [imageEnabled, setImageEnabled] = useState(true);
  const [jevKey, setJevKey] = useState('');
  const [judgeMode, setJudgeMode] = useState<PiJudgeMode>('shadow');
  const reloadAutomation = async (): Promise<void> => {
    const status = await invoke('automationStatus', undefined);
    setAutomation(status);
    setJudgeMode(status.judgeMode);
  };
  const reload = async (): Promise<void> => {
    setLoadingModels(true);
    try {
      const [data, limits, skills, generation] = await Promise.all([
        invoke('catalog', undefined),
        invoke('taskLimits', undefined),
        invoke('skillCatalog', undefined),
        invoke('imageGenerationConfig', undefined),
        reloadAutomation(),
      ]);
      setCatalog(data);
      setTaskLimits(limits);
      setSkillCatalog(skills);
      setImageConfig(generation);
      setImageProvider(generation.provider);
      setImageBaseUrl(generation.baseUrl);
      setImageModel(generation.model);
      setImageEnabled(generation.enabled);
      setProvider((old) => old || data.settings.provider || '');
    } catch (failure) {
      setCatalog(undefined);
      throw failure;
    } finally {
      setLoadingModels(false);
    }
  };
  useEffect(() => {
    if (visible) void reload().catch((e) => setError(errorText(e)));
    else {
      setKey('');
      setJevKey('');
      setReply('');
    }
  }, [visible]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    setError('');
    setBusy(true);
    try {
      await action();
      await reload();
      changed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const selected = catalog?.providers.find((p) => p.id === provider);
  const configured = new Set(catalog?.providers.filter((p) => p.configured).map((p) => p.id));
  const models = (catalog?.models || []).filter((m) => configured.has(m.provider));
  const currentListed = models.some(
    (m) => m.provider === catalog?.settings.provider && m.id === catalog?.settings.model
  );
  const modelOptions = models.map((m) => ({
    value: JSON.stringify([m.provider, m.id]),
    label: `${m.provider} / ${m.name || m.id}`,
    disabled: false,
  }));
  if (catalog?.settings.model && !currentListed)
    modelOptions.unshift({
      value: JSON.stringify([catalog.settings.provider, catalog.settings.model]),
      label: `${catalog.settings.model} · ${t('common.pi.currentModel')}`,
      disabled: true,
    });
  return (
    <Modal
      visible={visible}
      title={t('common.pi.settings')}
      onCancel={close}
      footer={null}
      className={styles.settingsModal}
      unmountOnExit
    >
      <Form layout='vertical'>
        {error && <Alert type='error' content={error} closable onClose={() => setError('')} />}
        <p className='text-t-secondary'>{t('common.pi.connectionHint')}</p>
        <Form.Item label={t('common.pi.provider')}>
          <Select
            data-testid='pi-provider'
            showSearch
            allowCreate
            value={provider || undefined}
            onChange={(value) => {
              setProvider(value);
              setKey('');
              setUrl('');
              setCustomModel('');
            }}
            options={(catalog?.providers || []).map((p) => ({
              value: p.id,
              label: `${p.name} · ${t(p.configured ? 'common.pi.configured' : 'common.pi.notConfigured')}`,
            }))}
          />
        </Form.Item>
        <Form.Item label={t('common.pi.key')}>
          <Input.Password
            data-testid='pi-api-key'
            autoComplete='new-password'
            value={key}
            onChange={setKey}
            placeholder={t('common.pi.keyHint')}
          />
        </Form.Item>
        <Form.Item label={t('common.pi.serviceUrl')}>
          <Input data-testid='pi-service-url' value={url} onChange={setUrl} />
        </Form.Item>
        {url && (
          <>
            <Form.Item label={t('common.pi.protocol')}>
              <Select
                value={api}
                onChange={setApi}
                options={['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']}
              />
            </Form.Item>
            <Form.Item label={t('common.pi.customModel')}>
              <Input data-testid='pi-custom-model' value={customModel} onChange={setCustomModel} />
            </Form.Item>
            <Form.Item label={t('common.pi.imageInput')}>
              <Switch checked={images} onChange={setImages} />
            </Form.Item>
          </>
        )}
        <Space wrap>
          <Button
            type='primary'
            data-testid='pi-save-connection'
            loading={busy}
            disabled={!provider || (!key && !url)}
            onClick={() =>
              void run(async () => {
                await invoke('saveConnection', {
                  provider,
                  apiKey: key || undefined,
                  baseUrl: url || undefined,
                  api,
                  model: customModel || undefined,
                  imageInput: images,
                });
                setKey('');
                Message.success(t('common.pi.saved'));
              })
            }
          >
            {t('common.pi.save')}
          </Button>
          {selected?.oauth && (
            <Button
              data-testid='pi-oauth-login'
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('login', { provider, type: 'oauth' });
                  Message.success(t('common.pi.loginSuccess'));
                })
              }
            >
              {t(provider === 'openai' || provider === 'openai-codex' ? 'common.pi.loginChatGPT' : 'common.pi.login')}
            </Button>
          )}
          {selected?.apiKey && (
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('login', { provider, type: 'api_key' });
                  Message.success(t('common.pi.saved'));
                })
              }
            >
              {t('common.pi.loginKey')}
            </Button>
          )}
          {selected?.configured && (
            <Button
              status='danger'
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('logout', { provider });
                })
              }
            >
              {t('common.pi.logout')}
            </Button>
          )}
        </Space>
        <Divider />
        <h3>{t('common.pi.imageGeneration')}</h3>
        <p className='text-t-secondary'>{t('common.pi.imageGenerationHint')}</p>
        <Form.Item label={t('common.pi.imageGenerationProvider')}>
          <Input value={imageProvider} onChange={setImageProvider} />
        </Form.Item>
        <Form.Item label={t('common.pi.imageGenerationBaseUrl')}>
          <Input value={imageBaseUrl} onChange={setImageBaseUrl} />
        </Form.Item>
        <Form.Item label={t('common.pi.imageGenerationModel')}>
          <Input value={imageModel} onChange={setImageModel} />
        </Form.Item>
        <Form.Item label={t('common.pi.imageGenerationApiKey')}>
          <Input.Password
            autoComplete='new-password'
            value={imageKey}
            onChange={setImageKey}
            placeholder={imageConfig?.configured ? t('common.pi.keyHint') : undefined}
          />
        </Form.Item>
        <Form.Item label={t('common.pi.imageGenerationEnabled')}>
          <Switch checked={imageEnabled} onChange={setImageEnabled} />
        </Form.Item>
        <Space wrap>
          <Button
            type='primary'
            disabled={busy || !imageProvider || !imageBaseUrl || !imageModel}
            onClick={() =>
              void run(async () => {
                await invoke('saveImageGenerationConfig', {
                  provider: imageProvider,
                  baseUrl: imageBaseUrl,
                  model: imageModel,
                  apiKey: imageKey || undefined,
                  enabled: imageEnabled,
                });
                setImageKey('');
                Message.success(t('common.pi.saved'));
              })
            }
          >
            {t('common.pi.imageGenerationSave')}
          </Button>
          <Alert
            type={imageConfig?.configured ? 'success' : 'warning'}
            content={
              imageConfig?.configured
                ? t('common.pi.imageGenerationConfigured')
                : t('common.pi.imageGenerationNotConfigured')
            }
          />
        </Space>
        <Divider />
        {catalog?.providers
          .filter((p) => p.modelError)
          .map((p) => (
            <Alert key={p.id} type='warning' content={`${p.name}: ${errorText(p.modelError)}`} />
          ))}
        {catalog?.settings.model && !currentListed && !loadingModels && (
          <Alert type='warning' content={t('common.pi.modelNotListed')} />
        )}
        <Form.Item label={t('common.pi.defaultModel')}>
          <Select
            data-testid='pi-default-model'
            showSearch
            loading={loadingModels}
            disabled={busy || loadingModels}
            value={
              catalog?.settings.provider && catalog?.settings.model
                ? JSON.stringify([catalog.settings.provider, catalog.settings.model])
                : undefined
            }
            options={modelOptions}
            onChange={(value) =>
              void run(async () => {
                const [p, model] = JSON.parse(value) as string[];
                await invoke('saveSettings', { ...catalog!.settings, provider: p, model });
              })
            }
          />
        </Form.Item>
        <Button
          data-testid='pi-refresh-models'
          loading={loadingModels}
          disabled={busy}
          onClick={() => void reload().catch((e) => setError(errorText(e)))}
        >
          {t('common.pi.refreshModels')}
        </Button>
        <Button
          data-testid='pi-test-connection'
          loading={busy}
          disabled={!currentListed || loadingModels}
          onClick={() =>
            void run(async () => {
              setReply('');
              setReply(await invoke('testConnection', undefined));
            })
          }
        >
          {t('common.pi.test')}
        </Button>
        {reply && (
          <Alert
            className='mt-12px'
            type='success'
            title={t('common.pi.testReply')}
            content={
              <div data-testid='pi-test-reply' className='whitespace-pre-wrap'>
                {reply}
              </div>
            }
          />
        )}
        <Divider />
        <h3>{t('common.pi.computerUse')}</h3>
        <p className='text-t-secondary'>{t('common.pi.computerUseHint')}</p>
        <Alert
          data-testid='pi-computer-status'
          type={!automation ? 'info' : automation.computerUse === 'ready' ? 'success' : 'warning'}
          content={
            !automation
              ? t('common.pi.loading')
              : `${t(`common.pi.computerStatus.${automation.computerUse}`)}${automation.driverVersion ? ` · ${automation.driverVersion}` : ''}`
          }
        />
        <Space wrap className='mt-12px'>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setAutomation(await invoke('automationAction', { action: 'start' }));
              })
            }
          >
            {t('common.pi.startComputerDriver')}
          </Button>
          <Button
            disabled={busy || automation?.computerUse === 'not_installed'}
            onClick={() =>
              void run(async () => {
                setAutomation(await invoke('automationAction', { action: 'permissions' }));
              })
            }
          >
            {t('common.pi.grantComputerPermissions')}
          </Button>
          <Button disabled={busy} onClick={() => void reloadAutomation().catch((e) => setError(errorText(e)))}>
            {t('common.pi.refresh')}
          </Button>
          <Button
            type='text'
            onClick={() =>
              void invoke('external', { url: 'https://cua.ai/docs/how-to-guides/driver/install' }).catch((e) =>
                setError(errorText(e))
              )
            }
          >
            {t('common.pi.computerInstallGuide')}
          </Button>
        </Space>
        <Divider />
        <h3>{t('common.pi.jevJudge')}</h3>
        <p className='text-t-secondary'>{t('common.pi.jevJudgeHint')}</p>
        <Form.Item label={t('common.pi.jevKey')}>
          <Input.Password
            data-testid='pi-jev-key'
            autoComplete='new-password'
            value={jevKey}
            onChange={setJevKey}
            placeholder={automation?.jevConfigured ? t('common.pi.keyHint') : undefined}
          />
        </Form.Item>
        <Form.Item label={t('common.pi.jevMode')}>
          <Select
            value={judgeMode}
            onChange={(value) => setJudgeMode(value as PiJudgeMode)}
            options={[
              { value: 'shadow', label: t('common.pi.jevShadow') },
              { value: 'active', label: t('common.pi.jevActive') },
            ]}
          />
        </Form.Item>
        <Button
          type='primary'
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setAutomation(await invoke('saveAutomation', { judgeMode, jevApiKey: jevKey || undefined }));
              setJevKey('');
              Message.success(t('common.pi.saved'));
            })
          }
        >
          {t('common.pi.saveAutomation')}
        </Button>
        <Divider />
        <Form.Item label={t('common.pi.taskLimits')}>
          <Space wrap>
            <InputNumber
              min={1}
              max={10}
              value={taskLimits.maxDepth}
              prefix={t('common.pi.maxDepth')}
              onChange={(value) => setTaskLimits((old) => ({ ...old, maxDepth: Number(value) || old.maxDepth }))}
            />
            <InputNumber
              min={1}
              max={100}
              value={taskLimits.maxTotalTasks}
              prefix={t('common.pi.maxTotalTasks')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxTotalTasks: Number(value) || old.maxTotalTasks }))
              }
            />
            <InputNumber
              min={1}
              max={16}
              value={taskLimits.maxConcurrent}
              prefix={t('common.pi.maxConcurrent')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxConcurrent: Number(value) || old.maxConcurrent }))
              }
            />
            <InputNumber
              min={1}
              max={1000}
              value={taskLimits.maxModelCalls}
              prefix={t('common.pi.maxModelCalls')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxModelCalls: Number(value) || old.maxModelCalls }))
              }
            />
            <InputNumber
              min={1000}
              max={100000000}
              value={taskLimits.maxInputTokens}
              prefix={t('common.pi.maxInputTokens')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxInputTokens: Number(value) || old.maxInputTokens }))
              }
            />
            <InputNumber
              min={1000}
              max={100000000}
              value={taskLimits.maxOutputTokens}
              prefix={t('common.pi.maxOutputTokens')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxOutputTokens: Number(value) || old.maxOutputTokens }))
              }
            />
            <InputNumber
              min={0}
              max={1000000}
              value={taskLimits.maxCostUsd || 0}
              prefix={t('common.pi.maxCostUsd')}
              onChange={(value) =>
                setTaskLimits((old) => ({ ...old, maxCostUsd: Number(value) > 0 ? Number(value) : undefined }))
              }
            />
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke('saveTaskLimits', taskLimits);
                  Message.success(t('common.pi.saved'));
                })
              }
            >
              {t('common.pi.saveTaskLimits')}
            </Button>
          </Space>
          <p className='text-12px text-t-tertiary mt-8px'>{t('common.pi.budgetNote')}</p>
        </Form.Item>
        <Divider />
        <Form.Item label={t('common.pi.jevSettings')}>
          <Space direction='vertical' className='w-full' align='start'>
            <Input
              value={catalog?.settings.jevProvider || 'typesafe'}
              onChange={(value) =>
                setCatalog((old) => (old ? { ...old, settings: { ...old.settings, jevProvider: value } } : old))
              }
              placeholder={t('common.pi.jevProvider')}
              addBefore={t('common.pi.jevProvider')}
            />
            <Input
              value={catalog?.settings.jevModel || 'jev-latest'}
              onChange={(value) =>
                setCatalog((old) => (old ? { ...old, settings: { ...old.settings, jevModel: value } } : old))
              }
              placeholder={t('common.pi.jevModel')}
              addBefore={t('common.pi.jevModel')}
            />
            <Input
              value={catalog?.settings.skillRegistryUrl || ''}
              onChange={(value) =>
                setCatalog((old) =>
                  old ? { ...old, settings: { ...old.settings, skillRegistryUrl: value || undefined } } : old
                )
              }
              placeholder={t('common.pi.skillRegistryUrl')}
              addBefore={t('common.pi.skillRegistryUrl')}
            />
            <Space>
              <Button
                disabled={busy || !catalog}
                onClick={() =>
                  void run(async () => {
                    if (catalog) await invoke('saveSettings', catalog.settings);
                    await invoke('refreshSkills', undefined);
                    Message.success(t('common.pi.saved'));
                  })
                }
              >
                {t('common.pi.saveJevSettings')}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSkillCatalog(await invoke('refreshSkills', undefined));
                  })
                }
              >
                {t('common.pi.refreshSkills')}
              </Button>
            </Space>
            <p className='text-12px text-t-tertiary'>{t('common.pi.jevSettingsHint')}</p>
          </Space>
        </Form.Item>
        <Form.Item label={t('common.pi.onlineSkills')}>
          {!skillCatalog.skills.some((skill) => skill.source === 'online') && (
            <p className='text-12px text-t-tertiary'>{skillCatalog.error || t('common.pi.noOnlineSkills')}</p>
          )}
          <Space direction='vertical' className='w-full' align='start'>
            {skillCatalog.skills
              .filter((skill) => skill.source === 'online')
              .map((skill) => (
                <div key={skill.name} className='w-full flex items-center gap-8px text-12px'>
                  <span className='min-w-0 flex-1' title={skill.sourceUrl || skill.location}>
                    {skill.name} · {skill.license || t('common.pi.licenseUnknown')} · {skill.compatibility}
                    {skill.sourceUrl ? ` · ${new URL(skill.sourceUrl).host}` : ''}
                  </span>
                  {skill.approved && (
                    <Button
                      size='mini'
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setSkillCatalog(await invoke('rejectSkill', { name: skill.name }));
                        })
                      }
                    >
                      {t('common.pi.revokeSkill')}
                    </Button>
                  )}
                  {!skill.trusted && <span className='text-t-tertiary'>{t('common.pi.skillNotTrusted')}</span>}
                  {skill.trusted && skill.approved && skill.installed ? (
                    <span className='text-success'>{t('common.pi.skillInstalled')}</span>
                  ) : (
                    <Button
                      size='mini'
                      disabled={busy || !skill.trusted || skill.compatibility !== 'compatible'}
                      onClick={() =>
                        void run(async () => {
                          setSkillCatalog(await invoke('approveSkill', { name: skill.name }));
                        })
                      }
                    >
                      {t('common.pi.approveSkill')}
                    </Button>
                  )}
                </div>
              ))}
          </Space>
        </Form.Item>
        <Divider />
        <Form.Item label={t('common.pi.notifications')}>
          <Switch
            checked={catalog?.settings.notifications ?? true}
            onChange={(notifications) =>
              void run(async () => {
                if (catalog) await invoke('saveSettings', { ...catalog.settings, notifications });
              })
            }
          />
        </Form.Item>
        <Form.Item label={t('common.pi.language')}>
          <Select
            value={i18n.language}
            options={[
              { value: 'zh-CN', label: '简体中文' },
              { value: 'zh-TW', label: '繁體中文' },
              { value: 'en-US', label: 'English' },
            ]}
            onChange={(value) => void changeLanguage(value)}
          />
        </Form.Item>
        <Form.Item label={t('common.pi.appearance')}>
          <Select
            defaultValue={localStorage.getItem('pi.theme') || 'system'}
            options={['system', 'light', 'dark'].map((value) => ({ value, label: t(`common.pi.${value}`) }))}
            onChange={(value) => {
              localStorage.setItem('pi.theme', value);
              window.dispatchEvent(new Event('pi-theme'));
            }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
