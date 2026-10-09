/**
 * 模型配置 React 钩子（P4）
 * 读取/持久化新的 `ModelSettings`（单一键 `aigv.modelSettings`），并提供 CRUD。
 * 探测 / 拉取走 `discovery.ts`（P3），结果回写 `lastProbe` / `fetchedModels` 并落盘。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { loadOrMigrateModelSettings, saveModelSettings } from '@/core/config/model-settings';
import type { ModelSettings, ProviderInstance } from '@/core/config/model-settings/types';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useModelSettings() {
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

  /** 局部更新某个 provider 的字段（如回写 lastProbe / fetchedModels） */
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

  return { settings, loading, upsertProvider, removeProvider, patchProvider, genId };
}
