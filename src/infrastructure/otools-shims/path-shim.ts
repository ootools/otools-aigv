/**
 * `@tauri-apps/api/path` 的 OTools 替代实现
 * ---------------------------------------------------------------
 * 上游 Novella 用 Tauri 的路径 API 取应用目录与系统目录。插件里没有 Tauri
 * runtime，改为：
 *  - 系统目录取自宿主注入的 `window.otools.paths`
 *  - 应用目录取自本插件 native 后端的 `get_app_data_path`（`~/.otools/local/aigv`）
 *
 * 保持与 Tauri 一致：函数都是 async，返回绝对路径字符串。
 */

import { getOtools, hostPath, invokePlugin, joinHostPath } from './host';

/** Tauri 里 `sep()` 是同步的 */
export function sep(): string {
  return getOtools()?.platform === 'windows' ? '\\' : '/';
}

/** 缓存 appDataDir，避免每次调用都跨进程 */
let appDataDirCache: string | null = null;

/** 插件数据目录（`~/.otools/local/aigv`） */
export async function appDataDir(): Promise<string> {
  if (appDataDirCache) return appDataDirCache;

  try {
    const resolved = await invokePlugin<string>('get_app_data_path');
    if (resolved) {
      appDataDirCache = resolved;
      return resolved;
    }
  } catch {
    // 宿主不可用时回退到 env 提供的 appData
  }

  const fallback = hostPath('appData');
  const resolved = fallback ? joinHostPath(fallback, 'aigv') : '';
  appDataDirCache = resolved;
  return resolved;
}

/** 插件配置目录（`~/.otools/local/aigv/config`） */
export async function appConfigDir(): Promise<string> {
  return joinHostPath(await appDataDir(), 'config');
}

/** 本地数据目录（Tauri 的 appLocalDataDir 语义，这里与 appDataDir 同源） */
export async function appLocalDataDir(): Promise<string> {
  return appDataDir();
}

export async function homeDir(): Promise<string> {
  return hostPath('home') ?? '';
}

export async function desktopDir(): Promise<string> {
  return hostPath('desktop') ?? '';
}

export async function documentDir(): Promise<string> {
  return hostPath('documents') ?? '';
}

export async function downloadDir(): Promise<string> {
  return hostPath('downloads') ?? '';
}

export async function videoDir(): Promise<string> {
  return hostPath('videos') ?? '';
}

export async function audioDir(): Promise<string> {
  return hostPath('music') ?? '';
}

export async function pictureDir(): Promise<string> {
  return hostPath('pictures') ?? '';
}

export async function tempDir(): Promise<string> {
  return hostPath('temp') ?? '';
}

/** 缓存目录（插件数据目录下的 cache） */
export async function cacheDir(): Promise<string> {
  return joinHostPath(await appDataDir(), 'cache');
}

/** 数据目录（与 Tauri 的 dataDir 语义对齐到插件数据目录） */
export async function dataDir(): Promise<string> {
  return appDataDir();
}

/** 资源目录：插件包内的 `dist` 目录，由宿主以相对路径加载 */
export async function resourceDir(): Promise<string> {
  return '';
}

export async function join(...paths: string[]): Promise<string> {
  return joinHostPath(...paths);
}

export async function basename(filePath: string, ext?: string): Promise<string> {
  const name = filePath.split(/[/\\]/).pop() ?? filePath;
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length);
  return name;
}

export async function dirname(filePath: string): Promise<string> {
  const parts = filePath.split(/[/\\]/);
  parts.pop();
  return parts.join(sep());
}

export async function extname(filePath: string): Promise<string> {
  const name = filePath.split(/[/\\]/).pop() ?? '';
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index) : '';
}

/** 归一化路径分隔符 */
export async function normalize(filePath: string): Promise<string> {
  const separator = sep();
  const normalized = filePath.replace(/[/\\]+/g, separator);
  return normalized.length > 1 ? normalized.replace(new RegExp(`\\${separator}+$`), '') : normalized;
}

/** 解析为绝对路径（插件里没有 cwd 概念，直接归一化返回） */
export async function resolve(...paths: string[]): Promise<string> {
  return normalize(joinHostPath(...paths));
}
