/**
 * P2b 集成测试：callTtsModel —— 解析 → openai-speech 适配器 → 应用 provider.defaults
 */

import type { ModelSettings, ProviderInstance } from '../config/model-settings/types';

import { OpenAISpeechProtocolError } from './protocols/openai-speech';
import { callTtsModel } from './tts-client';

function provider(p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id' | 'capability'>): ProviderInstance {
  return {
    label: p.id,
    protocol: 'openai-speech',
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

const makeFetch = (status: number, arrayBuffer: ArrayBuffer, contentType = 'audio/mpeg') =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => arrayBuffer,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  })) as unknown as jest.Mock;

describe('callTtsModel — 端到端', () => {
  it('用解析出的 provider，应用 defaults.voice 与 defaults.format → response_format', async () => {
    const buf = new ArrayBuffer(8);
    const fetchMock = makeFetch(200, buf, 'audio/mp3');
    const s = settings({
      providers: [
        provider({
          id: 'p1',
          capability: 'tts',
          baseUrl: 'https://tts.api/v1',
          apiKey: 'sk-tts',
          defaultModel: 'tts-1',
          defaults: { voice: 'alloy', format: 'mp3', speed: 1.1 },
        }),
      ],
      capabilityDefaults: { tts: { providerId: 'p1', modelId: 'tts-1' } },
    });

    const res = await callTtsModel(s, { input: '你好', fetchImpl: fetchMock });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://tts.api/v1/audio/speech');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-tts' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: 'tts-1', input: '你好', voice: 'alloy', speed: 1.1, response_format: 'mp3' });
    expect(res.audio.byteLength).toBe(8);
  });

  it('options 的 voice 覆盖 defaults.voice', async () => {
    const fetchMock = makeFetch(200, new ArrayBuffer(4));
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'tts', defaults: { voice: 'alloy' } })],
      capabilityDefaults: { tts: { providerId: 'p1', modelId: 'm' } },
    });
    await callTtsModel(s, { input: 'hi', voice: 'nova', fetchImpl: fetchMock });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.voice).toBe('nova');
  });

  it('上游 401 → 透传 OpenAISpeechProtocolError', async () => {
    const fetchMock = makeFetch(401, new ArrayBuffer(0));
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'tts', apiKey: 'bad' })],
      capabilityDefaults: { tts: { providerId: 'p1', modelId: 'm' } },
    });
    await expect(callTtsModel(s, { input: 'hi', fetchImpl: fetchMock })).rejects.toBeInstanceOf(
      OpenAISpeechProtocolError
    );
  });
});
