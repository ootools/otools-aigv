/**
 * 项目级模型覆盖存储（P6）
 * =====================
 * 设计 §3.4：同一个工程可以换一套模型（如「这集用便宜模型试跑」）。
 * 覆盖分两层：`slotBindings` / `capabilityDefaults`，解析时优先级高于全局（见 resolver §3.5）。
 *
 * 存储：状态键 `aigv.projectModelOverrides`（与全局配置同文件 `model-settings.json`，不同 key），
 * 值为 `Record<projectId, ProjectModelOverride>`，同样走 OTools 插件本地状态 / localStorage 回退。
 * 运行时另维护「当前 projectId」与覆盖缓存，供同步解析使用。
 */


import { LocalStorageBackend, OtoolsStoreBackend, type SettingsBackend } from './backend';
import { PROJECT_OVERRIDES_STORAGE_KEY, type ProjectModelOverride } from './types';

import { detectTauriEnvironment } from '@/core/services/project/secure-storage-service';

/** 与全局配置共用一个落盘文件，避免多文件 */
const STORE_FILE = 'model-settings.json';

export type ProjectOverridesMap = Record<string, ProjectModelOverride>;

let backend: SettingsBackend | null = null;
let currentOverrides: ProjectOverridesMap = {};
let currentProjectId: string | null = null;

/** 选择/返回当前后端（带缓存） */
export function getProjectOverridesBackend(): SettingsBackend {
  if (!backend) {
    backend = detectTauriEnvironment()
      ? new OtoolsStoreBackend(STORE_FILE, PROJECT_OVERRIDES_STORAGE_KEY)
      : new LocalStorageBackend(PROJECT_OVERRIDES_STORAGE_KEY);
  }
  return backend;
}

/** 测试注入 / 切换后端 */
export function setProjectOverridesBackend(next: SettingsBackend): void {
  backend = next;
}

/** 重置为按环境自动选择（测试 teardown 用） */
export function resetProjectOverridesBackend(): void {
  backend = null;
}

const isUsableMap = (value: unknown): value is ProjectOverridesMap =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 读取全部项目覆盖；缺失或解析失败 → {} */
export async function loadProjectOverrides(): Promise<ProjectOverridesMap> {
  const raw = await getProjectOverridesBackend().load();
  if (!raw) {
    currentOverrides = {};
    return currentOverrides;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    currentOverrides = isUsableMap(parsed) ? parsed : {};
  } catch {
    currentOverrides = {};
  }
  return currentOverrides;
}

/** 写入全部项目覆盖 */
export async function saveProjectOverrides(map: ProjectOverridesMap): Promise<void> {
  currentOverrides = map;
  await getProjectOverridesBackend().save(JSON.stringify(map));
}

/** 同步读取全部覆盖（未加载过返回 {}） */
export function getAllProjectOverrides(): ProjectOverridesMap {
  return currentOverrides;
}

/** 同步读取某项目的覆盖（无 projectId 或未配置 → undefined） */
export function getProjectOverride(
  projectId: string | null | undefined
): ProjectModelOverride | undefined {
  if (!projectId) return undefined;
  return currentOverrides[projectId];
}

const countDefined = (record?: Record<string, unknown>): number =>
  record ? Object.values(record).filter((v) => v !== undefined && v !== null).length : 0;

/** 覆盖是否为空（两层都没配有效项） */
export function isEmptyOverride(override: ProjectModelOverride): boolean {
  return countDefined(override.slotBindings) === 0 && countDefined(override.capabilityDefaults) === 0;
}

/** 设置/更新某项目的覆盖（空覆盖视为清除该项） */
export async function setProjectOverride(
  projectId: string,
  override: ProjectModelOverride
): Promise<void> {
  const next: ProjectOverridesMap = { ...currentOverrides };
  if (isEmptyOverride(override)) {
    delete next[projectId];
  } else {
    next[projectId] = override;
  }
  await saveProjectOverrides(next);
}

/** 清除某项目的覆盖 */
export async function clearProjectOverride(projectId: string): Promise<void> {
  const next: ProjectOverridesMap = { ...currentOverrides };
  delete next[projectId];
  await saveProjectOverrides(next);
}

/** 当前工程 id（由应用层在切换工程时写入） */
export function setCurrentProjectId(projectId: string | null): void {
  currentProjectId = projectId ?? null;
}

/** 当前工程 id（未设置返回 null） */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/** 当前工程的覆盖（无则 undefined） */
export function getCurrentProjectOverride(): ProjectModelOverride | undefined {
  return getProjectOverride(currentProjectId);
}

/** 测试 teardown：清运行时缓存（不动后端） */
export function resetProjectOverrideCache(): void {
  currentOverrides = {};
  currentProjectId = null;
}
