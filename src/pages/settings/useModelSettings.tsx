/**
 * 模型配置 React 上下文（P4）
 * 读取/持久化新的 `ModelSettings`（单一键 `aigv.modelSettings`），并提供 CRUD 与绑定写入。
 * 做成 Context，供设置页下多个子区（提供方管理、模型分配表）共享同一份状态，避免各自 load/save 互相覆盖。
 *
 * 探测 / 拉取走 `discovery.ts`（P3）：结果回写 `lastProbe` / `fetchedModels` 并落盘。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { loadOrMigrateModelSettings, saveModelSettings } from '@/core/config/model-settings';
import type {
  Capability,
  ModelRef,
  ModelSettings,
  ProviderInstance,
  SlotBinding,
  SlotId,
} from '@/core/config/model-settings/types';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface ModelSettingsContextValue {
  settings: ModelSettings | null;
  loading: boolean;
  upsertProvider: (provider: ProviderInstance) => void;
  removeProvider: (id: string) => void;
  /** 局部更新某个 provider 的字段（如回写 lastProbe / fetchedModels） */
  patchProvider: (id: string, patch: Partial<ProviderInstance>) => void;
  /** 设置某个槽位的绑定（传 undefined = 清除，回退到能力默认） */
  setSlotBinding: (slot: SlotId, binding: SlotBinding | undefined) => void;
  /** 设置某个能力的默认提供方（传 undefined = 清除） */
  setCapabilityDefault: (cap: Capability, ref: ModelRef | undefined) => void;
  genId: () => string;
}

const ModelSettingsContext = createContext<ModelSettingsContextValue | null>(null);

export function ModelSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<ModelSettings | null>(null);

  useEffect(() => {
    let active = true;
    loadOrMigrateModelSettings()
      .then((s) => {
        if (!active) return;
        ref.current = s;
        setSettings(s);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** 写入新配置并落盘 */
  const commit = useCallback((next: ModelSettings) => {
    ref.current = next;
    setSettings(next);
    void saveModelSettings(next);
  }, []);

  const upsertProvider = useCallback(
    (provider: ProviderInstance) => {
      const prev = ref.current;
      if (!prev) return;
      const idx = prev.providers.findIndex((p) => p.id === provider.id);
      const providers =
        idx >= 0
          ? prev.providers.map((p) => (p.id === provider.id ? provider : p))
          : [...prev.providers, provider];
      commit({ ...prev, providers });
    },
    [commit]
  );

  const removeProvider = useCallback(
    (id: string) => {
      const prev = ref.current;
      if (!prev) return;
      commit({ ...prev, providers: prev.providers.filter((p) => p.id !== id) });
    },
    [commit]
  );

  const patchProvider = useCallback(
    (id: string, patch: Partial<ProviderInstance>) => {
      const prev = ref.current;
      if (!prev) return;
      commit({
        ...prev,
        providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      });
    },
    [commit]
  );

  const setSlotBinding = useCallback(
    (slot: SlotId, binding: SlotBinding | undefined) => {
      const prev = ref.current;
      if (!prev) return;
      const slotBindings = { ...prev.slotBindings };
      if (binding === undefined) delete slotBindings[slot];
      else slotBindings[slot] = binding;
      commit({ ...prev, slotBindings });
    },
    [commit]
  );

  const setCapabilityDefault = useCallback(
    (cap: Capability, modelRef: ModelRef | undefined) => {
      const prev = ref.current;
      if (!prev) return;
      const capabilityDefaults = { ...prev.capabilityDefaults };
      if (modelRef === undefined) delete capabilityDefaults[cap];
      else capabilityDefaults[cap] = modelRef;
      commit({ ...prev, capabilityDefaults });
    },
    [commit]
  );

  const value: ModelSettingsContextValue = {
    settings,
    loading,
    upsertProvider,
    removeProvider,
    patchProvider,
    setSlotBinding,
    setCapabilityDefault,
    genId,
  };

  return <ModelSettingsContext.Provider value={value}>{children}</ModelSettingsContext.Provider>;
}

export function useModelSettings(): ModelSettingsContextValue {
  const ctx = useContext(ModelSettingsContext);
  if (!ctx) throw new Error('useModelSettings 必须在 <ModelSettingsProvider> 内使用');
  return ctx;
}
