/**
 * P2c 单元测试：openai-videos 适配器（new-api / Sora 契约）
 * 复用 vendor-task 引擎，验证 create → poll 生命周期与字段映射。
 */

import { callOpenAIVideos, OPENAI_VIDEOS_DESCRIPTOR } from './openai-videos';
import type { VendorTaskRequest } from './vendor-task';

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
  baseUrl: 'https://gw.example.com',
  credentials: { apiKey: 'sk' },
  prompt: 'a cat',
  model: 'sora-1',
  durationSec: 5,
  aspectRatio: '16:9',
};

describe('openai-videos 适配器', () => {
  it('create /v1/video/generations → poll 取回 url', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1', status: 'processing' } },
      { status: 200, json: { status: 'succeeded', url: 'https://v/o.mp4' } },
    ]);
    const res = await callOpenAIVideos(REQ, { fetchImpl: fetchMock });
    expect(res.status).toBe('succeeded');
    expect(res.url).toBe('https://v/o.mp4');

    const [url0, init0] = fetchMock.mock.calls[0];
    expect(url0).toBe('https://gw.example.com/v1/video/generations');
    expect((init0 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk' });
    const body = JSON.parse((init0 as RequestInit).body as string);
    expect(body).toMatchObject({ prompt: 'a cat', model: 'sora-1', duration: 5, aspect_ratio: '16:9' });

    const [url1] = fetchMock.mock.calls[1];
    expect(url1).toBe('https://gw.example.com/v1/video/generations/t1');
  });

  it('pending → processing → succeeded（多步轮询）', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'pending' } },
      { status: 200, json: { status: 'succeeded', url: 'u' } },
    ]);
    const res = await callOpenAIVideos(REQ, { fetchImpl: fetchMock, sleep: async () => {} });
    expect(res.status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('create 400 → bad_request', async () => {
    const fetchMock = seqFetch([{ status: 400, json: {} }]);
    await expect(callOpenAIVideos(REQ, { fetchImpl: fetchMock })).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('描述符 id 为 openai-videos', () => {
    expect(OPENAI_VIDEOS_DESCRIPTOR.id).toBe('openai-videos');
  });
});
