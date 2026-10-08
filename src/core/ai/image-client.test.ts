/**
 * P2b 集成测试：callImageModel —— 解析 → openai-images 适配器 → 应用 provider.defaults
 */

import type { ModelSettings, ProviderInstance } from '../config/model-settings/types';

import { callImageModel } from './image-client';
import { OpenAIImagesProtocolError } from './protocols/openai-images';

function provider(p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id' | 'capability'>): ProviderInstance {
  return {
    label: p.id,
    protocol: 'openai-images',
    baseUrl: 'https://example.com/v1',
    apiKey: 'sk-test',
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

const makeFetch = (status: number, json: unknown) =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => '',
  })) as unknown as jest.Mock;

describe('callImageModel — 端到端', () => {
  it('用解析出的 provider baseUrl/key，并应用 defaults.size', async () => {
    const fetchMock = makeFetch(200, { data: [{ url: 'https://img/x.png' }] });
    const s = settings({
      providers: [
        provider({
          id: 'p1',
          capability: 'image',
          baseUrl: 'https://img.api/v1',
          apiKey: 'sk-img',
          defaultModel: 'dall-e-3',
          defaults: { size: '1792x1024', n: 2 },
        }),
      ],
      capabilityDefaults: { image: { providerId: 'p1', modelId: 'dall-e-3' } },
    });

    const res = await callImageModel(s, { prompt: 'a cat', fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://img.api/v1/images/generations');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-img' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: 'dall-e-3', prompt: 'a cat', n: 2, size: '1792x1024' });
    expect(res.images[0]?.url).toBe('https://img/x.png');
  });

  it('options 的 width/height 覆盖 defaults.size', async () => {
    const fetchMock = makeFetch(200, { data: [{ url: 'u' }] });
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'image', defaults: { size: '1024x1024' } })],
      capabilityDefaults: { image: { providerId: 'p1', modelId: 'm' } },
    });
    await callImageModel(s, { prompt: 'p', width: 512, height: 512, fetchImpl: fetchMock });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ model: 'm', prompt: 'p', width: 512, height: 512 });
  });

  it('上游 401 → 透传 OpenAIImagesProtocolError', async () => {
    const fetchMock = makeFetch(401, {});
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'image', apiKey: 'bad' })],
      capabilityDefaults: { image: { providerId: 'p1', modelId: 'm' } },
    });
    await expect(callImageModel(s, { prompt: 'p', fetchImpl: fetchMock })).rejects.toBeInstanceOf(
      OpenAIImagesProtocolError
    );
  });
});
