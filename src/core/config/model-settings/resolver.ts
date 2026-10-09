/**
 * 模型引用解析（P2a + 设计 §3.5）
 * ===================================
 * 给定 ModelSettings + 能力（可选槽位 + 项目级覆盖），按 §3.5 顺序解析出
 * 一个可用的 { provider, modelId }。解析失败抛出具名错误，指名道姓说缺哪个槽位 / 能力
 * （而不是老代码那句「请先配置 API Key」）。
 */

import { hasUsableCredentials, withEffectiveCredentials } from './credentials';
import type {
  Capability,
  ModelRef,
  ModelSettings,
  ProjectModelOverride,
  ProviderInstance,
  SlotId,
} from './types';

export class ModelResolutionError extends Error {
  constructor(
    message: string,
    public readonly capability: Capability,
    public readonly slot?: SlotId
  ) {
    super(message);
    this.name = 'ModelResolutionError';
  }
}

export interface ResolveOptions {
  /** 流程环节 / 智能体槽位（可缩小解析范围） */
  slot?: SlotId;
  /** 项目级覆盖（P6；优先级高于全局） */
  projectOverride?: ProjectModelOverride;
}

/**
 * 在 settings 里找一个能力下第一个 enabled 且有「可用凭据」的 ProviderInstance。
 * 用 `hasUsableCredentials` 而非直接看 `p.apiKey`，这样「凭据继承」的实例
 * （自身 apiKey 为空、从别的实例继承）也能被兜底选中。
 */
function firstEnabledProvider(
  settings: ModelSettings,
  capability: Capability
): ProviderInstance | undefined {
  return settings.providers.find(
    (p) => p.capability === capability && p.enabled && hasUsableCredentials(settings, p)
  );
}

/**
 * 解析能力 / 槽位对应的模型引用。顺序（§3.5）：
 * 1. 项目级 slotBindings[slot]
 * 2. 全局 slotBindings[slot].ref
 * 3. 项目级 capabilityDefaults[capability]
 * 4. 全局 capabilityDefaults[capability]
 * 5. 该能力下第一个 enabled 且有 key 的实例的 defaultModel
 * 6. 报错（指名道姓）
 */
export function resolveModelRef(
  settings: ModelSettings,
  capability: Capability,
  options: ResolveOptions = {}
): { provider: ProviderInstance; modelId: string } {
  const { slot, projectOverride } = options;
  const providerById = (id: string) => settings.providers.find((p) => p.id === id);

  let ref: ModelRef | undefined;

  // 1. 项目级 slot
  if (slot && projectOverride?.slotBindings?.[slot]) {
    ref = projectOverride.slotBindings[slot];
  }
  // 2. 全局 slot
  if (!ref && slot && settings.slotBindings[slot]?.ref) {
    ref = settings.slotBindings[slot]!.ref;
  }
  // 3. 项目级能力默认
  if (!ref && projectOverride?.capabilityDefaults?.[capability]) {
    ref = projectOverride.capabilityDefaults[capability];
  }
  // 4. 全局能力默认
  if (!ref && settings.capabilityDefaults[capability]) {
    ref = settings.capabilityDefaults[capability];
  }

  if (ref) {
    const provider = providerById(ref.providerId);
    if (!provider) {
      throw new ModelResolutionError(
        `引用了不存在的提供方实例 "${ref.providerId}"（能力 ${capability}${slot ? `，槽位 ${slot}` : ''}）`,
        capability,
        slot
      );
    }
    if (!provider.enabled) {
      throw new ModelResolutionError(
        `提供方实例「${provider.label}」已禁用（能力 ${capability}）`,
        capability,
        slot
      );
    }
    return {
      provider: withEffectiveCredentials(settings, provider),
      modelId: ref.modelId || provider.defaultModel || '',
    };
  }

  // 5. 兜底：该能力第一个 enabled 且有可用凭据的实例
  const fallback = firstEnabledProvider(settings, capability);
  if (fallback) {
    return { provider: withEffectiveCredentials(settings, fallback), modelId: fallback.defaultModel || '' };
  }

  // 6. 报错
  throw new ModelResolutionError(
    slot
      ? `未为「${slot}」配置可用的${capability}提供方，请先在设置里配置。`
      : `未配置任何可用的${capability}提供方，请先在设置里配置。`,
    capability,
    slot
  );
}

/** 便捷：解析文本能力 */
export function resolveTextModelRef(
  settings: ModelSettings,
  options: ResolveOptions = {}
): { provider: ProviderInstance; modelId: string } {
  return resolveModelRef(settings, 'text', options);
}
