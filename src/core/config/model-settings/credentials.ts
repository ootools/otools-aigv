/**
 * 凭据处理（P6）：复制 / 继承
 * =========================
 * 设计 §3.8：用户核心痛点是「配太多 KEY」。两个手段：
 * 1. **从已有实例复制凭据**（一次性，建实例时预填）——`copyCredentials`
 * 2. **能力继承**（持续，运行时跟随）——`credentialSourceId` + `resolveEffectiveCredentials`
 *    （「图像 / 视频 / 语音实例继承文本实例的凭据」，多数中转站同一 key 全通）
 *
 * 本模块只依赖类型、不碰存储；解析器（resolver）在解析出实例后调用
 * `withEffectiveCredentials` 把「生效凭据」合并进返回的实例，从而让所有客户端自动享受继承。
 */

import type { AuthStyle, ModelSettings, ProviderInstance } from './types';

/** 承载凭据的字段（复制 / 继承时搬运的就是这些） */
export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
  authStyle: AuthStyle;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  accessKey?: string;
  secretKey?: string;
}

/** 从实例抽出凭据字段 */
export function extractCredentials(provider: ProviderInstance): ProviderCredentials {
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    authStyle: provider.authStyle,
    extraHeaders: provider.extraHeaders,
    queryParams: provider.queryParams,
    accessKey: provider.accessKey,
    secretKey: provider.secretKey,
  };
}

/**
 * 把 source 的凭据复制到 target（一次性；用于「从已有实例复制凭据」预填新实例）。
 * 只覆盖凭据字段，target 的 id / label / capability / protocol / 模型配置保持不变，
 * 且**不**建立持续继承关系（不写 `credentialSourceId`）。
 */
export function copyCredentials(target: ProviderInstance, source: ProviderInstance): ProviderInstance {
  return { ...target, ...extractCredentials(source) };
}

/** 把凭据字段合并进实例（返回新对象，不改原对象） */
export function applyCredentials(
  provider: ProviderInstance,
  creds: ProviderCredentials
): ProviderInstance {
  return { ...provider, ...creds };
}

/**
 * 解析实例的「生效凭据」：
 * - 若 `provider.credentialSourceId` 指向另一个存在的实例 → 用那个实例的凭据；
 *   源实例若自己也继承 → 继续向上找（带 `visited` 防环）。
 * - 源不存在 / 未设置 → 用自己的凭据（优雅回退，不抛错）。
 */
export function resolveEffectiveCredentials(
  settings: ModelSettings,
  provider: ProviderInstance
): ProviderCredentials {
  const byId = (id: string) => settings.providers.find((p) => p.id === id);
  const visited = new Set<string>([provider.id]);

  let current = provider;
  let sourceId = provider.credentialSourceId;
  while (sourceId && !visited.has(sourceId)) {
    const source = byId(sourceId);
    if (!source) break; // 源不存在 → 回退到当前实例自己的凭据
    visited.add(source.id);
    current = source;
    sourceId = source.credentialSourceId;
  }

  return extractCredentials(current);
}

/**
 * 给实例套上生效凭据。无继承（`credentialSourceId` 为空）→ **原样返回**（保持引用与身份不变，
 * 避免无谓拷贝）；有继承 → 返回合并后的新实例。
 */
export function withEffectiveCredentials(
  settings: ModelSettings,
  provider: ProviderInstance
): ProviderInstance {
  if (!provider.credentialSourceId) return provider;
  return applyCredentials(provider, resolveEffectiveCredentials(settings, provider));
}

/** 实例是否有「可用凭据」（自己的或继承来的 apiKey 非空）——供解析器兜底筛选 */
export function hasUsableCredentials(settings: ModelSettings, provider: ProviderInstance): boolean {
  return Boolean(resolveEffectiveCredentials(settings, provider).apiKey);
}
