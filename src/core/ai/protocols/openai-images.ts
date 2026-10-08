/**
 * openai-images 协议适配器（P2b）
 * ===================================
 * 图像链路的事实标准：POST `${baseUrl}/images/generations`。
 * 与 openai-chat 同源，但参数名各家仍有差异（如尺寸 `size` vs `width/height`、
 * 反向提示词有的叫 `negative_prompt`），所以支持字段映射覆盖（见 buildOpenAIImagesBody）。
 *
 * 纯函数 + 单次 fetch，便于单测（mock fetch）。
 */

export type OpenAIImagesAuthStyle = 'bearer' | 'x-api-key' | 'query' | 'none';

export interface OpenAIImagesRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  n?: number;
  /** 标准尺寸串，如 '1024x1024' / '1792x1024'；与 width/height 二选一 */
  size?: string;
  /** 覆盖 size（部分兼容端点用 width/height 而非 size） */
  width?: number;
  height?: number;
  /** 反向提示词 → 映射为 negative_prompt */
  negativePrompt?: string;
  /** url（默认）或 b64_json */
  responseFormat?: string;
  authStyle?: OpenAIImagesAuthStyle;
  extraHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface OpenAIImagesResult {
  created?: number;
  images: { url?: string; b64Json?: string }[];
}

export type OpenAIImagesErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'unknown';

export class OpenAIImagesProtocolError extends Error {
  constructor(
    message: string,
    public readonly kind: OpenAIImagesErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'OpenAIImagesProtocolError';
  }
}

function classify(status: number): OpenAIImagesErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status === 400) return 'bad_request';
  return 'unknown';
}

export function buildOpenAIImagesUrl(baseUrl: string, queryParams?: Record<string, string>): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let url = `${trimmed}/images/generations`;
  if (queryParams && Object.keys(queryParams).length > 0) {
    url += `?${new URLSearchParams(queryParams).toString()}`;
  }
  return url;
}

export function buildOpenAIImagesHeaders(req: OpenAIImagesRequest): Record<string, string> {
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

/**
 * 构造请求体。尺寸字段映射：
 * - 给了 width/height → 用 width/height（覆盖 size）
 * - 否则用 size
 * - negativePrompt → negative_prompt
 */
export function buildOpenAIImagesBody(req: OpenAIImagesRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, prompt: req.prompt };
  if (req.n !== undefined) body.n = req.n;

  if (req.width !== undefined && req.height !== undefined) {
    body.width = req.width;
    body.height = req.height;
  } else if (req.size !== undefined) {
    body.size = req.size;
  }

  if (req.negativePrompt !== undefined) body.negative_prompt = req.negativePrompt;
  if (req.responseFormat !== undefined) body.response_format = req.responseFormat;
  return body;
}

export function parseOpenAIImagesResponse(data: unknown): OpenAIImagesResult {
  const d = data as { created?: number; data?: ({ url?: string; b64_json?: string })[] };
  return {
    created: d.created,
    images: (d.data ?? []).map((it) => ({ url: it?.url, b64Json: it?.b64_json })),
  };
}

export async function callOpenAIImages(req: OpenAIImagesRequest): Promise<OpenAIImagesResult> {
  const fetchImpl = req.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(buildOpenAIImagesUrl(req.baseUrl, req.queryParams), {
      method: 'POST',
      headers: buildOpenAIImagesHeaders(req),
      body: JSON.stringify(buildOpenAIImagesBody(req)),
      signal: req.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new OpenAIImagesProtocolError('请求被取消或超时', 'network');
    }
    throw new OpenAIImagesProtocolError(
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
    throw new OpenAIImagesProtocolError(
      `openai-images 调用失败 (HTTP ${response.status})${detail}`,
      classify(response.status),
      response.status
    );
  }

  const data: unknown = await response.json();
  return parseOpenAIImagesResponse(data);
}
