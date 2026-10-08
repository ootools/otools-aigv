/**
 * 视频链路统一客户端（P2c）
 * 解析 video 能力/槽位 → 按 provider.protocol 分派：
 * - openai-videos：对齐 new-api 契约的描述符
 * - vendor-task：查 BUILTIN_VIDEO_DESCRIPTORS[provider.vendorDescriptorId] 跑通用引擎
 */

import { resolveModelRef, type ResolveOptions } from '../config/model-settings/resolver';
import { ModelResolutionError } from '../config/model-settings/resolver';
import type { ModelSettings } from '../config/model-settings/types';

import { callOpenAIVideos } from './protocols/openai-videos';
import { runVendorTask, type VendorTaskRequest, type VendorTaskResult } from './protocols/vendor-task';
import { getBuiltinVideoDescriptor } from './protocols/vendor-task-descriptors';

export interface VideoCallOptions {
  prompt: string;
  model?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  fps?: number;
  seed?: number;
  firstFrameImage?: string;
  lastFrameImage?: string;
  negativePrompt?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  modelIdOverride?: string;
  /** 注入 poll 间隔（测试用，避免真实等待） */
  pollIntervalMs?: number;
}

export interface VideoResult {
  status: 'processing' | 'succeeded' | 'failed';
  url?: string;
  raw?: unknown;
}

export async function callVideoModel(
  modelSettings: ModelSettings,
  options: VideoCallOptions & ResolveOptions
): Promise<VideoResult> {
  const { provider, modelId } = resolveModelRef(modelSettings, 'video', options);
  const model = options.modelIdOverride ?? modelId ?? provider.defaultModel ?? '';
  const credentials: Record<string, string> = { apiKey: provider.apiKey };
  if (provider.accessKey) credentials.accessKey = provider.accessKey;
  if (provider.secretKey) credentials.secretKey = provider.secretKey;

  const req: VendorTaskRequest = {
    baseUrl: provider.baseUrl,
    credentials,
    prompt: options.prompt,
    model,
    durationSec: options.durationSec,
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    fps: options.fps,
    seed: options.seed,
    firstFrameImage: options.firstFrameImage,
    lastFrameImage: options.lastFrameImage,
    negativePrompt: options.negativePrompt,
  };

  const opts = {
    signal: options.signal,
    fetchImpl: options.fetchImpl,
    sleep: options.pollIntervalMs != null ? () => Promise.resolve() : undefined,
  };

  let result: VendorTaskResult;
  if (provider.protocol === 'openai-videos') {
    result = await callOpenAIVideos(req, opts);
  } else if (provider.protocol === 'vendor-task') {
    const descriptor = provider.vendorDescriptorId ? getBuiltinVideoDescriptor(provider.vendorDescriptorId) : undefined;
    if (!descriptor) {
      throw new ModelResolutionError(
        `视频提供方「${provider.label}」引用了未知的描述符 "${provider.vendorDescriptorId ?? ''}"`,
        'video'
      );
    }
    result = await runVendorTask(descriptor, req, opts);
  } else {
    throw new ModelResolutionError(
      `视频提供方「${provider.label}」使用了未实现的协议 "${provider.protocol}"`,
      'video'
    );
  }

  return { status: result.status, url: result.url, raw: result.raw };
}
