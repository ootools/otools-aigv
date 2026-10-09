/**
 * 唇同步服务 - 音画对齐（新架构）
 * =================================================================
 * 支持：Sync.so API、SadTalker（本地 / 云端）。
 *
 * 新架构：**不再从 secureStorage 取 key**——凭据从 `model-settings` 的
 * `video.lipsync` 槽位解析（`ProviderInstance.baseUrl / apiKey / extraHeaders`）。
 * 协议本身仍是各家私有的（sync.so 的 `input[]`、sadtalker 的 `source_image/driven_audio`），
 * 故这里保留各自请求体，只把「配置来源」收敛到新架构。
 */

import axios from 'axios';

import { loadModelSettings } from '@/core/config/model-settings';
import { resolveModelRef } from '@/core/config/model-settings/resolver';

// ========== 类型定义 ==========

export type LipSyncModel = 'lipsync-2' | 'wav2lip';

export interface LipSyncOptions {
  /** 同步模式 */
  syncMode?: 'cut_off' | 'loop' | 'smooth';
  /** 模型版本 */
  model?: LipSyncModel;
  /** 清晰度 */
  clarity?: 'fast' | 'balanced' | 'hd';
  /** 唇形强度 */
  lipStrength?: number;
}

export interface LipSyncResult {
  /** 结果视频 URL */
  url: string;
  /** 封面图 */
  coverUrl?: string;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 时长 */
  duration: number;
  /** 任务 ID */
  taskId?: string;
  /** 状态 */
  status: 'processing' | 'completed' | 'failed';
  /** 错误信息 */
  error?: string;
}

/**
 * 构造 LipSyncResult 对象。
 * 内部 helper — 消除 createLipSync 与 getLipSyncStatus 内 13L result 模板重复。
 */
interface LipSyncRawResponse {
  url?: string;
  cover_url?: string;
  width?: number;
  height?: number;
  duration?: number;
  status?: string;
}

function toLipSyncResult(
  data: LipSyncRawResponse,
  overrides: { taskId?: string; error?: string } = {}
): LipSyncResult {
  return {
    url: data?.url ?? '',
    coverUrl: data?.cover_url,
    width: data?.width ?? 1920,
    height: data?.height ?? 1080,
    duration: data?.duration ?? 0,
    status: (data?.status as LipSyncResult['status']) ?? 'processing',
    ...overrides,
  };
}

export interface TalkingFaceOptions {
  /** 驱动方式 */
  driver?: 'audio' | 'video';
  /** 表情强度 */
  expressionStrength?: number;
  /** 头部姿态 */
  headPose?: boolean;
}

export interface TalkingFaceResult {
  /** 结果视频 URL */
  url: string;
  /** 封面图 */
  coverUrl?: string;
  /** 任务 ID */
  taskId?: string;
  /** 状态 */
  status: 'processing' | 'completed' | 'failed';
}

/**
 * 从新架构解析唇同步端点（槽位 `video.lipsync`）。
 * `defaultBaseUrl` 仅在提供方没填 baseUrl 时兜底；凭据走 `ProviderInstance.apiKey / extraHeaders`。
 * 未配置可用提供方 → `resolveModelRef` 抛具名 `ModelResolutionError`。
 */
async function resolveLipSyncEndpoint(
  defaultBaseUrl: string,
  path: string
): Promise<{ url: string; headers: Record<string, string> }> {
  const settings = await loadModelSettings();
  const { provider } = resolveModelRef(settings, 'video', { slot: 'video.lipsync' });

  const base = (provider.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders);

  return { url: `${base}${path}`, headers };
}

// ========== Sync.so API ==========

/**
 * 使用 Sync.so 进行唇同步
 */
export async function syncLipWithSyncSo(
  videoUrl: string,
  audioUrl: string,
  options: LipSyncOptions = {}
): Promise<LipSyncResult> {
  const { syncMode = 'cut_off', model = 'lipsync-2', clarity = 'balanced' } = options;

  const { url, headers } = await resolveLipSyncEndpoint('https://api.sync.so', '/v2/lipsync');

  const response = await axios({
    method: 'post',
    url,
    headers,
    data: {
      input: [
        { type: 'video', url: videoUrl },
        { type: 'audio', url: audioUrl },
      ],
      model,
      options: {
        sync_mode: syncMode,
        clarity,
        lip_strength: options.lipStrength ?? 1.0,
      },
    },
  });

  const data = response.data ?? response;

  return toLipSyncResult(data, { taskId: data?.task_id });
}

// ========== SadTalker (本地/云端) ==========

/**
 * 使用 SadTalker 生成说话人脸
 * 需要本地部署 SadTalker 服务或使用云端 API
 */
export async function generateTalkingFace(
  imageUrl: string,
  audioUrl: string,
  options: TalkingFaceOptions = {}
): Promise<TalkingFaceResult> {
  const { url, headers } = await resolveLipSyncEndpoint('https://api.sadtalker.io', '/v1/generate');

  const response = await axios({
    method: 'post',
    url,
    headers,
    data: {
      source_image: imageUrl,
      driven_audio: audioUrl,
      driver: options.driver ?? 'audio',
      expression_strength: options.expressionStrength || 1.0,
      head_pose: options.headPose !== false,
    },
  });

  const data = response.data ?? response;

  return {
    url: data?.url ?? '',
    coverUrl: data?.cover_url,
    taskId: data?.task_id,
    status: data?.status ?? 'processing',
  };
}

// ========== 统一 API ==========

/**
 * 唇同步 - 统一入口
 */
export async function syncLip(
  videoUrl: string,
  audioUrl: string,
  options: LipSyncOptions = {}
): Promise<LipSyncResult> {
  return syncLipWithSyncSo(videoUrl, audioUrl, options);
}

/**
 * 生成说话人脸 - 统一入口
 */
export async function generateTalkingHead(
  imageUrl: string,
  audioUrl: string,
  options: TalkingFaceOptions = {}
): Promise<TalkingFaceResult> {
  return generateTalkingFace(imageUrl, audioUrl, options);
}

/**
 * 查询唇同步状态
 */
export async function getLipSyncStatus(taskId: string): Promise<LipSyncResult> {
  const { url, headers } = await resolveLipSyncEndpoint(
    'https://api.sync.so',
    `/v2/lipsync/${taskId}`
  );

  const response = await axios({ method: 'get', url, headers });

  const data = response.data ?? response;

  return toLipSyncResult(data, { taskId, error: data?.error });
}

/**
 * 查询说话人脸状态
 */
export async function getTalkingFaceStatus(taskId: string): Promise<TalkingFaceResult> {
  const { url, headers } = await resolveLipSyncEndpoint(
    'https://api.sadtalker.io',
    `/v1/generate/${taskId}`
  );

  const response = await axios({ method: 'get', url, headers });

  const data = response.data ?? response;

  return {
    url: data?.url ?? '',
    coverUrl: data?.cover_url,
    taskId,
    status: data?.status ?? 'processing',
  };
}

// ========== 服务导出 ==========

export const lipSyncService = {
  syncLip,
  generateTalkingHead,
  getLipSyncStatus,
  getTalkingFaceStatus,
  // 底层方法
  syncWithSyncSo: syncLipWithSyncSo,
  generateWithSadTalker: generateTalkingFace,
};

export default lipSyncService;
