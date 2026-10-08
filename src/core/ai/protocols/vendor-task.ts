/**
 * vendor-task 声明式异步任务引擎（P2c）
 * ===================================
 * 视频没有事实标准协议（可灵官方要 ak/sk 签 JWT、MiniMax 用 query 轮询、
 * 各家取结果方式/状态枚举/路径前缀都不同）。所以不做「一个协议一个适配函数」，
 * 而是做一份声明式描述符（JSON）+ 一个通用引擎：提交 → 轮询 →（可选取结果）→ 取回视频。
 *
 * 新增一家视频服务商 = 加一份描述符（或用户在 UI 里填），**不改引擎代码**。
 * 代价：路径/字段写错只能运行时报错 —— 因此 P4 的「试跑 + 回显上游原始响应」调试入口是刚需。
 *
 * 纯函数 + fetch 注入（便于单测 mock fetch）。JWT-HS256 用 Web Crypto（浏览器/Node 通用）。
 */

export type VendorAuthStyle = 'bearer' | 'x-api-key' | 'query' | 'jwt-hs256' | 'none';

export type VendorTaskStatus = 'processing' | 'succeeded' | 'failed';

export interface VendorAuthSpec {
  style: VendorAuthStyle;
  /** jwt-hs256：凭据字段名（从 credentials 取，默认 accessKey / secretKey） */
  accessKeyField?: string;
  secretKeyField?: string;
  /** x-api-key / 自定义头名（默认 X-API-Key） */
  headerName?: string;
  /** query 方式时的参数名（默认 api_key） */
  queryName?: string;
}

export interface VendorCreateSpec {
  /** 相对 baseUrl 的路径，可含 {var} 占位 */
  path: string;
  method?: 'POST' | 'GET';
  /** 从创建响应里提取 taskId 的 JSON 路径 */
  taskIdPath: string;
  /** 逻辑字段 → 上游字段名映射；未列出的按同名发送 */
  bodyFields?: Record<string, string>;
  /** 固定附加字段（如 api 版本、回调地址） */
  extraBody?: Record<string, unknown>;
  /** create 时拼到 query 的附加固定参数 */
  query?: Record<string, string>;
}

export interface VendorPollSpec {
  /** 相对 baseUrl 的路径，可含 {taskId} */
  path: string;
  method?: 'GET' | 'POST';
  /** taskId → query 参数名（部分服务商轮询走 query string） */
  queryFields?: Record<string, string>;
  intervalMs?: number;
  maxAttempts?: number;
  /** 取状态的 JSON 路径 */
  statusPath: string;
  /** 上游状态名 → 标准状态；未列出的按同名（succeeded/failed/processing）兜底 */
  statusMap?: Record<string, VendorTaskStatus>;
  /** 取错误信息的 JSON 路径 */
  errorPath?: string;
}

export interface VendorFetchResultSpec {
  /** 取结果第二步路径，可含 {fileId} 等占位（从 fromPaths 填充） */
  path: string;
  method?: 'GET' | 'POST';
  /** 占位名 → 源 JSON 路径（从 poll 响应取，如 file_id） */
  fromPaths?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface VendorTaskDescriptor {
  id: string;
  label: string;
  auth: VendorAuthSpec;
  create: VendorCreateSpec;
  poll: VendorPollSpec;
  /** 取结果第二步（如 MiniMax 先拿 file_id 再换下载地址） */
  fetchResult?: VendorFetchResultSpec;
  /** 最终视频 URL / 内容的 JSON 路径（有 fetchResult 时从第二步响应取，否则从 poll 响应取） */
  resultPath: string;
  defaultModel?: string;
}

/** 引擎的输入：上游路径 + 凭据 + 逻辑字段 */
export interface VendorTaskRequest {
  baseUrl: string;
  credentials: Record<string, string>;
  prompt: string;
  model?: string;
  durationSec?: number;
  aspectRatio?: string;
  resolution?: string;
  fps?: number;
  seed?: number;
  firstFrameImage?: string;
  lastFrameImage?: string;
  negativePrompt?: string;
}

export interface VendorTaskResult {
  status: VendorTaskStatus;
  url?: string;
  /** 上游最终原始响应（P4 调试回显用） */
  raw?: unknown;
}

export type VendorTaskErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'bad_request'
  | 'network'
  | 'task_failed'
  | 'unknown';

export class VendorTaskProtocolError extends Error {
  constructor(
    message: string,
    public readonly kind: VendorTaskErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'VendorTaskProtocolError';
  }
}

// ─────────────── JSON 路径解析（支持 a.b[0].c） ───────────────

export function jsonPath(data: unknown, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = data;
  for (const seg of segments) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

// ─────────────── 工具 ───────────────

function fillPath(path: string, vars: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(vars[k] ?? ''));
}

function buildUrl(baseUrl: string, path: string, vars: Record<string, string>, query: Record<string, string>): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  let url = `${trimmed}${fillPath(path, vars)}`;
  const qs = new URLSearchParams(query).toString();
  if (qs) url += `?${qs}`;
  return url;
}

function classify(status: number): VendorTaskErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (status === 400) return 'bad_request';
  return 'unknown';
}

function base64UrlEncode(input: string | Uint8Array): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 可灵官方等需要的 HS256 JWT（ak/sk 签，Web Crypto，浏览器/Node 通用） */
export async function signJwtHs256(accessKey: string, secretKey: string, expiresInSec = 1800): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', iss: accessKey };
  const payload = { iss: accessKey, exp: now + expiresInSec, iat: now };
  const enc = (obj: unknown) => base64UrlEncode(JSON.stringify(obj));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new VendorTaskProtocolError('当前环境不支持 Web Crypto（无法签名 JWT）', 'unknown');
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

async function buildAuth(
  desc: VendorTaskDescriptor,
  credentials: Record<string, string>
): Promise<{ headers: Record<string, string>; query: Record<string, string> }> {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const auth = desc.auth;
  switch (auth.style) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${credentials.apiKey ?? ''}`;
      break;
    case 'x-api-key':
      headers[auth.headerName ?? 'X-API-Key'] = credentials.apiKey ?? '';
      break;
    case 'query':
      query[auth.queryName ?? 'api_key'] = credentials.apiKey ?? '';
      break;
    case 'jwt-hs256': {
      const ak = credentials[auth.accessKeyField ?? 'accessKey'] ?? '';
      const sk = credentials[auth.secretKeyField ?? 'secretKey'] ?? '';
      const token = await signJwtHs256(ak, sk);
      headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'none':
      break;
  }
  return { headers, query };
}

const LOGICAL_FIELDS = [
  'prompt',
  'model',
  'durationSec',
  'aspectRatio',
  'resolution',
  'fps',
  'seed',
  'firstFrameImage',
  'lastFrameImage',
  'negativePrompt',
] as const;

function buildCreateBody(desc: VendorTaskDescriptor, req: VendorTaskRequest): Record<string, unknown> {
  const map = desc.create.bodyFields ?? {};
  const body: Record<string, unknown> = {};
  for (const name of LOGICAL_FIELDS) {
    const value = (req as unknown as Record<string, unknown>)[name];
    if (value === undefined || value === '') continue;
    const upstream = map[name] ?? name;
    body[upstream] = value;
  }
  if (desc.create.extraBody) Object.assign(body, desc.create.extraBody);
  return body;
}

async function doFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  try {
    return await fetchImpl(url, { signal, ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new VendorTaskProtocolError('请求被取消或超时', 'network');
    }
    throw new VendorTaskProtocolError(error instanceof Error ? error.message : '网络请求失败', 'network');
  }
}

async function expectOk(res: Response, action: string): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    const text = await res.text();
    if (text) detail = `: ${text.slice(0, 200)}`;
  } catch {
    /* ignore */
  }
  throw new VendorTaskProtocolError(`${action}失败 (HTTP ${res.status})${detail}`, classify(res.status), res.status);
}

export interface VendorTaskOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** 注入 sleep（测试用，避免真实定时器等待） */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 通用异步任务执行引擎：提交 → 轮询 →（可选取结果）→ 取回视频。
 * 行为完全由 VendorTaskDescriptor 驱动。
 */
export async function runVendorTask(
  desc: VendorTaskDescriptor,
  req: VendorTaskRequest,
  options: VendorTaskOptions = {}
): Promise<VendorTaskResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const { headers, query: authQuery } = await buildAuth(desc, req.credentials);

  // 1. 提交
  const createQuery = { ...authQuery, ...(desc.create.query ?? {}) };
  const createUrl = buildUrl(req.baseUrl, desc.create.path, {}, createQuery);
  const createRes = await doFetch(fetchImpl, createUrl, {
    method: desc.create.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(buildCreateBody(desc, req)),
  });
  await expectOk(createRes, '创建视频任务');
  const createData = await createRes.json();
  const taskId = String(jsonPath(createData, desc.create.taskIdPath) ?? '');
  if (!taskId) {
    throw new VendorTaskProtocolError('无法从创建响应中提取 taskId（检查 create.taskIdPath）', 'unknown');
  }

  // 2. 轮询
  const maxAttempts = desc.poll.maxAttempts ?? 60;
  const intervalMs = desc.poll.intervalMs ?? 2000;
  let lastData: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollQuery = { ...authQuery };
    if (desc.poll.queryFields) {
      for (const [logical, upstream] of Object.entries(desc.poll.queryFields)) {
        pollQuery[upstream] = logical === 'taskId' ? taskId : String(jsonPath(lastData ?? {}, logical) ?? '');
      }
    }
    const pollUrl = buildUrl(req.baseUrl, desc.poll.path, { taskId }, pollQuery);
    const pollRes = await doFetch(fetchImpl, pollUrl, {
      method: desc.poll.method ?? 'GET',
      headers,
    });
    await expectOk(pollRes, '轮询视频任务');
    lastData = await pollRes.json();

    const statusRaw = String(jsonPath(lastData, desc.poll.statusPath) ?? 'processing');
    const status = desc.poll.statusMap?.[statusRaw] ?? standardize(statusRaw);

    if (status === 'failed') {
      const errMsg = desc.poll.errorPath
        ? String(jsonPath(lastData, desc.poll.errorPath) ?? '未知错误')
        : '任务失败';
      throw new VendorTaskProtocolError(`视频任务失败: ${errMsg}`, 'task_failed');
    }

    if (status === 'succeeded') {
      if (desc.fetchResult) {
        const fr = desc.fetchResult;
        const frVars: Record<string, string> = {};
        if (fr.fromPaths) {
          for (const [name, srcPath] of Object.entries(fr.fromPaths)) {
            frVars[name] = String(jsonPath(lastData, srcPath) ?? '');
          }
        }
        const frUrl = buildUrl(req.baseUrl, fr.path, frVars, authQuery);
        const frRes = await doFetch(fetchImpl, frUrl, {
          method: fr.method ?? 'GET',
          headers: { ...headers, ...(fr.headers ?? {}) },
        });
        await expectOk(frRes, '获取视频结果');
        const frData = await frRes.json();
        const url = jsonPath(frData, desc.resultPath);
        return { status: 'succeeded', url: url != null ? String(url) : undefined, raw: frData };
      }
      const url = jsonPath(lastData, desc.resultPath);
      return { status: 'succeeded', url: url != null ? String(url) : undefined, raw: lastData };
    }

    // processing → 等待后重试
    await sleep(intervalMs);
  }

  throw new VendorTaskProtocolError('轮询超时（达到最大尝试次数）', 'unknown');
}

function standardize(raw: string): VendorTaskStatus {
  const r = raw.toLowerCase();
  if (r === 'succeeded' || r === 'success' || r === 'complete' || r === 'completed') return 'succeeded';
  if (r === 'failed' || r === 'fail' || r === 'error') return 'failed';
  return 'processing';
}
