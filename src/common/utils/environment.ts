/**
 * 环境检测工具
 * shared 层自建，零外部依赖
 */

/**
 * 是否运行在 OTools 宿主中。
 *
 * 【OTools 插件适配】上游只认 Tauri 桌面端，插件形态下宿主注入的是
 * `window.otools`（native 插件桥 + 宿主文件/对话框/路径能力），
 * 因此这里把它与 `__TAURI__` 同等视为「具备桌面能力」。
 */
export function isOtoolsHost(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as unknown as { otools?: unknown }).otools);
}

/** 检测是否在桌面环境运行（Tauri 或 OTools 宿主） */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI__' in window || isOtoolsHost();
}
