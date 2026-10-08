/**
 * P2c 单元测试：vendor-task 通用引擎（提交→轮询→取结果）
 * 用 mock fetch 跑一份自定义描述符，覆盖：生命周期、字段映射、状态映射、错误路径、JWT、两步取结果。
 */

import {
  VendorTaskProtocolError,
  jsonPath,
  runVendorTask,
  signJwtHs256,
  type VendorTaskDescriptor,
 VendorTaskRequest } from './vendor-task';

/** 按调用顺序返回一组响应（第 i 次 fetch 取第 i 个） */
function seqFetch(responses: { status: number; json: unknown }[]): jest.Mock {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => '',
    };
  }) as unknown as jest.Mock;
}

const REQ: VendorTaskRequest = {
  baseUrl: 'https://v.example.com',
  credentials: { apiKey: 'sk', accessKey: 'ak', secretKey: 'sk-secret' },
  prompt: 'a cat',
  model: 'model-x',
};

describe('vendor-task 引擎 — jsonPath', () => {
  it('解析 a.b[0].c', () => {
    expect(jsonPath({ a: { b: [{ c: 'hit' }] } }, 'a.b[0].c')).toBe('hit');
    expect(jsonPath({ a: { b: [{}] } }, 'a.b[0].c')).toBeUndefined();
  });
});

describe('vendor-task 引擎 — 生命周期', () => {
  const DESC: VendorTaskDescriptor = {
    id: 'test',
    label: 'test',
    auth: { style: 'bearer' },
    create: { path: '/create', method: 'POST', taskIdPath: 'task_id' },
    poll: { path: '/poll/{taskId}', method: 'GET', statusPath: 'status' },
    resultPath: 'url',
  };

  it('create → 首次轮询 succeeded → 取回 url', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'succeeded', url: 'https://v/x.mp4' } },
    ]);
    const res = await runVendorTask(DESC, REQ, { fetchImpl: fetchMock });
    expect(res.status).toBe('succeeded');
    expect(res.url).toBe('https://v/x.mp4');
    // 第二次请求是 poll，URL 含 taskId
    const [, init1] = fetchMock.mock.calls[1];
    expect((init1 as RequestInit).method).toBe('GET');
  });

  it('create → processing → 再轮询 succeeded（多步轮询）', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'processing' } },
      { status: 200, json: { status: 'succeeded', url: 'https://v/y.mp4' } },
    ]);
    const res = await runVendorTask(DESC, REQ, { fetchImpl: fetchMock, sleep: async () => {} });
    expect(res.url).toBe('https://v/y.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('字段映射：逻辑 prompt/model → 上游不同名', async () => {
    const mapDesc: VendorTaskDescriptor = {
      ...DESC,
      create: { ...DESC.create, bodyFields: { prompt: 'text', model: 'model_name' }, taskIdPath: 'id' },
    };
    const fetchMock = seqFetch([
      { status: 200, json: { id: 't1' } },
      { status: 200, json: { status: 'succeeded', url: 'u' } },
    ]);
    await runVendorTask(mapDesc, REQ, { fetchImpl: fetchMock });
    const [, init0] = fetchMock.mock.calls[0];
    const body = JSON.parse((init0 as RequestInit).body as string);
    expect(body).toMatchObject({ text: 'a cat', model_name: 'model-x' });
  });

  it('状态映射：上游 Success → succeeded', async () => {
    const mapDesc: VendorTaskDescriptor = {
      ...DESC,
      poll: { ...DESC.poll, statusMap: { Success: 'succeeded', Fail: 'failed' } },
    };
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'Success', url: 'u' } },
    ]);
    const res = await runVendorTask(mapDesc, REQ, { fetchImpl: fetchMock });
    expect(res.status).toBe('succeeded');
  });

  it('任务失败 → task_failed（带 errorPath 信息）', async () => {
    const errDesc: VendorTaskDescriptor = {
      ...DESC,
      poll: { ...DESC.poll, statusMap: { Fail: 'failed' }, errorPath: 'message' },
    };
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'Fail', message: 'boom' } },
    ]);
    await expect(runVendorTask(errDesc, REQ, { fetchImpl: fetchMock })).rejects.toMatchObject({
      kind: 'task_failed',
    } satisfies Partial<VendorTaskProtocolError>);
  });

  it('create 401 → auth', async () => {
    const fetchMock = seqFetch([{ status: 401, json: {} }]);
    await expect(runVendorTask(DESC, REQ, { fetchImpl: fetchMock })).rejects.toMatchObject({
      kind: 'auth',
      status: 401,
    } satisfies Partial<VendorTaskProtocolError>);
  });

  it('无法提取 taskId → 报错', async () => {
    const fetchMock = seqFetch([{ status: 200, json: { no_id: 1 } }]);
    await expect(runVendorTask(DESC, REQ, { fetchImpl: fetchMock })).rejects.toThrow(/taskId/);
  });
});

describe('vendor-task 引擎 — 两步取结果（fetchResult）', () => {
  const DESC: VendorTaskDescriptor = {
    id: 'two-step',
    label: 'two-step',
    auth: { style: 'bearer' },
    create: { path: '/create', method: 'POST', taskIdPath: 'task_id' },
    poll: {
      path: '/poll',
      method: 'GET',
      queryFields: { taskId: 'task_id' },
      statusPath: 'status',
      statusMap: { Success: 'succeeded', Fail: 'failed' },
      errorPath: 'message',
    },
    fetchResult: { path: '/file/{file_id}', method: 'GET', fromPaths: { file_id: 'file_id' } },
    resultPath: 'file.download_url',
  };

  it('poll 返回 file_id → 第二步取 download_url', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'Success', file_id: 'f1' } },
      { status: 200, json: { file: { download_url: 'https://v/d.mp4' } } },
    ]);
    const res = await runVendorTask(DESC, REQ, { fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/d.mp4');
    // 第三步是 fetchResult，path 含 file_id
    const [url2] = fetchMock.mock.calls[2];
    expect(url2).toContain('/file/f1');
    // 轮询走 query string
    const [url1] = fetchMock.mock.calls[1];
    expect(url1).toContain('task_id=t1');
  });
});

describe('vendor-task 引擎 — JWT-HS256 鉴权', () => {
  const DESC: VendorTaskDescriptor = {
    id: 'jwt',
    label: 'jwt',
    auth: { style: 'jwt-hs256', accessKeyField: 'accessKey', secretKeyField: 'secretKey' },
    create: { path: '/create', method: 'POST', taskIdPath: 'id' },
    poll: { path: '/{taskId}', method: 'GET', statusPath: 'state', statusMap: { done: 'succeeded' } },
    resultPath: 'url',
  };

  it('signJwtHs256 产出 3 段 JWT，header 含 HS256', async () => {
    const token = await signJwtHs256('ak', 'sk');
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
  });

  it('请求头带上 Bearer JWT', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { id: 't1' } },
      { status: 200, json: { state: 'done', url: 'https://v/j.mp4' } },
    ]);
    const res = await runVendorTask(DESC, REQ, { fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/j.mp4');
    const [, init0] = fetchMock.mock.calls[0];
    const h = (init0 as RequestInit).headers as Record<string, string>;
    expect(h['Authorization']).toMatch(/^Bearer .+\..+\.+/);
  });
});
