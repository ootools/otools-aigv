/**
 * openai-speech 协议适配器（P2b）
 * ===================================
 * 语音（TTS）链路的事实标准：POST `${baseUrl}/audio/speech`，返回二进制音频。
 * 同样支持 auth / 字段映射覆盖（voice / speed / response_format）。
 *
 * 纯函数 + 单次 fetch，便于单测（mock fetch）。
 */

export type OpenAISpeechAuthStyle = 'bearer' | 'x-api-key' | 'query' | 'none';

export interface OpenAISpeechRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 要合成的文本 */
  input: string;
  /** 音色 */
  voice: string;
  /** 语速，如 1.0 */
  speed?: number;
  /** 输出格式：mp3 / opus / aac / flac ... */
  responseFormat?: string;
  authStyle?: OpenAISpeechAuthStyle;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface OpenAISpeechResult {
  audio: ArrayBuffer;
  contentType?: string;
}

export type OpenAISpeechErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'unknown';

export class OpenAISpeechProtocolError extends Error {
  constructor(
    message: string,
    public readonly kind: OpenAISpeechErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OpenAISpeechProtocolError';
  }
}

function classify(status: number): OpenAISpeechErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status === 400) return 'bad_request';
  return 'unknown';
}

export function buildOpenAISpeechUrl(baseUrl: string, queryParams?: Record<string, string>): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let url = `${trimmed}/audio/speech`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    url += `?${new URLSearchParams(queryParams).toString()}`;
  }
  return url;
}

export function buildOpenAISpeechHeaders(req: OpenAISpeechRequest): Record<string, string> {
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
      break;
  }
  if (req.extraHeaders) {
    for (const [k, v] of Object.entries(req.extraHeaders)) headers[k] = v;
  }
  return headers;
}

export function buildOpenAISpeechBody(req: OpenAISpeechRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.input,
    voice: req.voice,
  };
  if (req.speed !== undefined) body.speed = req.speed;
  if (req.responseFormat !== undefined) body.response_format = req.responseFormat;
  return body;
}

export async function callOpenAISpeech(req: OpenAISpeechRequest): Promise<OpenAISpeechResult> {
  const fetchImpl = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(buildOpenAISpeechUrl(req.baseUrl, req.queryParams), {
      method: 'POST',
      headers: buildOpenAISpeechHeaders(req),
      body: JSON.stringify(buildOpenAISpeechBody(req)),
      signal: req.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAISpeechProtocolError('请求被取消或超时', 'network');
    }
    throw new OpenAISpeechProtocolError(
      error instanceof Error ? error.message : '网络请求失败',
      'network'
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      if (text) detail = `: ${text.slice(0, 200)}`;
    } catch {
      /* 读错误体失败：忽略 */
    }
    throw new OpenAISpeechProtocolError(
      `openai-speech 调用失败 (HTTP ${response.status})${detail}`,
      classify(response.status),
      response.status
    );
  }

  const audio = await response.arrayBuffer();
  return { audio, contentType: response.headers.get('content-type') ?? undefined };
}
