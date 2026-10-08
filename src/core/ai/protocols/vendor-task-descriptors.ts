/**
 * 内置视频服务商描述符（P2c）
 * ===================================
 * 覆盖可灵官方 / MiniMax / 智谱 三家。每家一张 JSON（逻辑字段名固定，上游名由映射指定），
 * 引擎只认逻辑名。新增一家 = 加一张，不改引擎代码。
 *
 * 注意：字段映射依据设计文档 §3.2 / §七 记录的家家差异整理，力求贴合真实 API；
 * 但上游可能调整，P4 必须配「试跑 + 回显上游原始响应」的调试入口来校验/修正。
 */

import type { VendorTaskDescriptor } from './vendor-task';

/** 可灵官方：ak/sk 签 JWT-HS256；create /v1/videos/text2video；轮询同路径 + task_id */
const KLING_OFFICIAL: VendorTaskDescriptor = {
  id: 'kling-official',
  label: '可灵官方（JWT）',
  auth: { style: 'jwt-hs256', accessKeyField: 'accessKey', secretKeyField: 'secretKey' },
  create: {
    path: '/v1/videos/text2video',
    method: 'POST',
    taskIdPath: 'data.task_id',
    bodyFields: {
      prompt: 'prompt',
      negativePrompt: 'negative_prompt',
      model: 'model',
      durationSec: 'duration',
      aspectRatio: 'aspect_ratio',
      firstFrameImage: 'image',
    },
    extraBody: { mode: 'std' },
  },
  poll: {
    path: '/v1/videos/text2video/{taskId}',
    method: 'GET',
    statusPath: 'data.task_status',
    statusMap: {
      submitted: 'processing',
      processing: 'processing',
      succeed: 'succeeded',
      failed: 'failed',
    },
    errorPath: 'data.task_status_msg',
    intervalMs: 5000,
    maxAttempts: 120,
  },
  resultPath: 'data.works[0].resource_url',
};

/** MiniMax：Bearer；create /v1/video_generation；轮询走 query string；两步取结果（file_id → 下载地址） */
const MINIMAX: VendorTaskDescriptor = {
  id: 'minimax',
  label: 'MiniMax',
  auth: { style: 'bearer' },
  create: {
    path: '/v1/video_generation',
    method: 'POST',
    taskIdPath: 'task_id',
    bodyFields: {
      prompt: 'prompt',
      model: 'model',
      durationSec: 'duration',
      firstFrameImage: 'first_frame_image',
    },
  },
  poll: {
    path: '/v1/query/video_generation',
    method: 'GET',
    queryFields: { taskId: 'task_id' },
    statusPath: 'status',
    statusMap: {
      Queued: 'processing',
      Preparing: 'processing',
      Processing: 'processing',
      Success: 'succeeded',
      Fail: 'failed',
    },
    errorPath: 'message',
    intervalMs: 5000,
    maxAttempts: 120,
  },
  fetchResult: {
    path: '/v1/file/{file_id}',
    method: 'GET',
    fromPaths: { file_id: 'file_id' },
  },
  resultPath: 'file.download_url',
};

/** 智谱 CogVideo：Bearer；create /v1/video_generation；轮询 /v1/video_generation/{id} */
const ZHIPU: VendorTaskDescriptor = {
  id: 'zhipu',
  label: '智谱 CogVideo',
  auth: { style: 'bearer' },
  create: {
    path: '/v1/video_generation',
    method: 'POST',
    taskIdPath: 'id',
    bodyFields: {
      prompt: 'prompt',
      model: 'model',
      durationSec: 'duration',
      aspectRatio: 'aspect_ratio',
      firstFrameImage: 'image_url',
    },
  },
  poll: {
    path: '/v1/video_generation/{taskId}',
    method: 'GET',
    statusPath: 'status',
    statusMap: {
      PROCESSING: 'processing',
      SUCCEEDED: 'succeeded',
      FAILED: 'failed',
    },
    errorPath: 'error.message',
    intervalMs: 5000,
    maxAttempts: 120,
  },
  resultPath: 'video_url',
};

/** 内置描述符注册表 */
export const BUILTIN_VIDEO_DESCRIPTORS: Record<string, VendorTaskDescriptor> = {
  'kling-official': KLING_OFFICIAL,
  minimax: MINIMAX,
  zhipu: ZHIPU,
};

export function getBuiltinVideoDescriptor(id: string): VendorTaskDescriptor | undefined {
  return BUILTIN_VIDEO_DESCRIPTORS[id];
}
