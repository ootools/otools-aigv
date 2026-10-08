/**
 * P2c 集成测试：callVideoModel —— 解析 video 能力 → 按 protocol 分派到引擎
 */

import type { ModelSettings, ProviderInstance } from '../config/model-settings/types';

import { callVideoModel } from './video-client';

function provider(p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id'>): ProviderInstance {
  return {
    label: p.id,
    capability: 'video',
    protocol: 'vendor-task',
    baseUrl: 'https://v.example.com',
    apiKey: 'sk',
    authStyle: 'bearer',
    modelSource: 'auto',
    enabled: true,
    createdAt: 0,
    ...p,
  };
}

function settings(p: Partial<ModelSettings> = {}): ModelSettings {
  return { schemaVersion: 2, providers: [], capabilityDefaults: {}, slotBindings: {}, ...p };
}

function seqFetch(responses: { status: number; json: unknown }[]): jest.Mock {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json, text: async () => '' };
  }) as unknown as jest.Mock;
}

describe('callVideoModel — 分派', () => {
  it('vendor-task + minimax 描述符 → 两步取结果', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 'm1' } },
      { status: 200, json: { status: 'Success', file_id: 'f9' } },
      { status: 200, json: { file: { download_url: 'https://v/m.mp4' } } },
    ]);
    const s = settings({
      providers: [
        provider({ id: 'p1', protocol: 'vendor-task', vendorDescriptorId: 'minimax', baseUrl: 'https://api.minimax.com', defaultModel: 'video-model' }),
      ],
      capabilityDefaults: { video: { providerId: 'p1', modelId: 'video-model' } },
    });
    const res = await callVideoModel(s, { prompt: 'a cat', fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/m.mp4');
  });

  it('openai-videos 描述符 → 直接取 url', async () => {
    const fetchMock = seqFetch([
      { status: 200, json: { task_id: 't1' } },
      { status: 200, json: { status: 'succeeded', url: 'https://v/o.mp4' } },
    ]);
    const s = settings({
      providers: [
        provider({ id: 'p1', protocol: 'openai-videos', baseUrl: 'https://gw/v1', defaultModel: 'sora' }),
      ],
      capabilityDefaults: { video: { providerId: 'p1', modelId: 'sora' } },
    });
    const res = await callVideoModel(s, { prompt: 'a cat', fetchImpl: fetchMock });
    expect(res.url).toBe('https://v/o.mp4');
  });

  it('vendor-task 但描述符缺失 → 具名 ModelResolutionError', async () => {
    const s = settings({
      providers: [provider({ id: 'p1', protocol: 'vendor-task', vendorDescriptorId: 'ghost' })],
      capabilityDefaults: { video: { providerId: 'p1', modelId: 'm' } },
    });
    await expect(callVideoModel(s, { prompt: 'a cat' })).rejects.toThrow(/未知的描述符/);
  });
});
