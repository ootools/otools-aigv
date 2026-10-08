/**
 * openai-videos 协议适配器（P2c）
 * ===================================
 * 视频里最有标准化潜力的契约：对齐 new-api 的 `/v1/video/generations` +
 * `GET /v1/video/generations/{task_id}`，状态统一 processing/succeeded/failed。
 * 直接复用 vendor-task 引擎（它就是一份「标准化」描述符）。
 */

import { runVendorTask, type VendorTaskDescriptor, type VendorTaskRequest, type VendorTaskResult, type VendorTaskOptions } from './vendor-task';

export const OPENAI_VIDEOS_DESCRIPTOR: VendorTaskDescriptor = {
  id: 'openai-videos',
  label: 'OpenAI Videos (new-api / Sora)',
  auth: { style: 'bearer' },
  create: {
    path: '/v1/video/generations',
    method: 'POST',
    taskIdPath: 'task_id',
    // new-api 字段：model/prompt/duration/fps/height/width/image/metadata...
    bodyFields: { durationSec: 'duration', aspectRatio: 'aspect_ratio', resolution: 'resolution', fps: 'fps' },
  },
  poll: {
    path: '/v1/video/generations/{taskId}',
    method: 'GET',
    statusPath: 'status',
    statusMap: {
      processing: 'processing',
      pending: 'processing',
      queued: 'processing',
      succeeded: 'succeeded',
      failed: 'failed',
    },
    errorPath: 'error',
  },
  resultPath: 'url',
};

export function callOpenAIVideos(req: VendorTaskRequest, options?: VendorTaskOptions): Promise<VendorTaskResult> {
  return runVendorTask(OPENAI_VIDEOS_DESCRIPTOR, req, options);
}
