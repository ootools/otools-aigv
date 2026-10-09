/**
 * AI Provider — barrel re-exports
 *
 * 新架构下「一家服务商一份 strategy」的旧实现（providerRegistry + openai / anthropic / google /
 * baidu / alibaba / zhipu strategy）已移除：文本走 `@/core/ai/text-client`（openai-chat 单协议），
 * 图像 / 视频 / 语音走各自的 client。这里仅保留 mockStrategy（测试 / 开发用）与相关类型。
 */

export { mockStrategy } from './mock-strategy';
export type { AIProviderStrategy } from './base';
