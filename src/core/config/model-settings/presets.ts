/**
 * 提供方模板（P9）
 * ===============
 * 设计 §4.1：「新建时有「从模板开始」（OpenAI / DeepSeek / 通义 / 中转站 / Ollama / 自定义）」。
 * 设计 §7.2：推荐「网关优先 + 直连兜底」——**AI Switch 网关排在模板第一位并标记 `isGateway`**。
 *
 * 模板只做「预填」：协议 / baseUrl / 鉴权 / 是否网关 / 建议名称；用户可再改。
 */

import type { AuthStyle, Capability, ProtocolId, ProviderInstance } from './types';

export interface ProviderPreset {
  id: string;
  label: string;
  /** 建议的实例名称（用户已填名称时不覆盖） */
  suggestedLabel: string;
  /** 固定协议（非网关模板） */
  protocol?: ProtocolId;
  /** 按能力给协议（网关全覆盖：文本 / 图像 / 视频 / 语音各不同） */
  protocolByCapability?: Partial<Record<Capability, ProtocolId>>;
  baseUrl: string;
  authStyle: AuthStyle;
  /** 网关模板：置 `isGateway`，解析与分配表优先 */
  isGateway?: boolean;
  note?: string;
}

/** 网关对各能力使用的协议（OpenAI 事实标准族） */
const GATEWAY_PROTOCOLS: Record<Capability, ProtocolId> = {
  text: 'openai-chat',
  image: 'openai-images',
  video: 'openai-videos',
  tts: 'openai-speech',
  stt: 'openai-chat',
  embedding: 'openai-chat',
};

/** 模板列表（**网关优先**：AI Switch 网关排第一） */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'ai-switch',
    label: 'AI Switch 网关（推荐）',
    suggestedLabel: 'AI Switch 网关',
    protocolByCapability: GATEWAY_PROTOCOLS,
    baseUrl: '',
    authStyle: 'bearer',
    isGateway: true,
    note: '一个实例覆盖文本 / 图像 / 视频 / 语音；协议适配、账号池、计费都在网关侧。填网关地址与 token。',
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    suggestedLabel: 'OpenAI 官方',
    protocolByCapability: GATEWAY_PROTOCOLS,
    baseUrl: 'https://api.openai.com/v1',
    authStyle: 'bearer',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    suggestedLabel: 'DeepSeek 官方',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    authStyle: 'bearer',
  },
  {
    id: 'dashscope',
    label: '通义千问（兼容模式）',
    suggestedLabel: '通义千问',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    authStyle: 'bearer',
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    suggestedLabel: 'Ollama 本地',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    authStyle: 'none',
  },
  {
    id: 'custom',
    label: '自定义',
    suggestedLabel: '',
    baseUrl: '',
    authStyle: 'bearer',
  },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/**
 * 把模板套到实例上（预填协议 / baseUrl / 鉴权 / 网关标记 / 建议名称）。
 * 只覆盖模板关心的字段，能力 / id / 模型配置等保持不变；已填名称不被覆盖。
 */
export function applyProviderPreset(
  provider: ProviderInstance,
  preset: ProviderPreset
): ProviderInstance {
  const protocol =
    preset.protocolByCapability?.[provider.capability] ?? preset.protocol ?? provider.protocol;
  return {
    ...provider,
    label: provider.label.trim() ? provider.label : preset.suggestedLabel,
    protocol,
    baseUrl: preset.baseUrl,
    authStyle: preset.authStyle,
    isGateway: preset.isGateway ?? false,
  };
}
