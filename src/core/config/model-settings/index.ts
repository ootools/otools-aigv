/**
 * 模型 / 提供方配置 —— 模块门面（P1）
 *
 * 对外只暴露纯函数：读取（含迁移）、写入、清空，以及类型与迁移单元。
 * 业务侧（P2+ 的适配器、P4 的 UI、P5 的 Agent）从这里取配置，不直接碰存储与迁移细节。
 */

export * from './types';
export {
  getModelSettingsBackend,
  setModelSettingsBackend,
  resetModelSettingsBackend,
  emptyModelSettings,
  loadModelSettings,
  saveModelSettings,
  clearModelSettings,
} from './store';
export { LocalStorageBackend, OtoolsStoreBackend } from './backend';
export type { SettingsBackend } from './backend';
export { migrateLegacyModelConfig } from './migration';
export {
  getProjectOverridesBackend,
  setProjectOverridesBackend,
  resetProjectOverridesBackend,
  loadProjectOverrides,
  saveProjectOverrides,
  getAllProjectOverrides,
  getProjectOverride,
  isEmptyOverride,
  setProjectOverride,
  clearProjectOverride,
  setCurrentProjectId,
  getCurrentProjectId,
  getCurrentProjectOverride,
  resetProjectOverrideCache,
} from './project-overrides';
export type { ProjectOverridesMap } from './project-overrides';
export {
  extractCredentials,
  copyCredentials,
  applyCredentials,
  resolveEffectiveCredentials,
  withEffectiveCredentials,
  hasUsableCredentials,
} from './credentials';
export type { ProviderCredentials } from './credentials';
export { PROVIDER_PRESETS, getProviderPreset, applyProviderPreset } from './presets';
export type { ProviderPreset } from './presets';

import { migrateLegacyModelConfig } from './migration';
import { loadModelSettings, saveModelSettings } from './store';
import type { ModelSettings } from './types';

/**
 * 读取模型配置：
 * 1. 已有新结构（providers 非空）→ 直接返回；
 * 2. 否则跑迁移（吃掉老四套命名），有结果则落盘后返回；
 * 3. 无老配置 → 返回空配置（用户在新 UI 里从零建）。
 */
export async function loadOrMigrateModelSettings(): Promise<ModelSettings> {
  const existing = await loadModelSettings();
  if (existing.providers.length > 0) return existing;

  const migrated = migrateLegacyModelConfig();
  if (migrated.providers.length > 0) {
    await saveModelSettings(migrated);
  }
  return migrated;
}
