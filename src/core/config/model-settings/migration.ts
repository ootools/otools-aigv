/**
 * 老配置迁移（P1）
 *
 * 吃掉 Novella 遗留的四套 localStorage 命名，产出新的 ModelSettings，让老用户不必重填 key：
 *   - ai_model_settings_${p}   （JSON，可能含 apiKey / baseUrl）
 *   - api_${p}_key            （裸串）
 *   - novella_api_key_${p}    （裸串）
 *   - ${p}_api_key           （裸串）
 *   - secure_api_${p}_key    （secure-storage fallback 落地的裸串前缀变体）
 *
 * 设计取舍（§3.7）：遗留系统没有「能力维度」，只有「服务商」。为降低迁移风险，
 * P1 只生成「文本」能力的实例（历史主路径），并保留 apiKey 与默认 baseUrl；
 * 图像 / 视频 / 语音 在新 UI 里通过「凭据继承」（§3.8.3）一键派生，无需迁移期去猜各能力的端点。
 */

import { MODEL_PROVIDERS } from '@/core/config/model-providers';

import { MODEL_SETTINGS_SCHEMA_VERSION, type ModelSettings, type ProviderInstance } from './types';

/** 各家 OpenAI 兼容 chat 默认 baseUrl（迁移用，用户可在 UI 改） */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek: 'https://api.deepseek.com/v1',
  baidu: 'https://qianfan.baidubce.com/v2',
  alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  iflytek: 'https://spark-api-open.xf-yun.com/v1',
  tencent: 'https://api.hunyuan.cloud.tencent.com/v1',
  minimax: 'https://api.minimax.chat/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  kling: 'https://api.klingai.com/v1',
  bytedance: 'https://ark.cn-beijing.volces.com/api/v3',
};

/** 需要迁移的遗留服务商（与现 MODEL_PROVIDERS 对齐） */
const LEGACY_PROVIDER_IDS = Object.keys(MODEL_PROVIDERS);

interface LegacyHit {
  apiKey?: string;
  baseUrl?: string;
}

/** 判断一个字符串是不是「真凭据」：长度足够且不带占位符号（与旧 hasAnyConfiguredModelProvider 对齐） */
function isRealKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 10) return false;
  if (trimmed.includes('****') || trimmed.includes('xxxxxxxx')) return false;
  return true;
}

/** 从老命名里收集某 provider 的凭据（多套命名去重合并） */
function readLegacyProvider(provider: string): LegacyHit {
  const hit: LegacyHit = {};

  // 1. ai_model_settings_${p} —— JSON { apiKey?, baseUrl? }
  try {
    const raw = localStorage.getItem(`ai_model_settings_${provider}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (isRealKey(parsed?.apiKey)) hit.apiKey = parsed.apiKey.trim();
      if (typeof parsed?.baseUrl === 'string' && parsed.baseUrl) hit.baseUrl = parsed.baseUrl;
    }
  } catch {
    /* 损坏的 JSON：忽略 */
  }

  // 2. 裸串命名：取第一个真凭据
  const rawKeyNames = [
    `api_${provider}_key`,
    `novella_api_key_${provider}`,
    `${provider}_api_key`,
    `secure_api_${provider}_key`,
  ];
  for (const name of rawKeyNames) {
    const value = localStorage.getItem(name);
    if (isRealKey(value)) {
      hit.apiKey = hit.apiKey ?? value.trim();
      break;
    }
  }

  return hit;
}

/**
 * 执行迁移，返回新的 ModelSettings。
 * @param now 时间戳（默认 Date.now；测试可注入以保证 createdAt 确定性）
 */
export function migrateLegacyModelConfig(now: number = Date.now()): ModelSettings {
  const settings: ModelSettings = {
    schemaVersion: MODEL_SETTINGS_SCHEMA_VERSION,
    providers: [],
    capabilityDefaults: {},
    slotBindings: {},
  };

  for (const provider of LEGACY_PROVIDER_IDS) {
    const hit = readLegacyProvider(provider);
    if (!hit.apiKey) continue;

    const info = MODEL_PROVIDERS[provider as keyof typeof MODEL_PROVIDERS];
    const instance: ProviderInstance = {
      id: `legacy:${provider}`,
      label: info?.name ?? provider,
      capability: 'text',
      protocol: 'openai-chat',
      baseUrl: hit.baseUrl ?? DEFAULT_BASE_URLS[provider] ?? '',
      apiKey: hit.apiKey,
      authStyle: 'bearer',
      modelSource: 'auto',
      enabled: true,
      createdAt: now,
    };
    settings.providers.push(instance);

    // 文本默认指向第一家迁移到的实例（后续可在 UI 改）
    if (!settings.capabilityDefaults.text) {
      settings.capabilityDefaults.text = { providerId: instance.id, modelId: '' };
    }
  }

  return settings;
}
