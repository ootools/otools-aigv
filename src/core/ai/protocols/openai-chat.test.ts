/**
 * P2a 单元测试：openai-chat 协议适配器（mock fetch 断言 URL / headers / body）
 */

import {
  OpenAIChatProtocolError,
  buildOpenAIChatBody,
  buildOpenAIChatHeaders,
  buildOpenAIChatUrl,
  callOpenAIChat,
  parseOpenAIChatResponse,
} from './openai-chat';

/** 构造一个最小可用的 fetch mock */
const makeFetch = (status: number, json: unknown, text = ''): jest.Mock =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => text,
  })) as unknown as jest.Mock;

describe('openai-chat adapter — 构造器', () => {
  it('buildOpenAIChatUrl 拼接并追加 query', () => {
    expect(buildOpenAIChatUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/chat/completions'
    );
    expect(buildOpenAIChatUrl('https://x/v1', { a: '1', b: '2' })).toBe(
      'https://x/v1/chat/completions?a=1&b=2'
    );
  });

  it('headers: bearer', () => {
    const h = buildOpenAIChatHeaders({
      baseUrl: 'x',
      apiKey: 'k',
      model: 'm',
      messages: [],
      authStyle: 'bearer',
    });
    expect(h['Authorization']).toBe('Bearer k');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('headers: x-api-key 不放 Authorization', () => {
    const h = buildOpenAIChatHeaders({
      baseUrl: 'x',
      apiKey: 'k',
      model: 'm',
      messages: [],
      authStyle: 'x-api-key',
    });
    expect(h['X-API-Key']).toBe('k');
    expect(h['Authorization']).toBeUndefined();
  });

  it('extraHeaders 追加且无 key 时不放 Authorization', () => {
    const h = buildOpenAIChatHeaders({
      baseUrl: 'x',
      apiKey: '',
      model: 'm',
      messages: [],
      extraHeaders: { 'X-Custom': 'v' },
    });
    expect(h['X-Custom']).toBe('v');
    expect(h['Authorization']).toBeUndefined();
  });

  it('buildOpenAIChatBody 只发 OpenAI 认识的字段', () => {
    const body = buildOpenAIChatBody({
      baseUrl: 'x',
      apiKey: 'k',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      maxTokens: 100,
      topP: 0.9,
    });
    expect(body).toEqual({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      max_tokens: 100,
      top_p: 0.9,
    });
  });

  it('parseOpenAIChatResponse 解析 choices / usage / model', () => {
    const r = parseOpenAIChatResponse({
      choices: [{ message: { content: 'hello' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      model: 'gpt-4o',
    });
    expect(r).toEqual({
      content: 'hello',
      model: 'gpt-4o',
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });
});

describe('openai-chat adapter — callOpenAIChat', () => {
  it('命中正确 URL / headers / body，并解析响应', async () => {
    const fetchMock = makeFetch(200, {
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      model: 'gpt-4o',
    });

    const res = await callOpenAIChat({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-x',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.7,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-x' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.temperature).toBe(0.7);

    expect(res.content).toBe('hi');
    expect(res.model).toBe('gpt-4o');
    expect(res.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });

  it('401 → auth 错误（携带 status）', async () => {
    const fetchMock = makeFetch(401, {}, 'unauthorized');
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'auth', status: 401 } satisfies Partial<OpenAIChatProtocolError>);
  });

  it('403 → auth 错误', async () => {
    const fetchMock = makeFetch(403, {}, 'forbidden');
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'auth', status: 403 });
  });

  it('429 → rate_limit', async () => {
    const fetchMock = makeFetch(429, {}, 'too many');
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('500 → server', async () => {
    const fetchMock = makeFetch(500, {}, 'boom');
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'server', status: 500 });
  });

  it('400 → bad_request', async () => {
    const fetchMock = makeFetch(400, {}, 'bad');
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
  });

  it('网络错误 → network', async () => {
    const fetchMock = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(
      callOpenAIChat({ baseUrl: 'x', apiKey: 'k', model: 'm', messages: [], fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('custom extraHeaders 透传', async () => {
    const fetchMock = makeFetch(200, { choices: [{ message: { content: 'ok' } }], model: 'm' });
    await callOpenAIChat({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      model: 'm',
      messages: [],
      extraHeaders: { 'X-Tenant': 't1' },
      fetchImpl: fetchMock,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'X-Tenant': 't1' });
  });
});
