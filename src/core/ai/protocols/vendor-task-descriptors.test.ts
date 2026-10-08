/**
 * P2c 集成测试：内置视频描述符（可灵 / MiniMax / 智谱）
 * 拿各家真实响应样例跑描述符解析，验证 字段映射 / 状态映射 / 两步取结果 / JWT 都正确。
 */

import {
  runVendorTask,
  type VendorTaskRequest,
} from './vendor-task';
import { BUILTIN_VIDEO_DESCRIPTORS } from './vendor-task-descriptors';

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

describe('内置描述符 — 可灵官方（JWT）', () => {
  it('create → poll succeeded → 取 resource_url', async () => {
    const desc = BUILTIN_VIDEO_DESCRIPTORS['kling-official'];
    const fetchMock = seqFetch([
      { status: 200, json: { data: { task_id: 'k1' } } },
      { status: 200, json: { data: { task_status: 'succeed', works: [{ resource_url: 'https://v/k.mp4' }] } } },
    ]);
    const req: VendorTaskRequest = {
      baseUrl: 'https://api.kling.com',
      credentials: { apiKey: '', accessKey: 'ak', secretKey: 'sk' },
      prompt: 'a cat',
      durationSec: 5,
    };
    const res = await runVendorTask(desc, req, { fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/k.mp4');
    const [, init0] = fetchMock.mock.calls[0];
    expect((init0 as RequestInit).headers).toMatchObject({ Authorization: /^Bearer .+\..+\.+/ });
  });
});

describe('内置描述符 — MiniMax（Bearer + 两步取结果）', () => {
  it('create → poll Success(file_id) → fetchResult 取 download_url', async () => {
    const desc = BUILTIN_VIDEO_DESCRIPTORS['minimax'];
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 'm1' } },
      { status: 200, json: { status: 'Success', file_id: 'f9' } },
      { status: 200, json: { file: { download_url: 'https://v/m.mp4' } } },
    ]);
    const req: VendorTaskRequest = {
      baseUrl: 'https://api.minimax.com',
      credentials: { apiKey: 'sk' },
      prompt: 'a cat',
    };
    const res = await runVendorTask(desc, req, { fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/m.mp4');
    // 轮询走 query string task_id
    expect(fetchMock.mock.calls[1][0]).toContain('task_id=m1');
    // 第二步取 file/f9
    expect(fetchMock.mock.calls[2][0]).toContain('/file/f9');
  });
});

describe('内置描述符 — 智谱 CogVideo（Bearer）', () => {
  it('create → poll SUCCEEDED → 取 video_url', async () => {
    const desc = BUILTIN_VIDEO_DESCRIPTORS['zhipu'];
    const fetchMock = seqFetch([
      { status: 200, json: { id: 'z1' } },
      { status: 200, json: { status: 'SUCCEEDED', video_url: 'https://v/z.mp4' } },
    ]);
    const req: VendorTaskRequest = {
      baseUrl: 'https://api.zhipu.com',
      credentials: { apiKey: 'sk' },
      prompt: 'a cat',
    };
    const res = await runVendorTask(desc, req, { fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/z.mp4');
  });
});
