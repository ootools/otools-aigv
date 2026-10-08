/**
 * P2b 单元测试：openai-images 协议适配器（mock fetch 断言 URL / headers / body + 字段映射）
 */

import {
  OpenAIImagesProtocolError,
  buildOpenAIImagesBody,
  buildOpenAIImagesHeaders,
  buildOpenAIImagesUrl,
  callOpenAIImages,
  parseOpenAIImagesResponse,
} from './openai-images';

const makeFetch = (status: number, json: unknown, text = '') =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => text,
  })) as unknown as jest.Mock;

describe('openai-images adapter — 构造器 + 字段映射', () => {
  it('URL 拼接 + query', () => {
    expect(buildOpenAIImagesUrl('https://api.x/v1/')).toBe('https://api.x/v1/images/generations');
    expect(buildOpenAIImagesUrl('https://api.x/v1', { a: '1' })).toBe(
      'https://api.x/v1/images/generations?a=1'
    );
  });

  it('headers: x-api-key 不放 Authorization', () => {
    const h = buildOpenAIImagesHeaders({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', authStyle: 'x-api-key' });
    expect(h['X-API-Key']).toBe('k');
    expect(h['Authorization']).toBeUndefined();
  });

  it('size 默认映射', () => {
    expect(buildOpenAIImagesBody({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', size: '1024x1024', n: 1 })).toEqual({
      model: 'm',
      prompt: 'p',
      n: 1,
      size: '1024x1024',
    });
  });

  it('width/height 存在时覆盖 size', () => {
    expect(
      buildOpenAIImagesBody({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', size: '1024x1024', width: 512, height: 512 })
    ).toEqual({ model: 'm', prompt: 'p', width: 512, height: 512 });
  });

  it('negativePrompt → negative_prompt', () => {
    expect(
      buildOpenAIImagesBody({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', negativePrompt: 'blur' })
    ).toMatchObject({ negative_prompt: 'blur' });
  });

  it('parseOpenAIImagesResponse 解析 url / b64', () => {
    expect(
      parseOpenAIImagesResponse({ created: 1, data: [{ url: 'u' }, { b64_json: 'b' }] })
    ).toEqual({ created: 1, images: [{ url: 'u' }, { b64Json: 'b' }] });
  });
});

describe('openai-images adapter — callOpenAIImages', () => {
  it('命中 URL / headers / body，并解析', async () => {
    const fetchMock = makeFetch(200, { created: 2, data: [{ url: 'https://img/x.png' }] });
    const res = await callOpenAIImages({
      baseUrl: 'https://api.x/v1',
      apiKey: 'sk-x',
      model: 'dall-e-3',
      prompt: 'a cat',
      size: '1024x1024',
      fetchImpl: fetchMock,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.x/v1/images/generations');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-x' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: 'dall-e-3', prompt: 'a cat', size: '1024x1024' });
    expect(res.images[0]?.url).toBe('https://img/x.png');
  });

  it('401 → auth', async () => {
    const fetchMock = makeFetch(401, {}, 'unauthorized');
    await expect(
      callOpenAIImages({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'auth', status: 401 } satisfies Partial<OpenAIImagesProtocolError>);
  });

  it('429 → rate_limit', async () => {
    const fetchMock = makeFetch(429, {}, 'too many');
    await expect(
      callOpenAIImages({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'rate_limit', status: 429 });
  });

  it('500 → server', async () => {
    const fetchMock = makeFetch(500, {}, 'boom');
    await expect(
      callOpenAIImages({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'server', status: 500 });
  });

  it('400 → bad_request', async () => {
    const fetchMock = makeFetch(400, {}, 'bad');
    await expect(
      callOpenAIImages({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
  });

  it('网络错误 → network', async () => {
    const fetchMock = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(
      callOpenAIImages({ baseUrl: 'x', apiKey: 'k', model: 'm', prompt: 'p', fetchImpl: fetchMock })
    ).rejects.toMatchObject({ kind: 'network' });
  });
});
