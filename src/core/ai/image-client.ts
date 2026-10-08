/**
 * 图像链路统一客户端（P2b）
 * 解析 image 能力/槽位 → 读 ProviderInstance.defaults 填充尺寸/反向提示词 → 调 openai-images 适配器。
 */

import { resolveModelRef, type ResolveOptions } from '../config/model-settings/resolver';
import type { ModelSettings } from '../config/model-settings/types';

import { callOpenAIImages, type OpenAIImagesResult } from './protocols/openai-images';

export interface ImageCallOptions {
  prompt: string;
  n?: number;
  size?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  responseFormat?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  modelIdOverride?: string;
}

export async function callImageModel(
  modelSettings: ModelSettings,
  options: ImageCallOptions & ResolveOptions
): Promise<OpenAIImagesResult> {
  const { provider, modelId } = resolveModelRef(modelSettings, 'image', options);
  const model = options.modelIdOverride ?? modelId;
  const d = provider.defaults ?? {};

  return callOpenAIImages({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    prompt: options.prompt,
    n: options.n ?? d.n,
    size: options.size ?? d.size,
    width: options.width,
    height: options.height,
    negativePrompt: options.negativePrompt ?? d.negativePrompt,
    responseFormat: options.responseFormat,
    authStyle: provider.authStyle,
    extraHeaders: provider.extraHeaders,
    queryParams: provider.queryParams,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
}
