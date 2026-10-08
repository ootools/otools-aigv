/**
 * P2b 单元测试：openai-speech 协议适配器（mock fetch 断言 URL / headers / body，返回二进制）
 */

import {
  OpenAISpeechProtocolError,
  buildOpenAISpeechBody,
  buildOpenAISpeechHeaders,
  buildOpenAISpeechUrl,
  callOpenAISpeech,
} from './openai-speech';

const makeFetch = (status: number, arrayBuffer: ArrayBuffer, contentType = 'audio/mpeg') =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => arrayBuffer,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
  })) as unknown as jest.Mock;

describe('openai-speech adapter — 构造器', () => {
  it('URL 拼接', () => {
    expect(buildOpenAISpeechUrl('https://api.x/v1/')).toBe('https://api.x/v1/audio/speech');
  });

  it('headers: bearer', () => {
    expect(buildOpenAISpeechHeaders({ baseUrl: 'x', apiKey: 'k', model: 'm', input: 't', voice: 'v' })).toMatchObject({
      Authorization: 'Bearer k',
    });
  });

  it('body: input / voice / speed / response_format', () => {
    expect(
      buildOpenAISpeechBody({ baseUrl: 'x', apiKey: 'k', model: 'm', input: 'hi', voice: 'alloy', speed: 1.2, responseFormat: 'mp3' })
    ).toEqual({ model: 'm', input: 'hi', voice: 'alloy', speed: 1.2, response_format: 'mp3' });
  });
});

describe('openai-speech adapter — callOpenAISpeech', () => {
  it('命中 URL / body，并返回 ArrayBuffer + contentType', async () => {
    const buf = new ArrayBuffer(16);
    const fetchMock = makeFetch(200, buf, 'audio/mpeg');
    const res = await callOpenAISpeech({
      baseUrl: 'https://api.x/v1',
      apiKey: 'sk-x',
      model: 'tts-1',
      input: '你好',
      voice: 'alloy',
      fetchImpl: fetchMock,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.x/v1/audio/speech');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: 'tts-1', input: '你好', voice: 'alloy' });
    expect(res.audio.byteLength).toBe(16);
    expect(res.contentType).toBe('audio/mpeg');
  });

  it('403 → auth', async () => {
    const fetchMock = makeFetch(403, new ArrayBuffer(0));
    await expect(
      callOpenAISpeech({ baseUrl: 'x', apiKey: 'k', model: 'm', input: 't', voice: 'v', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'auth', status: 403 } satisfies Partial<OpenAISpeechProtocolError>);
  });

  it('429 → rate_limit', async () => {
    const fetchMock = makeFetch(429, new ArrayBuffer(0));
    await expect(
      callOpenAISpeech({ baseUrl: 'x', apiKey: 'k', model: 'm', input: 't', voice: 'v', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('网络错误 → network', async () => {
    const fetchMock = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(
      callOpenAISpeech({ baseUrl: 'x', apiKey: 'k', model: 'm', input: 't', voice: 'v', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
