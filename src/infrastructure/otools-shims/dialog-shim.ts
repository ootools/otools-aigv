/**
 * 旧路径 `@tauri-apps/api/dialog` 的 OTools 替代实现
 * ---------------------------------------------------------------
 * Tauri v2 已把对话框移到 `@tauri-apps/plugin-dialog`（由 OTools SDK 的 shim 接管），
 * 但上游仍有引用旧路径的地方。这里用宿主 `window.otools.dialog` 提供同一组 API。
 */

import { getOtools } from './host';

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
  multiple?: boolean;
  directory?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

/** 打开文件/目录选择对话框 */
export async function open(options: OpenDialogOptions = {}): Promise<string | string[] | null> {
  const dialog = getOtools()?.dialog;
  if (dialog?.open) {
    return dialog.open({
      title: options.title ?? '选择',
      defaultPath: options.defaultPath,
      filters: options.filters,
      multiple: options.multiple ?? false,
      directory: options.directory ?? false,
    });
  }
  return null;
}

/** 保存文件对话框 */
export async function save(options: SaveDialogOptions = {}): Promise<string | null> {
  const dialog = getOtools()?.dialog;
  if (dialog?.save) {
    return dialog.save({
      title: options.title ?? '保存',
      defaultPath: options.defaultPath,
      filters: options.filters,
    });
  }
  return null;
}

/** 消息框 */
export async function message(
  text: string,
  options?: { title?: string; kind?: 'info' | 'warning' | 'error' },
): Promise<void> {
  const dialog = getOtools()?.dialog;
  if (dialog?.message) {
    await dialog.message(text, { title: options?.title, kind: options?.kind ?? 'info' });
    return;
  }
  if (typeof window !== 'undefined') window.alert(text);
}

/** 确认框（确定/取消） */
export async function confirm(text: string, options?: { title?: string }): Promise<boolean> {
  const dialog = getOtools()?.dialog;
  if (dialog?.confirm) {
    return dialog.confirm(text, { title: options?.title });
  }
  if (typeof window !== 'undefined') return window.confirm(text);
  return false;
}

/** 询问框（是/否），与 confirm 语义一致 */
export async function ask(text: string, options?: { title?: string }): Promise<boolean> {
  return confirm(text, options);
}
