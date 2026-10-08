/**
 * 文本链路统一客户端（P2a 落地）
 * ===================================
 * 把原来 openai / zhipu / alibaba 等多个「OpenAI 兼容」strategy 压成一个：
 * 给定 ModelSettings + 能力（槽位），解析出 ProviderInstance，再交给
 * openai-chat 适配器发请求。非 OpenAI 兼容的（anthropic / google / baidu）
 * 暂不在本文件处理，仍走旧 registry 回退。
 *
 * 这样「13 家服务商各写一份 strategy」收敛为「按协议写适配器」，新增一家
 * OpenAI 兼容端点（官方 / 中转站 / ai-switch 网关）只需在设置里建一个实例。
 */

import { resolveModelRef, type ResolveOptions } from '../config/model-settings/resolver';
import type { Capability, ModelSettings } from '../config/model-settings/types';

import { callOpenAIChat, type OpenAIChatMessage, type OpenAIChatResult } from './protocols/openai-chat';

import type { AIResponse } from '@/common/types/ai-core';

/** 把 openai-chat 适配器的返回映射成旧的 AIResponse（usage 字段名不同） */
export function toAIResponse(result: OpenAIChatResult): AIResponse {
  return {
    content: result.content,
    model: result.model,
    usage: result.usage
      ? {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        }
      : undefined,
  };
}

export interface TextCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
  /** 注入 fetch（测试用；默认全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 显式覆盖模型（优先级高于解析出的 modelId） */
  modelIdOverride?: string;
}

/**
 * 文本链路统一入口：
 * 1. 按 §3.5 解析能力/槽位 → { provider, modelId }
 * 2. 用 provider 的 baseUrl / apiKey / authStyle / extraHeaders / queryParams 调 openai-chat
 * 3. 映射成 AIResponse
 *
 * 解析失败会抛出具名 ModelResolutionError（缺哪个槽位/能力说清楚），不会落到「请先配置 API Key」。
 */
export async function callTextModel(
  modelSettings: ModelSettings,
  capability: Capability,
  messages: OpenAIChatMessage[],
  options: TextCallOptions & ResolveOptions = {}
): Promise<AIResponse> {
  const { provider, modelId } = resolveModelRef(modelSettings, capability, options);
  const model = options.modelIdOverride ?? modelId;

  const result = await callOpenAIChat({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model,
    messages,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
    stop: options.stop,
    authStyle: provider.authStyle,
    extraHeaders: provider.extraHeaders,
    queryParams: provider.queryParams,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });

  return toAIResponse(result);
}
