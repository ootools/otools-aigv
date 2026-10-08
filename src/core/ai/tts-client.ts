/**
 * 语音（TTS）链路统一客户端（P2b）
 * 解析 tts 能力/槽位 → 读 ProviderInstance.defaults 填充 voice/speed/format → 调 openai-speech 适配器。
 */

import { resolveModelRef, type ResolveOptions } from '../config/model-settings/resolver';
import type { ModelSettings } from '../config/model-settings/types';

import { callOpenAISpeech, type OpenAISpeechResult } from './protocols/openai-speech';

export interface TtsCallOptions {
  input: string;
  voice?: string;
  speed?: number;
  responseFormat?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  modelIdOverride?: string;
}

export async function callTtsModel(
  modelSettings: ModelSettings,
  options: TtsCallOptions & ResolveOptions
): Promise<OpenAISpeechResult> {
  const { provider, modelId } = resolveModelRef(modelSettings, 'tts', options);
  const model = options.modelIdOverride ?? modelId;
  const d = provider.defaults ?? {};

  return callOpenAISpeech({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    input: options.input,
    voice: options.voice ?? d.voice ?? '',
    speed: options.speed ?? d.speed,
    responseFormat: options.responseFormat ?? d.format,
    authStyle: provider.authStyle,
    extraHeaders: provider.extraHeaders,
    queryParams: provider.queryParams,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
}
