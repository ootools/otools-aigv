/**
 * 图像 / 视频生成服务 - 统一入口（新架构）
 * =================================================================
 * 只走新架构：解析 image / video 能力（槽位）→ `@/core/ai/image-client` / `video-client`。
 *
 * 旧「一家服务商一份 provider 实现 + 从 secureStorage 取 Key」的链路
 * （Seedream / Kling / Vidu / Seedance 各自 adapter）已**移除**；
 * 未配置可用提供方时，由 `resolveModelRef` 抛出具名的 `ModelResolutionError`
 * （指名道姓说缺哪个能力 / 槽位，而不是老的「请先配置 API Key」）。
 */

// Re-export types（对外类型保持不变）
export type {
  ImageModel,
  ImageSize,
  ImageGenerationOptions,
  ImageGenerationResult,
  VideoGenerationOptions,
  VideoGenerationResult,
} from './image-generation/types';

import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageSize,
  VideoGenerationOptions,
  VideoGenerationResult,
} from './image-generation/types';

import { callImageModel } from '@/core/ai/image-client';
import { callVideoModel } from '@/core/ai/video-client';
import { loadModelSettings } from '@/core/config/model-settings';


/** 尺寸字符串（'1K'/'2K'/'4K'/'WxH'）→ 像素宽高；未知 → 0 */
function sizeToDimensions(size?: ImageSize): { width: number; height: number } {
  if (!size) return { width: 0, height: 0 };
  const raw: string = String(size);
  if (raw.includes('x')) {
    const [w, h] = raw.split('x').map((n) => parseInt(n, 10));
    return { width: Number.isFinite(w) ? w : 0, height: Number.isFinite(h) ? h : 0 };
  }
  const side = { '1K': 1024, '2K': 2048, '4K': 4096 }[raw] ?? 0;
  return { width: side, height: side };
}

/** 图像生成 - 统一入口（走新架构 openai-images 适配器） */
export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult> {
  const modelSettings = await loadModelSettings();
  const res = await callImageModel(modelSettings, {
    prompt,
    n: options.numImages,
    size: options.size,
    negativePrompt: options.negativePrompt,
    signal: options.signal,
  });
  const img = res.images[0];
  const { width, height } = sizeToDimensions(options.size);
  return {
    url: img?.url ?? '',
    base64: img?.b64Json,
    width,
    height,
    model: options.model ?? '',
  };
}

/** 视频生成 - 统一入口（走新架构 openai-videos / vendor-task 描述符，内部完成轮询） */
export async function generateVideo(
  prompt: string,
  options: VideoGenerationOptions = {}
): Promise<VideoGenerationResult> {
  const modelSettings = await loadModelSettings();
  const res = await callVideoModel(modelSettings, {
    prompt,
    durationSec: options.duration,
    fps: options.fps,
    aspectRatio: options.aspectRatio,
    firstFrameImage: options.referenceImage,
    negativePrompt: options.negativePrompt,
    signal: options.signal,
  });
  return {
    url: res.url ?? '',
    duration: options.duration ?? 5,
    width: 0,
    height: 0,
    model: options.model ?? '',
    status:
      res.status === 'succeeded' ? 'completed' : res.status === 'failed' ? 'failed' : 'processing',
  };
}

export const imageGenerationService = {
  generateImage,
  generateVideo,
};

export default imageGenerationService;
