import React, { useEffect, useRef, useState } from 'react';
import { Dropdown, Menu } from '@arco-design/web-react';
import {
  RuntimeSelectorTrigger,
  RuntimeSelectorModelList,
  RuntimeSelectorCheckedItem,
  RuntimeSelectorSubMenuTitle,
  RUNTIME_SUBMENU_TRIGGER_PROPS,
} from '@/renderer/components/agent/runtimeSelectorOptions';
import { useTranslation } from 'react-i18next';
import { recordOf, type PiModel, type PiSnapshot } from '@/common/pi';
import { invoke, errorText } from '../utils/client';

let cachedModels: PiModel[] | undefined;
const cachedLevels = new Map<string, string[]>();
window.addEventListener('pi-catalog-invalidated', () => {
  cachedModels = undefined;
  cachedLevels.clear();
});

export default function ModelControls({
  snapshot,
  onError,
}: {
  snapshot: PiSnapshot;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const modelKey = JSON.stringify([snapshot.view.model?.provider, snapshot.view.model?.id]);
  const [models, setModels] = useState<PiModel[]>(cachedModels || []);
  const [levels, setLevels] = useState<string[]>(cachedLevels.get(modelKey) || []);
  const [loading, setLoading] = useState(false);
  const id = snapshot.conversation.id;
  const generation = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const load = async (thinkingOnly = false): Promise<void> => {
    const request = ++generation.current;
    setLoading(!cachedModels);
    let catalogLoaded = false;
    try {
      if (!thinkingOnly) {
        const catalog = await invoke('catalog', undefined);
        if (request !== generation.current) return;
        const configured = new Set(catalog.providers.filter((p) => p.configured).map((p) => p.id));
        cachedModels = catalog.models.filter((m) => configured.has(m.provider));
        setModels(cachedModels);
        catalogLoaded = true;
        const failed = catalog.providers.find((p) => p.modelError);
        if (failed?.modelError) {
          cachedModels = undefined;
          onErrorRef.current(errorText(failed.modelError));
        }
        return;
      }
      const thinking = await invoke('command', { id, command: { type: 'get_available_thinking_levels' } });
      if (request !== generation.current) return;
      const available = (Array.isArray(thinking.levels) ? thinking.levels : []).map((value) =>
        typeof value === 'string' ? value : String(recordOf(value).level || recordOf(value).id)
      );
      cachedLevels.set(modelKey, available);
      setLevels(available);
    } catch (e) {
      if (request === generation.current) {
        if (!catalogLoaded && !thinkingOnly) {
          cachedModels = undefined;
          setModels([]);
        }
        onErrorRef.current(errorText(e));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    setModels(cachedModels || []);
    setLevels(cachedLevels.get(modelKey) || []);
    if (!cachedModels) void load();
    const invalidate = () => {
      setModels([]);
      setLevels([]);
      void load();
    };
    window.addEventListener('pi-catalog-invalidated', invalidate);
    return () => {
      generation.current++;
      window.removeEventListener('pi-catalog-invalidated', invalidate);
    };
  }, [id, modelKey]);
  const model = snapshot.view.model;
  const currentModelId = model ? JSON.stringify([model.provider, model.id]) : undefined;
  const modelLabel = model?.name || model?.id || t(loading ? 'common.pi.loading' : 'common.pi.model');
  const thinking = snapshot.view.thinkingLevel;
  const thoughtLabel = thinking ? t(`common.pi.levels.${thinking}`, { defaultValue: thinking }) : '';
  const availableLevels = levels.length ? levels : thinking ? [thinking] : [];
  const modelList = (
    <RuntimeSelectorModelList
      models={models.map((m) => ({
        id: JSON.stringify([m.provider, m.id]),
        label: m.name || m.id,
        description: m.provider,
      }))}
      currentModelId={currentModelId}
      disabled={loading}
      onSelect={(value) => {
        const [provider, modelId] = JSON.parse(value) as string[];
        void invoke('command', { id, command: { type: 'set_model', provider, modelId } }).catch((e) =>
          onError(errorText(e))
        );
      }}
    />
  );
  return (
    <Dropdown
      trigger='click'
      onVisibleChange={(visible) => {
        if (!visible) return;
        void (cachedModels ? Promise.resolve() : load()).then(() => {
          if (model && !cachedLevels.has(modelKey)) return load(true);
        });
      }}
      droplist={
        <Menu selectedKeys={currentModelId ? [currentModelId] : []}>
          {model ? (
            <>
              <Menu.SubMenu
                key='model'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={<RuntimeSelectorSubMenuTitle label={t('common.pi.model')} value={modelLabel} />}
              >
                {modelList}
              </Menu.SubMenu>
              <Menu.SubMenu
                key='thinking'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={<RuntimeSelectorSubMenuTitle label={t('common.pi.thinking')} value={thoughtLabel} />}
              >
                {availableLevels.map((level) => (
                  <Menu.Item
                    key={level}
                    onClick={() => {
                      void invoke('command', { id, command: { type: 'set_thinking_level', level } }).catch((e) =>
                        onError(errorText(e))
                      );
                    }}
                  >
                    <RuntimeSelectorCheckedItem selected={thinking === level}>
                      {t(`common.pi.levels.${level}`, { defaultValue: level })}
                    </RuntimeSelectorCheckedItem>
                  </Menu.Item>
                ))}
              </Menu.SubMenu>
            </>
          ) : (
            modelList
          )}
        </Menu>
      }
    >
      <RuntimeSelectorTrigger
        data-testid='pi-chat-model'
        aria-label={t('common.pi.model')}
        label={[modelLabel, thoughtLabel].filter(Boolean).join(' · ')}
      />
    </Dropdown>
  );
}
