/**
 * openai-chat 协议适配器（P2a）
 * ===================================
 * 设计见 docs/模型提供方配置架构设计.md §3.1 / §五 P2a。
 *
 * 文本链路的事实标准协议：所有 OpenAI 兼容端点（OpenAI / DeepSeek / 通义 / 中转站 / ai-switch 网关）
 * 都走这一个适配器，baseUrl 可任意传参；不再为每家服务商写一份 strategy。
 *
 * 本模块是纯函数 + 一次 fetch，不依赖任何全局状态，便于单测（mock fetch）。
 */

export type OpenAIChatRole = 'system' | 'user' | 'assistant';

export interface OpenAIChatMessage {
  role: OpenAIChatRole;
  content: string;
  name?: string;
}

export type OpenAIChatAuthStyle = 'bearer' | 'x-api-key' | 'query' | 'none';

export interface OpenAIChatRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  authStyle?: OpenAIChatAuthStyle;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  signal?: AbortSignal;
  /** 注入 fetch（测试用；默认全局 fetch） */
  fetchImpl?: typeof fetch;
}

export interface OpenAIChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenAIChatResult {
  content: string;
  model: string;
  usage?: OpenAIChatUsage;
}

/** 文本链路统一错误：携带错误类别，便于上层分类处理（P3 探测会复用） */
export type OpenAIChatErrorKind =
  | 'auth' // 401 / 403
  | 'rate_limit' // 429
  | 'server' // >= 500
  | 'bad_request' // 400
  | 'network' // 无法连接 / 超时 / 取消
  | 'unknown';

export class OpenAIChatProtocolError extends Error {
  constructor(
    message: string,
    public readonly kind: OpenAIChatErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OpenAIChatProtocolError';
  }
}

/** 构造完整 URL：baseUrl + /chat/completions，并按需追加 query 参数 */
export function buildOpenAIChatUrl(baseUrl: string, queryParams?: Record<string, string>): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let url = `${trimmed}/chat/completions`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString();
    url += `?${qs}`;
  }
  return url;
}

/** 构造请求头（authStyle 决定鉴权方式；extraHeaders 追加/覆盖） */
export function buildOpenAIChatHeaders(req: OpenAIChatRequest): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  switch (req.authStyle ?? 'bearer') {
    case 'bearer':
      if (req.apiKey) headers['Authorization'] = `Bearer ${req.apiKey}`;
      break;
    case 'x-api-key':
      if (req.apiKey) headers['X-API-Key'] = req.apiKey;
      break;
    case 'query':
    case 'none':
      // 鉴权不在头里（query 走 URL，none 无鉴权）
      break;
  }
  if (req.extraHeaders) {
    for (const [k, v] of Object.entries(req.extraHeaders)) headers[k] = v;
  }
  return headers;
}

/** 构造请求体（只发 OpenAI 认识的字段） */
export function buildOpenAIChatBody(req: OpenAIChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stop !== undefined) body.stop = req.stop;
  return body;
}

/** 解析 OpenAI 标准响应 */
export function parseOpenAIChatResponse(data: unknown): OpenAIChatResult {
  const d = data as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };
  const usage = d.usage
    ? {
        promptTokens: d.usage.prompt_tokens ?? 0,
        completionTokens: d.usage.completion_tokens ?? 0,
        totalTokens: d.usage.total_tokens ?? 0,
      }
    : undefined;
  return {
    content: d.choices?.[0]?.message?.content ?? '',
    model: d.model ?? 'unknown',
    usage,
  };
}

/**
 * 执行一次 openai-chat 调用（纯函数 + 单次 fetch）。
 * 失败按类别抛出 OpenAIChatProtocolError，便于上层区分 auth / rate_limit / server / network。
 */
export async function callOpenAIChat(req: OpenAIChatRequest): Promise<OpenAIChatResult> {
  const fetchImpl = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(buildOpenAIChatUrl(req.baseUrl, req.queryParams), {
      method: 'POST',
      headers: buildOpenAIChatHeaders(req),
      body: JSON.stringify(buildOpenAIChatBody(req)),
      signal: req.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAIChatProtocolError('请求被取消或超时', 'network');
    }
    throw new OpenAIChatProtocolError(
      error instanceof Error ? error.message : '网络请求失败',
      'network'
    );
  }

  if (!response.ok) {
    const kind: OpenAIChatErrorKind =
      response.status === 401 || response.status === 403
        ? 'auth'
        : response.status === 429
          ? 'rate_limit'
          : response.status >= 500
            ? 'server'
            : response.status === 400
              ? 'bad_request'
              : 'unknown';
    let detail = '';
    try {
      const text = await response.text();
      if (text) detail = `: ${text.slice(0, 200)}`;
    } catch {
      /* 读错误体失败：忽略 */
    }
    throw new OpenAIChatProtocolError(
      `openai-chat 调用失败 (HTTP ${response.status})${detail}`,
      kind,
      response.status
    );
  }

  const data: unknown = await response.json();
  return parseOpenAIChatResponse(data);
}
