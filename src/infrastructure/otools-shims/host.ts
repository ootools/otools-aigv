/**
 * OTools 宿主桥的最小封装（不依赖 otools-plugin-sdk，保证本仓库可独立构建）
 * ---------------------------------------------------------------
 * 宿主注入的 `window.otools` 提供两类能力：
 *  - 宿主级文件/对话框/路径能力（readHostFile / writeHostFile / listHostDir / dialog / paths）
 *  - native 插件调用（invokeNative / invokeNativePlugin），用于调本插件自己的 Rust 后端
 *
 * `invokeNativePlugin` 的返回信封是 `{ ok, data }` / `{ ok, error }`，宿主桥会
 * 直接解包 `data`、并在 `ok === false` 时抛错，这里沿用同一契约。
 */

/** 与 plugin.json 的 uuid / packid 保持一致 */
export const PLUGIN_UUID = 'otools-aigv';

interface OtoolsDialogFilterLike {
  name: string;
  extensions: string[];
}

export interface OtoolsHostBridge {
  platform?: string;
  paths?: Record<string, string>;
  invokeNative?<T>(method: string, payload?: unknown): Promise<T>;
  invokeNativePlugin?<T>(uuid: string, method: string, payload?: unknown): Promise<T>;
  readHostFile?(path: string): Promise<{ dataBase64: string }>;
  writeHostFile?(request: { path: string; dataBase64: string }): Promise<void>;
  listHostDir?(path: string): Promise<
    { name: string; path: string; kind: string; size: number; lastModified?: number | null }[]
  >;
  dialog?: {
    open?(options?: {
      directory?: boolean;
      multiple?: boolean;
      title?: string;
      defaultPath?: string;
      filters?: OtoolsDialogFilterLike[];
    }): Promise<string | string[] | null>;
    save?(options?: {
      title?: string;
      defaultPath?: string;
      filters?: OtoolsDialogFilterLike[];
    }): Promise<string | null>;
    message?(text: string, options?: unknown): Promise<void>;
    confirm?(text: string, options?: unknown): Promise<boolean>;
  } | null;
  shellOpenPath?(path: string): void;
  shellShowItemInFolder?(path: string): void;
}

interface OtoolsGlobalScope {
  otools?: OtoolsHostBridge;
  utools?: OtoolsHostBridge;
}

/** 取宿主桥；宿主未注入时返回 undefined（纯浏览器预览） */
export function getOtools(): OtoolsHostBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as OtoolsGlobalScope;
  return scope.otools ?? scope.utools;
}

/** 是否运行在 OTools 宿主中 */
export function isOtoolsHost(): boolean {
  return Boolean(getOtools());
}

/** 调用本插件自己的 native 后端 */
export async function invokePlugin<T = unknown>(
  method: string,
  payload?: Record<string, unknown> | null,
): Promise<T> {
  const otools = getOtools();
  if (!otools) {
    throw new Error('OTools 宿主 API 不可用，native 插件调用失败');
  }
  if (typeof otools.invokeNative === 'function') {
    return otools.invokeNative<T>(method, payload ?? null);
  }
  if (typeof otools.invokeNativePlugin === 'function') {
    return otools.invokeNativePlugin<T>(PLUGIN_UUID, method, payload ?? null);
  }
  throw new Error('OTools 宿主不支持 native 插件调用');
}

/** 取宿主提供的系统目录 */
export function hostPath(name: string): string | null {
  const paths = getOtools()?.paths;
  const value = paths?.[name];
  return typeof value === 'string' && value ? value : null;
}

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 拼接路径片段（按宿主平台选分隔符） */
export function joinHostPath(...parts: string[]): string {
  const separator = getOtools()?.platform === 'windows' ? '\\' : '/';
  const cleaned = parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      const trimmed = part.replace(/^[/\\]+|[/\\]+$/g, '');
      return index === 0 ? part.replace(/[/\\]+$/, '') : trimmed;
    });
  return cleaned.join(separator);
}
