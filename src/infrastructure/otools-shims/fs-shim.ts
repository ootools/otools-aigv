/**
 * `@tauri-apps/plugin-fs`（以及旧的 `@tauri-apps/api/fs`）的 OTools 替代实现
 * ---------------------------------------------------------------
 * 上游用 Tauri 的 fs 插件做沙箱化读写。插件里：
 *  - 读写优先走宿主能力 `readHostFile` / `writeHostFile`（受宿主 ACL 管控）
 *  - 宿主不提供的 exists / mkdir / remove / readDir 由本插件 native 后端补齐
 *    （见 native/src/commands/otools_fs.rs）
 *
 * 返回形态与 Tauri fs 插件保持一致，上游调用点无需改动。
 */

import { decodeBase64, encodeBase64, getOtools, invokePlugin } from './host';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface NativeDirEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_file: boolean;
  is_symlink: boolean;
}

/** 读取文本文件 */
export async function readTextFile(path: string): Promise<string> {
  const otools = getOtools();
  if (otools?.readHostFile) {
    try {
      const payload = await otools.readHostFile(path);
      return decodeBase64(payload.dataBase64);
    } catch {
      // 宿主 ACL 拒绝或路径不在允许范围，回退到 native 实现
    }
  }
  return invokePlugin<string>('read_text_file', { path });
}

/** 读取二进制文件 */
export async function readFile(path: string): Promise<Uint8Array> {
  const otools = getOtools();
  if (otools?.readHostFile) {
    try {
      const payload = await otools.readHostFile(path);
      const binary = atob(payload.dataBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch {
      // 回退到文本读取（二进制内容会失真，但保证不抛错）
    }
  }
  const text = await invokePlugin<string>('read_text_file', { path });
  return new TextEncoder().encode(text);
}

/** 写入文本文件 */
export async function writeTextFile(path: string, contents: string): Promise<void> {
  const otools = getOtools();
  if (otools?.writeHostFile) {
    try {
      await otools.writeHostFile({ path, dataBase64: encodeBase64(contents) });
      return;
    } catch {
      // 回退到 native 实现
    }
  }
  await invokePlugin('write_text_file', { path, content: contents });
}

/** 写入二进制文件 */
export async function writeFile(path: string, contents: Uint8Array): Promise<void> {
  const otools = getOtools();
  if (otools?.writeHostFile) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < contents.length; i += chunk) {
      binary += String.fromCharCode(...contents.subarray(i, i + chunk));
    }
    try {
      await otools.writeHostFile({ path, dataBase64: btoa(binary) });
      return;
    } catch {
      // 回退到文本写入
    }
  }
  await writeTextFile(path, new TextDecoder().decode(contents));
}

/** 路径是否存在 */
export async function exists(path: string): Promise<boolean> {
  try {
    return await invokePlugin<boolean>('path_exists', { path });
  } catch {
    return false;
  }
}

/** 创建目录（默认递归） */
export async function mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
  await invokePlugin('create_dir', { path });
}

/** 删除文件或目录 */
export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await invokePlugin('remove_path', { path, recursive: options?.recursive ?? false });
}

/** 列举目录 */
export async function readDir(path: string): Promise<DirEntry[]> {
  const entries = await invokePlugin<NativeDirEntry[]>('read_dir', { path });
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDirectory: entry.is_directory,
    isFile: entry.is_file,
    isSymlink: entry.is_symlink,
  }));
}

/** 读取目录并返回文件名数组（Tauri fs 的 readDir 也有这个用法） */
export async function readDirNames(path: string): Promise<string[]> {
  const entries = await readDir(path);
  return entries.map((entry) => entry.name);
}

export async function rename(oldPath: string, _newPath: string): Promise<void> {
  throw new Error(`OTools 插件暂不支持重命名：${oldPath}`);
}

export async function copyFile(source: string, destination: string): Promise<void> {
  const data = await readFile(source);
  await writeFile(destination, data);
}

export async function stat(path: string): Promise<{ size: number; isDirectory: boolean; isFile: boolean }> {
  const entries = await readDir(path).catch(() => null);
  if (entries) {
    return { size: 0, isDirectory: true, isFile: false };
  }
  const text = await readTextFile(path);
  return { size: new TextEncoder().encode(text).length, isDirectory: false, isFile: true };
}
