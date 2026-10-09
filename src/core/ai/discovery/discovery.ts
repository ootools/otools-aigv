/**
 * 模型发现 / 连通性探测（P3）
 * ===================================
 * 设计文档 §3.6：用**真请求**替换原来「只做正则 + Math.random 假装连通」的假校验。
 *
 * - probeProvider：发 `GET {baseUrl}/models` 真请求，明确区分
 *   网络不通 / 401 未授权 / 429 限流 / 5xx / 404(端点不对)。
 * - fetchModels：text/stt/embedding 走 /models 真拉取；image/tts/video 先试 /models，
 *   404/403 回退到内置候选名清单；manual 模式直接返回用户手填；modelFilter 做白名单过滤。
 * - 拉取结果带 TTL 缓存（按「凭据签名」失效，改 baseUrl/key 自动失效）。
 *
 * 纯函数 + fetch 注入（便于单测 mock fetch）。所有错误都给出 kind，UI 能分类提示。
 */

import type { Capability, ProviderInstance } from '../../config/model-settings/types';
import { signJwtHs256 } from '../protocols/vendor-task';
import { getBuiltinVideoDescriptor } from '../protocols/vendor-task-descriptors';

import { getProtocolCandidateModels } from './candidates';

export type ProbeKind = 'ok' | 'auth' | 'rate_limit' | 'server' | 'network' | 'bad_request' | 'unknown';

export interface ProbeResult {
  ok: boolean;
  latencyMs?: number;
  /** ok 时为 'ok'；否则为失败分类 */
  kind: ProbeKind;
  /** 人类可读信息（失败原因 / 或「该端点无 /models」之类的备注） */
  error?: string;
}

export type ModelListSource = 'auto' | 'candidate' | 'manual';

export type DiscoveryKind =
  | 'ok'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'bad_request'
  | 'unknown';

export interface ModelDiscoveryResult {
  models: string[];
  source: ModelListSource;
  kind: DiscoveryKind;
  error?: string;
  /** 命中缓存（UI 提示「这是缓存，点刷新拉最新」） */
  cached?: boolean;
}

export interface DiscoveryOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** 忽略缓存重新拉取 */
  forceRefresh?: boolean;
  /** 缓存 TTL（毫秒），默认 5 分钟 */
  cacheTtlMs?: number;
}

// ─────────────── 鉴权头构建 ───────────────

export interface AuthParts {
  headers: Record<string, string>;
  query: Record<string, string>;
}

/**
 * 按 provider 构造请求头 / query 鉴权参数。
 * 普通协议用 authStyle（bearer/x-api-key/query/none）；
 * vendor-task 且带 accessKey+secretKey 时签 JWT-HS256（可灵官方等）。
 */
export async function buildAuthHeaders(provider: ProviderInstance): Promise<AuthParts> {
  const headers: Record<string, string> = { ...(provider.extraHeaders ?? {}) };
  const query: Record<string, string> = { ...(provider.queryParams ?? {}) };
  const style = provider.authStyle ?? 'bearer';

  switch (style) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${provider.apiKey ?? ''}`;
      break;
    case 'x-api-key':
      headers['X-API-Key'] = provider.apiKey ?? '';
      break;
    case 'query':
      query['api_key'] = provider.apiKey ?? '';
      break;
    case 'none':
      break;
  }

  // vendor-task 的 JWT-HS256 鉴权（不在 AuthStyle 枚举里，靠 protocol + ak/sk 判别）
  if (provider.protocol === 'vendor-task' && provider.accessKey && provider.secretKey) {
    const token = await signJwtHs256(provider.accessKey, provider.secretKey);
    headers['Authorization'] = `Bearer ${token}`;
  }

  return { headers, query };
}

// ─────────────── 工具 ───────────────

function buildUrl(baseUrl: string, path: string, query: Record<string, string>): string {
  const trimmed = (baseUrl ?? '').replace(/\/+$/, '');
  let url = `${trimmed}${path}`;
  const qs = new URLSearchParams(query).toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** 从 OpenAI 风格 /models 响应里抽取模型 id 列表；不是标准结构返回 null */
function extractModelIds(json: unknown): string[] | null {
  if (Array.isArray(json)) {
    return collectIds(json);
  }
  if (json && typeof json === 'object') {
    const data = (json as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      return collectIds(data);
    }
  }
  return null;
}

/** 从数组里收集字符串项，或对象项的 id 字段 */
function collectIds(arr: unknown[]): string[] {
  const ids: string[] = [];
  for (const item of arr) {
    if (typeof item === 'string') ids.push(item);
    else if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string') {
      ids.push((item as Record<string, unknown>).id as string);
    }
  }
  return ids.length ? ids : null;
}

/** 按白名单过滤（modelFilter 留空 = 全放行） */
function applyWhitelist(models: string[], filter?: string[]): string[] {
  if (!filter || filter.length === 0) return models;
  const set = new Set(filter);
  return models.filter((m) => set.has(m));
}

/** 取 video 能力的候选名清单：优先服务商描述符，其次 openai-videos 协议级候选 */
function getVideoCandidateModels(provider: ProviderInstance): string[] {
  if (provider.protocol === 'vendor-task' && provider.vendorDescriptorId) {
    const desc = getBuiltinVideoDescriptor(provider.vendorDescriptorId);
    if (desc?.candidateModels?.length) return [...desc.candidateModels];
  }
  return [...(getProtocolCandidateModels('openai-videos') ?? [])];
}

// ─────────────── 连通性探测 ───────────────

/**
 * 真实连通性探测：发 `GET {baseUrl}/models` 真请求并分类。
 * - text/stt/embedding 没有 /models 端点（404/405）视为 baseUrl 错误 → 失败。
 * - image/tts/video 没有 /models 是常态 → 仍判连通（服务器可达、凭据被接受），仅备注。
 */
export async function probeProvider(
  provider: ProviderInstance,
  capability: Capability,
  options: DiscoveryOptions = {}
): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { headers, query } = await buildAuthHeaders(provider);
  const url = buildUrl(provider.baseUrl, '/models', query);
  const start = Date.now();

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: options.signal });
  } catch {
    return { ok: false, kind: 'network', error: '网络不可达：无法连接到该端点' };
  }

  const latencyMs = Date.now() - start;

  if (res.status === 401 || res.status === 403) {
    return { ok: false, kind: 'auth', latencyMs, error: '鉴权失败（401/403）：API Key 无效或权限不足' };
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate_limit', latencyMs, error: '触发限流（429）' };
  }
  if (res.status >= 500) {
    return { ok: false, kind: 'server', latencyMs, error: `服务端错误（${res.status}）` };
  }
  if (res.ok) {
    return { ok: true, kind: 'ok', latencyMs };
  }

  // 404 / 405 / 其他非 2xx
  if (capability === 'text' || capability === 'stt' || capability === 'embedding') {
    return {
      ok: false,
      kind: 'bad_request',
      latencyMs,
      error: '未找到 /models 端点（404/405）：请检查 baseUrl 是否正确（文本类端点应支持 /models）',
    };
  }
  // image/tts/video：/models 缺失是常态，连通性已验证（服务器可达、凭据被接受）
  return { ok: true, kind: 'ok', latencyMs, error: '该端点不支持 /models，模型列表将回退到候选名' };
}

// ─────────────── 模型列表拉取（含缓存） ───────────────

interface CacheEntry {
  at: number;
  signature: string;
  models: string[];
  source: ModelListSource;
}

const modelCache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 5 * 60 * 1000;

function cacheKey(providerId: string, capability: Capability): string {
  return `${providerId}:${capability}`;
}

/** 凭据签名：凭据/端点/协议变化即失效，避免用旧缓存 */
function configSignature(provider: ProviderInstance): string {
  return [
    provider.baseUrl,
    provider.apiKey,
    provider.authStyle,
    provider.accessKey ?? '',
    provider.secretKey ?? '',
    provider.protocol,
    provider.vendorDescriptorId ?? '',
  ].join('|');
}

/** 清空模型列表缓存（可选按 providerId 精确清） */
export function clearModelCache(providerId?: string): void {
  if (!providerId) {
    modelCache.clear();
    return;
  }
  for (const key of [...modelCache.keys()]) {
    if (key.startsWith(`${providerId}:`)) modelCache.delete(key);
  }
}

async function fetchModelsFromEndpoint(
  provider: ProviderInstance,
  options: DiscoveryOptions
): Promise<{ json: unknown } | { error: DiscoveryKind; message: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { headers, query } = await buildAuthHeaders(provider);
  const url = buildUrl(provider.baseUrl, '/models', query);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'GET', headers, signal: options.signal });
  } catch {
    return { error: 'network', message: '网络不可达：无法连接到该端点' };
  }
  if (res.status === 401 || res.status === 403) {
    return { error: 'auth', message: '鉴权失败（401/403）：API Key 无效或权限不足' };
  }
  if (res.status === 429) return { error: 'rate_limit', message: '触发限流（429）' };
  if (res.status >= 500) return { error: 'server', message: `服务端错误（${res.status}）` };
  if (!res.ok) {
    // 404/405 → 交给调用方回退候选
    return { error: 'bad_request', message: `端点返回 ${res.status}，不支持 /models` };
  }
  try {
    const json: unknown = await res.json();
    return { json };
  } catch {
    return { error: 'unknown', message: '无法解析 /models 响应体' };
  }
}

function candidateModelsFor(provider: ProviderInstance, capability: Capability): string[] | null {
  if (capability === 'image' || capability === 'tts') {
    return [...(getProtocolCandidateModels(provider.protocol) ?? [])];
  }
  if (capability === 'video') {
    return getVideoCandidateModels(provider);
  }
  return null; // text/stt/embedding 无跨家候选
}

/**
 * 拉取某 provider 在某能力下的模型清单。
 * - manual：直接返回手填清单。
 * - auto：/models 真拉取 → 白名单过滤；404/无效体 → 回退候选（image/tts/video）；
 *   text/stt/embedding 不支持 /models 且无候选 → 报错，提示手动填写。
 * - 结果按 TTL + 凭据签名缓存。
 */
export async function fetchModels(
  provider: ProviderInstance,
  capability: Capability,
  options: DiscoveryOptions = {}
): Promise<ModelDiscoveryResult> {
  // 手动模式：不走网络
  if (provider.modelSource === 'manual') {
    const models = applyWhitelist(provider.manualModels ?? [], provider.modelFilter);
    return { models, source: 'manual', kind: 'ok' };
  }

  const key = cacheKey(provider.id, capability);
  const sig = configSignature(provider);
  const ttl = options.cacheTtlMs ?? DEFAULT_TTL_MS;
  if (!options.forceRefresh) {
    const hit = modelCache.get(key);
    if (hit?.signature === sig && Date.now() - hit.at < ttl) {
      const models = applyWhitelist(hit.models, provider.modelFilter);
      return { models, source: hit.source, kind: 'ok', cached: true };
    }
  }

  const endpoint = await fetchModelsFromEndpoint(provider, options);

  if ('error' in endpoint) {
    // 端点不可用 → 尝试回退候选
    const candidates = candidateModelsFor(provider, capability);
    if (candidates?.length) {
      const models = applyWhitelist(candidates, provider.modelFilter);
      modelCache.set(key, { at: Date.now(), signature: sig, models, source: 'candidate' });
      return {
        models,
        source: 'candidate',
        kind: 'ok',
        error:
          endpoint.error === 'auth' || endpoint.error === 'network' || endpoint.error === 'server'
            ? `${endpoint.message}：已回退到候选模型名`
            : '该端点不支持 /models：已回退到候选模型名，请手动确认后填写',
      };
    }
    // 无候选可回退（text/stt/embedding）
    return {
      models: [],
      source: 'auto',
      kind: endpoint.error === 'auth' ? 'auth' : endpoint.error === 'network' ? 'network' : 'bad_request',
      error: `${endpoint.message}：文本类端点应支持 /models，请检查 baseUrl，或切换到「手动填写模型名」`,
    };
  }

  // 端点返回（可能是 200 或 404 但被上层当 bad_request）；这里已 res.ok，解析模型
  const ids = extractModelIds(endpoint.json);
  if (!ids || ids.length === 0) {
    // 200 但体不是模型列表 → 回退候选
    const candidates = candidateModelsFor(provider, capability);
    if (candidates?.length) {
      const models = applyWhitelist(candidates, provider.modelFilter);
      modelCache.set(key, { at: Date.now(), signature: sig, models, source: 'candidate' });
      return {
        models,
        source: 'candidate',
        kind: 'ok',
        error: '响应体不是标准模型列表：已回退到候选模型名',
      };
    }
    return {
      models: [],
      source: 'auto',
      kind: 'bad_request',
      error: '响应体不是标准模型列表，且文本类无候选名：请手动填写模型名',
    };
  }

  const models = applyWhitelist(ids, provider.modelFilter);
  modelCache.set(key, { at: Date.now(), signature: sig, models, source: 'auto' });
  return { models, source: 'auto', kind: 'ok' };
}
