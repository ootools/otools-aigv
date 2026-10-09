/**
 * AI 请求配置构造（原 ai-call-dispatcher）
 *
 * 新架构下「按 provider 路由到 strategy」的旧分发（`dispatchAIRequest` + `providerRegistry`）
 * 已移除——文本调用统一走 `@/core/ai/text-client` 的 `callTextModel`（见 `ai-service.callAPI`）。
 * 本文件只保留 `buildRequestConfig`：把 prompt 组装成标准 messages / temperature / max_tokens。
 */

import type { AIRequestConfig, AIModel, AIModelSettings } from './ai-service-types';

/** 默认 system prompt（与原实现逐字一致） */
const DEFAULT_SYSTEM_PROMPT = '你是一个专业的视频内容创作助手，擅长生成高质量的解说脚本。';

/** 默认 temperature */
const DEFAULT_TEMPERATURE = 0.7;
/** 默认 max_tokens */
const DEFAULT_MAX_TOKENS = 2000;

/**
 * 从 AIModel + AIModelSettings 构造标准的 AIRequestConfig。
 */
export function buildRequestConfig(
  model: AIModel,
  settings: AIModelSettings,
  prompt: string
): AIRequestConfig {
  return {
    model: settings.model ?? model.id,
    messages: [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: settings.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: settings.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}
