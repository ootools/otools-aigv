/**
 * 模型配置存储层（P1）
 *
 * 单一状态键 `aigv.modelSettings`，按环境选择后端：
 * - 桌面 / OTools 宿主（window.otools 或 __TAURI__）→ OtoolsStoreBackend（native 本地状态）
 * - Web / 测试（jsdom）→ LocalStorageBackend
 *
 * P1 只管读写与「空」判定；迁移见 migration.ts，业务读取见 index.ts。
 */

import { detectTauriEnvironment } from '@/core/services/project/secure-storage-service';

import {
  LocalStorageBackend,
  OtoolsStoreBackend,
  type SettingsBackend,
} from './backend';
import {
  MODEL_SETTINGS_SCHEMA_VERSION,
  MODEL_SETTINGS_STORAGE_KEY,
  type ModelSettings,
} from './types';

/** 落盘文件名（OtoolsStoreBackend 用；对应 ~/.otools/local/aigv/model-settings.json） */
const STORE_FILE = 'model-settings.json';

let backend: SettingsBackend | null = null;

/** 选择/返回当前后端（带缓存） */
export function getModelSettingsBackend(): SettingsBackend {
  if (!backend) {
    backend = detectTauriEnvironment()
      ? new OtoolsStoreBackend(STORE_FILE, MODEL_SETTINGS_STORAGE_KEY)
      : new LocalStorageBackend(MODEL_SETTINGS_STORAGE_KEY);
  }
  return backend;
}

/** 测试注入 / 切换后端 */
export function setModelSettingsBackend(next: SettingsBackend): void {
  backend = next;
}

/** 重置为按环境自动选择（测试 teardown 用） */
export function resetModelSettingsBackend(): void {
  backend = null;
}

/** 全新空配置 */
export function emptyModelSettings(): ModelSettings {
  return {
    schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION,
    providers: [],
    capabilityDefaults: {},
    slotBindings: {},
  };
}

const isUsableSettings = (value: unknown): value is ModelSettings => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelSettings>;
  return Array.isArray(candidate.providers);
};

/** 读取模型配置；缺失或解析失败 → 空配置 */
export async function loadModelSettings(): Promise<ModelSettings> {
  const raw = await getModelSettingsBackend().load();
  if (!raw) return emptyModelSettings();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isUsableSettings(parsed)) return emptyModelSettings();
    return { ...emptyModelSettings(), ...parsed, schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION };
  } catch {
    return emptyModelSettings();
  }
}

/** 写入模型配置（强制带上当前 schemaVersion） */
export async function saveModelSettings(settings: ModelSettings): Promise<void> {
  const next: ModelSettings = { ...settings, schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION };
  await getModelSettingsBackend().save(JSON.stringify(next));
}

/** 清空模型配置 */
export async function clearModelSettings(): Promise<void> {
  await getModelSettingsBackend().clear();
}
