/**
 * 模型分配 / 覆盖的共享工具（P4 / P6）
 * =====================================
 * - 已知 Agent 槽位静态表 + 参与分配的能力
 * - 'providerId::modelId' 编解码 + 「提供方 + 模型」下拉选项构建
 * 供 `ModelAllocationSettings`（全局绑定层）与 `ProjectModelOverrideSettings`（项目级覆盖）复用。
 */

import type { SelectOption } from '@/common/components/ui/select';
import { getBuiltinVideoDescriptor } from '@/core/ai/protocols/vendor-task-descriptors';
import type { Capability, ModelRef, ProviderInstance, SlotId } from '@/core/config/model-settings/types';

export interface SlotMeta {
  slot: SlotId;
  label: string;
  capability: Capability;
}

/** 设计文档 §3.4 列出的 8 个流程环节（custom.* 由用户自定义 Agent 扩展，不在静态表内） */
export const AGENT_SLOTS: SlotMeta[] = [
  { slot: 'script.ingest', label: '剧本 / 小说识别拆解', capability: 'text' },
  { slot: 'script.rewrite', label: '剧本精修', capability: 'text' },
  { slot: 'character.design', label: '角色人设 + 锁脸 prompt', capability: 'text' },
  { slot: 'storyboard.plan', label: '分镜运镜规划', capability: 'text' },
  { slot: 'storyboard.image', label: '分镜出图', capability: 'image' },
  { slot: 'video.generate', label: '分镜转视频', capability: 'video' },
  { slot: 'video.lipsync', label: '唇同步 / 说话人脸', capability: 'video' },
  { slot: 'audio.tts', label: '配音', capability: 'tts' },
  { slot: 'util.fast', label: '标题 / 摘要 / 打标等杂活', capability: 'text' },
];

/** 参与分配表的能力（stt / embedding 预留，暂不进 UI） */
export const ALLOC_CAPABILITIES: { key: Capability; label: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图像' },
  { key: 'video', label: '视频' },
  { key: 'tts', label: '语音' },
];

/** 该提供方可选的模型列表：优先 /models 拉取结果 → 手动填写 → 描述符候选 → 默认模型 */
export function providerModels(provider: ProviderInstance): string[] {
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

/** 'providerId::modelId' → ModelRef；空串 → undefined */
export function parseRef(value: string): ModelRef | undefined {
  if (!value) return undefined;
  const idx = value.indexOf('::');
  const providerId = idx >= 0 ? value.slice(0, idx) : value;
  const modelId = idx >= 0 ? value.slice(idx + 2) : undefined;
  return { providerId, modelId: modelId || undefined };
}

/** ModelRef → 'providerId::modelId'；undefined → '' */
export function refToValue(ref?: ModelRef): string {
  if (!ref) return '';
  return `${ref.providerId}::${ref.modelId ?? ''}`;
}

/**
 * 构建「提供方 + 模型」下拉选项（含每个提供方的「默认模型」项）。
 * @param emptyLabel 空值选项文案（全局分配表=「能力默认」，项目覆盖=「跟随全局」）
 */
export function buildOptions(
  providers: ProviderInstance[],
  cap: Capability,
  emptyLabel = '🎯 能力默认（按能力回退）'
): SelectOption[] {
  const opts: SelectOption[] = [{ value: '', label: emptyLabel }];
  // 网关优先：标记 isGateway 的实例排在同能力其它实例之前（设计 §7.2）
  const list = providers
    .filter((x) => x.capability === cap && x.enabled)
    .sort((a, b) => Number(b.isGateway ?? false) - Number(a.isGateway ?? false));
  for (const p of list) {
    opts.push({ value: `${p.id}::`, label: `${p.label}${p.isGateway ? '（网关）' : '（默认模型）'}` });
    for (const m of providerModels(p)) {
      opts.push({ value: `${p.id}::${m}`, label: `${p.label} · ${m}` });
    }
  }
  return opts;
}
