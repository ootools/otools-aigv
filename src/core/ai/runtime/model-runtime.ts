/**
 * 模型运行时（P5）：把「槽位 → 提供方 / 模型」的解析收敛到一个入口。
 *
 * 设计 §3.5 的解析链（slot 绑定 → 能力默认 → 该能力首个可用实例）已经在
 * `resolver.ts` 的 `resolveModelRef` 实现；这里只是按「槽位」语义再包一层，
 * 供 MasterDirectorAgent 按槽位解析并打日志、供服务层按 slot 调 LLM。
 *
 * 同步读取走 store 的 `getModelSettings()`（运行时缓存，避免每次解析都异步读盘）。
 * 本模块只依赖配置层（model-settings），不反向依赖 services/agent，保持分层干净。
 */

import { resolveModelRef } from '@/core/config/model-settings/resolver';
import { getModelSettings } from '@/core/config/model-settings/store';
import {
  capabilityForSlot,
  type Capability,
  type ModelSettings,
  type ProviderInstance,
  type SlotId,
} from '@/core/config/model-settings/types';

export { getModelSettings };

export interface ResolvedSlotModel {
  provider: ProviderInstance;
  modelId: string;
  capability: Capability;
}

/**
 * 按槽位解析出「提供方 + 模型 + 能力」。解析失败（该 slot 未配置任何可用提供方）抛
 * `ModelResolutionError`（指名道姓说缺哪个槽位/能力），由调用方决定兜底或上报。
 */
export function resolveSlotModel(settings: ModelSettings, slot: SlotId): ResolvedSlotModel {
  const capability = capabilityForSlot(slot);
  const { provider, modelId } = resolveModelRef(settings, capability, { slot });
  return { provider, modelId, capability };
}

/**
 * 安全版：解析失败返回 null（不抛），供「打日志 / 给默认值」场景使用。
 */
export function resolveSlotModelSafe(
  settings: ModelSettings | null,
  slot: SlotId | undefined
): ResolvedSlotModel | null {
  if (!settings || !slot) return null;
  try {
    return resolveSlotModel(settings, slot);
  } catch {
    return null;
  }
}
