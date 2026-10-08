/**
 * 旧路径 `@tauri-apps/api/notification` 的 OTools 替代实现
 * ---------------------------------------------------------------
 * Tauri v2 已把通知移到 `@tauri-apps/plugin-notification`（由 OTools SDK 的 shim
 * 接管，底层用浏览器 Notification API）。这里为旧路径提供同样的行为，
 * 保证上游两种 import 都能工作。
 */

export async function isPermissionGranted(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return false;
  }
  return Notification.permission === 'granted';
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'denied';
  }
  return Notification.requestPermission();
}

export async function sendNotification(options: { title: string; body?: string }): Promise<void> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return;
  }
  if (Notification.permission === 'granted') {
    new Notification(options.title, { body: options.body });
  }
}
