/**
 * 模型分配表（P4 第二轮）
 * =================================================================
 * 把新架构的「绑定层」可视化 + 可编辑：
 *  1. 能力默认（capabilityDefaults）：每个能力选一个默认提供方（+ 默认模型），
 *     解析链 §3.5 步骤 4 的落点，覆盖「该能力首个 enabled 实例」兜底。
 *  2. 槽位分配（slotBindings）：按 Agent 流程环节列出 8 个已知槽位，
 *     每个槽位可单独绑定「提供方 + 模型」，或留空回退能力默认。
 *
 * 所有写入都走共享的 ModelSettingsProvider（useModelSettings），与提供方管理区
 * 共用同一份状态，避免两个子树各自 load/save 互相覆盖。
 */

import { Boxes, Layers } from 'lucide-react';

import { useModelSettings } from './useModelSettings';

import { Badge } from '@/common/components/ui/badge';
import { AntDSelect as Select, type SelectOption } from '@/common/components/ui/select';
import { getBuiltinVideoDescriptor } from '@/core/ai/protocols/vendor-task-descriptors';
import type {
  Capability,
  ModelRef,
  ProviderInstance,
  SlotBinding,
  SlotId,
} from '@/core/config/model-settings/types';

// ─────────────── 静态元数据：已知 Agent 槽位 ───────────────

interface SlotMeta {
  slot: SlotId;
  label: string;
  capability: Capability;
}

/** 设计文档 §3.4 列出的 8 个流程环节（custom.* 由用户自定义 Agent 扩展，不在静态表内） */
const AGENT_SLOTS: SlotMeta[] = [
  { slot: 'script.ingest', label: '剧本 / 小说识别拆解', capability: 'text' },
  { slot: 'script.rewrite', label: '剧本精修', capability: 'text' },
  { slot: 'character.design', label: '角色人设 + 锁脸 prompt', capability: 'text' },
  { slot: 'storyboard.plan', label: '分镜运镜规划', capability: 'text' },
  { slot: 'storyboard.image', label: '分镜出图', capability: 'image' },
  { slot: 'video.generate', label: '分镜转视频', capability: 'video' },
  { slot: 'audio.tts', label: '配音', capability: 'tts' },
  { slot: 'util.fast', label: '标题 / 摘要 / 打标等杂活', capability: 'text' },
];

/** 参与分配表的能力（stt / embedding 预留，暂不进 UI） */
const ALLOC_CAPABILITIES: { key: Capability; label: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图像' },
  { key: 'video', label: '视频' },
  { key: 'tts', label: '语音' },
];

// ─────────────── 取值 / 编码工具 ───────────────

/** 该提供方可选的模型列表：优先 /models 拉取结果 → 手动填写 → 描述符候选 → 默认模型 */
function providerModels(provider: ProviderInstance): string[] {
  if (provider.fetchedModels && provider.fetchedModels.models.length > 0) {
    return provider.fetchedModels.models;
  }
  if (provider.manualModels && provider.manualModels.length > 0) {
    return provider.manualModels;
  }
  if (provider.protocol === 'vendor-task' && provider.vendorDescriptorId) {
    const desc = getBuiltinVideoDescriptor(provider.vendorDescriptorId);
    if (desc?.candidateModels && desc.candidateModels.length > 0) return desc.candidateModels;
  }
  if (provider.defaultModel) return [provider.defaultModel];
  return [];
}

/** 'providerId::modelId' → ModelRef；空串 → undefined（回退能力默认） */
function parseRef(value: string): ModelRef | undefined {
  if (!value) return undefined;
  const idx = value.indexOf('::');
  const providerId = idx >= 0 ? value.slice(0, idx) : value;
  const modelId = idx >= 0 ? value.slice(idx + 2) : undefined;
  return { providerId, modelId: modelId || undefined };
}

/** ModelRef → 'providerId::modelId'；undefined → '' */
function refToValue(ref?: ModelRef): string {
  if (!ref) return '';
  return `${ref.providerId}::${ref.modelId ?? ''}`;
}

/** 构建「提供方 + 模型」下拉选项（含每个提供方的「默认模型」项） */
function buildOptions(providers: ProviderInstance[], cap: Capability): SelectOption[] {
  const opts: SelectOption[] = [{ value: '', label: '🎯 能力默认（按能力回退）' }];
  for (const p of providers.filter((x) => x.capability === cap && x.enabled)) {
    opts.push({ value: `${p.id}::`, label: `${p.label}（默认模型）` });
    for (const m of providerModels(p)) {
      opts.push({ value: `${p.id}::${m}`, label: `${p.label} · ${m}` });
    }
  }
  return opts;
}

// ─────────────── 组件 ───────────────

export default function ModelAllocationSettings() {
  const { settings, setSlotBinding, setCapabilityDefault } = useModelSettings();
  const providers = settings?.providers ?? [];

  const handleCapabilityDefault = (cap: Capability, value: string) => {
    setCapabilityDefault(cap, parseRef(value));
  };

  const handleSlotBinding = (meta: SlotMeta, value: string) => {
    const ref = parseRef(value);
    const binding: SlotBinding | undefined = ref
      ? { slot: meta.slot, capability: meta.capability, ref }
      : undefined;
    setSlotBinding(meta.slot, binding);
  };

  return (
    <div className="studio-card p-6 space-y-6">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          模型分配表
        </h3>
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
          绑定层 · 覆盖兜底
        </span>
      </div>

      <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">
        解析链（设计 §3.5）：槽位绑定 → 能力默认 → 该能力首个可用实例。在这里设好「能力默认」与
        关键槽位，即可让全部 Agent 稳定走新配置，无需逐个改代码。
      </p>

      {/* 一、能力默认 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-2">
          <Boxes className="w-3.5 h-3.5 text-indigo-400" />
          能力默认（按能力选兜底提供方）
        </h4>
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
                options={buildOptions(providers, cap.key)}
                value={refToValue(settings?.capabilityDefaults?.[cap.key])}
                onChange={(v) => handleCapabilityDefault(cap.key, Array.isArray(v) ? v[0] : v)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* 二、槽位分配表 */}
      <section className="space-y-3">
        <h4 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          槽位分配（按 Agent 流程环节）
        </h4>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--muted)]/40 text-[var(--muted-foreground)]">
                <th className="text-left font-medium px-3 py-2 w-1/2">流程环节 / 智能体槽位</th>
                <th className="text-left font-medium px-3 py-2">绑定模型</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_SLOTS.map((meta) => {
                const binding = settings?.slotBindings?.[meta.slot];
                return (
                  <tr key={meta.slot} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--foreground)]">{meta.label}</span>
                        <Badge variant="secondary" className="shrink-0 font-mono">
                          {meta.slot}
                        </Badge>
                      </div>
                      <Badge variant="outline" className="mt-1 font-mono">
                        {meta.capability}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        className="w-full"
                        options={buildOptions(providers, meta.capability)}
                        value={refToValue(binding?.ref)}
                        onChange={(v) => handleSlotBinding(meta, Array.isArray(v) ? v[0] : v)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          留空 = 回退该能力的默认提供方；选「默认模型」= 用提供方设置的默认模型，不选具体模型。
        </p>
      </section>
    </div>
  );
}
