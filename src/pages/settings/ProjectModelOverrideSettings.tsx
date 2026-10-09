/**
 * 项目级覆盖面板（P6）
 * =================================================================
 * 当前工程的 slotBindings / capabilityDefaults 覆盖——优先级高于全局（设计 §3.5 步骤 1、3）。
 * 「同一工程换一套模型」（如「这集用便宜模型试跑」）就靠这里，且不影响全局配置。
 * 覆盖只对「当前工程」生效；未打开工程时给出提示。
 *
 * 存储见 `core/config/model-settings/project-overrides.ts`（键 `aigv.projectModelOverrides`，
 * 按 projectId 隔离）；运行时由 `currentProjectSlice` 同步「当前工程 id」供解析层使用。
 */

import { Layers, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AGENT_SLOTS, ALLOC_CAPABILITIES, buildOptions, parseRef, refToValue } from './model-allocation-utils';
import { useModelSettings } from './useModelSettings';

import { Badge } from '@/common/components/ui/badge';
import { Button } from '@/common/components/ui/button';
import { AntDSelect as Select } from '@/common/components/ui/select';
import { toast } from '@/common/components/ui/toast';
import {
  clearProjectOverride,
  getProjectOverride,
  loadProjectOverrides,
  setProjectOverride,
} from '@/core/config/model-settings/project-overrides';
import type { Capability, ProjectModelOverride, SlotId } from '@/core/config/model-settings/types';
import { useProjectStore } from '@/stores/project/project-store';

/** 项目覆盖的空值选项 = 不覆盖，跟随全局 */
const FOLLOW_GLOBAL = '（跟随全局）';

export default function ProjectModelOverrideSettings() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id ?? null;
  const { settings } = useModelSettings();
  const providers = settings?.providers ?? [];

  const [override, setOverride] = useState<ProjectModelOverride>({});

  // 载入项目覆盖；工程切换时重新读取（loadProjectOverrides 幂等，写入运行时缓存）
  useEffect(() => {
    let alive = true;
    void (async () => {
      await loadProjectOverrides();
      if (alive) setOverride(projectId ? (getProjectOverride(projectId) ?? {}) : {});
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  const persist = (next: ProjectModelOverride) => {
    setOverride(next);
    if (projectId) void setProjectOverride(projectId, next);
  };

  const handleCapability = (cap: Capability, value: string) => {
    const capabilityDefaults = { ...(override.capabilityDefaults ?? {}) };
    const ref = parseRef(value);
    if (ref) capabilityDefaults[cap] = ref;
    else delete capabilityDefaults[cap];
    persist({ ...override, capabilityDefaults });
  };

  const handleSlot = (slot: SlotId, value: string) => {
    const slotBindings = { ...(override.slotBindings ?? {}) };
    const ref = parseRef(value);
    if (ref) slotBindings[slot] = ref;
    else delete slotBindings[slot];
    persist({ ...override, slotBindings });
  };

  const handleClear = async () => {
    if (!projectId) return;
    await clearProjectOverride(projectId);
    setOverride({});
    toast.success('已清除本工程的模型覆盖');
  };

  const header = (
    <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 flex-wrap gap-2">
      <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
        <Layers className="w-4 h-4 text-indigo-400" />
        项目级覆盖
        {currentProject?.name && (
          <span className="text-[11px] font-normal text-[var(--muted-foreground)]">· {currentProject.name}</span>
        )}
      </h3>
      <span className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
        当前工程
      </span>
    </div>
  );

  if (!projectId) {
    return (
      <div className="studio-card p-6 space-y-3">
        {header}
        <p className="text-[11px] text-[var(--muted-foreground)]">
          未打开任何工程。打开一个工程后，可在此为它单独覆盖模型分配（不影响全局配置）。
        </p>
      </div>
    );
  }

  const slotCount = Object.values(override.slotBindings ?? {}).filter(Boolean).length;
  const capCount = Object.values(override.capabilityDefaults ?? {}).filter(Boolean).length;

  return (
    <div className="studio-card p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          项目级覆盖
          {currentProject?.name && (
            <span className="text-[11px] font-normal text-[var(--muted-foreground)]">· {currentProject.name}</span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            已覆盖 {slotCount + capCount} 项
          </Badge>
          <Button size="sm" variant="ghost" onClick={handleClear}>
            <RotateCcw className="w-3.5 h-3.5" />
            清除本工程覆盖
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
        仅对当前工程生效，优先级高于全局分配表（设计 §3.5：项目级覆盖 → 全局槽位 → 能力默认 → 兜底）。
        留「跟随全局」表示不覆盖。
      </p>

      {/* 一、能力覆盖 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--foreground)]">能力覆盖（当前工程）</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ALLOC_CAPABILITIES.map((cap) => (
            <div
              key={cap.key}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <Badge variant="outline" className="shrink-0">
                {cap.label}
              </Badge>
              <Select
                className="flex-1 min-w-0"
                options={buildOptions(providers, cap.key, FOLLOW_GLOBAL)}
                value={refToValue(override.capabilityDefaults?.[cap.key])}
                onChange={(v) => handleCapability(cap.key, Array.isArray(v) ? v[0] : v)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 二、槽位覆盖 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--foreground)]">槽位覆盖（当前工程）</h4>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--muted)]/40 text-[var(--muted-foreground)]">
                <th className="text-left font-medium px-3 py-2 w-1/2">流程环节 / 智能体槽位</th>
                <th className="text-left font-medium px-3 py-2">覆盖模型</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_SLOTS.map((meta) => (
                <tr key={meta.slot} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--foreground)]">{meta.label}</span>
                      <Badge variant="secondary" className="shrink-0 font-mono">
                        {meta.slot}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Select
                      className="w-full"
                      options={buildOptions(providers, meta.capability, FOLLOW_GLOBAL)}
                      value={refToValue(override.slotBindings?.[meta.slot])}
                      onChange={(v) => handleSlot(meta.slot, Array.isArray(v) ? v[0] : v)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
