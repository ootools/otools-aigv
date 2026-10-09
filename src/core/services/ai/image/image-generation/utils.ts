/**
 * 共享工具函数（新架构下仅保留 getAPIKey）
 *
 * 旧图像 provider（Seedream / Kling / Vidu）已移除，随之删掉了
 * `mapCharacterReferences` / `parseSize` / `mapKlingSize` / `mapViduSize`。
 * `getAPIKey` 仍被 `lip-sync-service`（sync / sadtalker）使用，故保留。
 */

export type { ImageSize } from './types';

/**
 * 从 secureStorage 取 API Key（旧链路的凭据来源）。
 *
 * 注意：新的图像 / 视频 / 语音 / 文本链路统一走 `model-settings` 里的
 * `ProviderInstance.apiKey`；这里只服务于尚未迁移的 lip-sync（sync / sadtalker）。
 */
export async function getAPIKey(service: string): Promise<string> {
  const { secureStorage } = await import('../../../project/secure-storage-service');
  const value = await secureStorage.getSecureConfig(`api_key_${service}`);

  if (typeof value === 'string' && value) {
    return value;
  }

  // Fallback: parse a bundled api_keys JSON if present
  const bundled = await secureStorage.getSecureConfig('api_keys');
  if (typeof bundled === 'string') {
    try {
      const keyObj = JSON.parse(bundled) as Record<string, string>;
      return keyObj[service] ?? keyObj[`${service}_api_key`] ?? '';
    } catch {
      return '';
    }
  }

  return '';
}
