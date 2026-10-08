/**
 * P2a 集成测试：callTextModel —— 解析 → openai-chat 适配器 → 映射 AIResponse
 * 用 mock fetch 验证实际打出去的 URL / 鉴权头 / 模型名，并验证错误透传。
 */

import type { ModelSettings, ProviderInstance } from '../config/model-settings/types';

import { OpenAIChatProtocolError } from './protocols/openai-chat';
import { callTextModel, toAIResponse } from './text-client';

function provider(p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id' | 'capability'>): ProviderInstance {
  return {
    label: p.id,
    protocol: 'openai-chat',
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

const makeFetch = (status: number, json: unknown): jest.Mock =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => '',
  })) as unknown as jest.Mock;

describe('callTextModel — 端到端', () => {
  it('解析出 provider 的 baseUrl/key 打给 openai-chat，并返回 AIResponse', async () => {
    const fetchMock = makeFetch(200, {
      choices: [{ message: { content: '你好' } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
      model: 'gpt-4o-mini',
    });
    const s = settings({
      providers: [
        provider({ id: 'p1', capability: 'text', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds', defaultModel: 'deepseek-chat' }),
      ],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'deepseek-chat' } },
    });

    const res = await callTextModel(
      s,
      'text',
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.7, fetchImpl: fetchMock }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-ds' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('deepseek-chat');

    expect(res).toEqual({
      content: '你好',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
    });
  });

  it('槽位解析：命中 slotBinding 而不是能力默认', async () => {
    const fetchMock = makeFetch(200, { choices: [{ message: { content: 'x' } }], model: 'm' });
    const s = settings({
      providers: [
        provider({ id: 'p1', capability: 'text', baseUrl: 'https://a/v1', apiKey: 'k1' }),
        provider({ id: 'p2', capability: 'text', baseUrl: 'https://b/v1', apiKey: 'k2' }),
      ],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'm1' } },
      slotBindings: { 'util.fast': { slot: 'util.fast', capability: 'text', ref: { providerId: 'p2', modelId: 'm2' } } },
    });

    await callTextModel(s, 'text', [{ role: 'user', content: 'hi' }], {
      slot: 'util.fast',
      fetchImpl: fetchMock,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://b/v1/chat/completions');
  });

  it('modelIdOverride 覆盖解析出的模型', async () => {
    const fetchMock = makeFetch(200, { choices: [{ message: { content: 'x' } }], model: 'override' });
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', baseUrl: 'https://a/v1', apiKey: 'k', defaultModel: 'default-m' })],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'default-m' } },
    });

    await callTextModel(s, 'text', [{ role: 'user', content: 'hi' }], {
      modelIdOverride: 'override-m',
      fetchImpl: fetchMock,
    });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('override-m');
  });

  it('上游 401 → 透传 OpenAIChatProtocolError（auth），不静默吞掉', async () => {
    const fetchMock = makeFetch(401, {});
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', apiKey: 'bad' })],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'm' } },
    });
    await expect(
      callTextModel(s, 'text', [{ role: 'user', content: 'hi' }], { fetchImpl: fetchMock })
    ).rejects.toBeInstanceOf(OpenAIChatProtocolError);
  });

  it('toAIResponse：无 usage 时 usage 为 undefined', () => {
    expect(toAIResponse({ content: 'c', model: 'm' })).toEqual({ content: 'c', model: 'm' });
  });
});
