/**
 * P3 单元测试：模型发现 / 连通性探测
 * 用 mock fetch 跑真实 /models 请求的分类、模型拉取、白名单、候选回退与缓存。
 */

import type { Capability, ProviderInstance } from '../../config/model-settings/types';

import {
  buildAuthHeaders,
  clearModelCache,
  fetchModels,
  probeProvider,
  type ProbeResult,
} from './discovery';

function provider(p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id' | 'capability' | 'protocol'>): ProviderInstance {
  return {
    label: p.id,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    authStyle: 'bearer',
    modelSource: 'auto',
    enabled: true,
    createdAt: 0,
    ...p,
  } as ProviderInstance;
}

interface MockResp {
  status: number;
  json?: unknown;
  throwNetwork?: boolean;
}

function jsonFetch(responses: MockResp[]): jest.Mock {
  let i = 0;
  return jest.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r.throwNetwork) throw new TypeError('Failed to fetch');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json ?? {},
    };
  }) as unknown as jest.Mock;
}

beforeEach(() => {
  clearModelCache();
});

describe('buildAuthHeaders', () => {
  it('bearer → Authorization: Bearer', async () => {
    const h = await buildAuthHeaders(provider({ id: 'p', capability: 'text', protocol: 'openai-chat' }));
    expect(h.headers['Authorization']).toBe('Bearer sk-test');
  });

  it('x-api-key → X-API-Key', async () => {
    const h = await buildAuthHeaders(provider({ id: 'p', capability: 'text', protocol: 'openai-chat', authStyle: 'x-api-key' }));
    expect(h.headers['X-API-Key']).toBe('sk-test');
  });

  it('query → api_key 进 query', async () => {
    const h = await buildAuthHeaders(provider({ id: 'p', capability: 'text', protocol: 'openai-chat', authStyle: 'query' }));
    expect(h.query['api_key']).toBe('sk-test');
  });

  it('vendor-task + ak/sk → 签 JWT-HS256 的 Bearer', async () => {
    const h = await buildAuthHeaders(
      provider({ id: 'p', capability: 'video', protocol: 'vendor-task', vendorDescriptorId: 'kling-official', accessKey: 'ak', secretKey: 'sk' })
    );
    expect(h.headers['Authorization']).toMatch(/^Bearer .+\..+\.+/);
  });

  it('extraHeaders / queryParams 透传', async () => {
    const h = await buildAuthHeaders(
      provider({ id: 'p', capability: 'text', protocol: 'openai-chat', extraHeaders: { 'X-Custom': '1' }, queryParams: { org: 'x' } })
    );
    expect(h.headers['X-Custom']).toBe('1');
    expect(h.query['org']).toBe('x');
  });
});

describe('probeProvider — 真实连通性探测', () => {
  async function probe(capability: Capability, resp: MockResp): Promise<ProbeResult> {
    const p = provider({ id: 'p', capability, protocol: capability === 'video' ? 'vendor-task' : 'openai-chat', vendorDescriptorId: 'kling-official' });
    return probeProvider(p, capability, { fetchImpl: jsonFetch([resp]) });
  }

  it('text 200 → ok', async () => {
    const r = await probe('text', { status: 200, json: { data: [] } });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('ok');
    expect(typeof r.latencyMs).toBe('number');
  });

  it('text 401 → auth 失败', async () => {
    const r = await probe('text', { status: 401 });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('auth');
  });

  it('text 404 → bad_request（baseUrl 可能不对）', async () => {
    const r = await probe('text', { status: 404 });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('bad_request');
  });

  it('image 404 → ok（无 /models 是常态，连通性已验证）', async () => {
    const r = await probe('image', { status: 404 });
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/不支持 \/models/);
  });

  it('video 404 → ok（连通性已验证）', async () => {
    const r = await probe('video', { status: 404 });
    expect(r.ok).toBe(true);
  });

  it('网络不通 → network', async () => {
    const r = await probe('text', { throwNetwork: true } as MockResp);
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('network');
  });

  it('429 → rate_limit', async () => {
    const r = await probe('text', { status: 429 });
    expect(r.kind).toBe('rate_limit');
  });

  it('5xx → server', async () => {
    const r = await probe('text', { status: 502 });
    expect(r.kind).toBe('server');
  });
});

describe('fetchModels — 模型拉取', () => {
  it('manual → 直接返回手填清单，不发请求', async () => {
    const fetchMock = jsonFetch([{ status: 200, json: { data: [{ id: 'should-not-be-used' }] } }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat', modelSource: 'manual', manualModels: ['my-model-a', 'my-model-b'] });
    const r = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r.source).toBe('manual');
    expect(r.models).toEqual(['my-model-a', 'my-model-b']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto text 200 → 返回模型列表，source auto', async () => {
    const fetchMock = jsonFetch([{ status: 200, json: { data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] } }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    const r = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r.models).toEqual(['gpt-4o', 'gpt-3.5-turbo']);
    expect(r.source).toBe('auto');
  });

  it('auto text 200（顶层数组形态）→ 同样抽取', async () => {
    const fetchMock = jsonFetch([{ status: 200, json: [{ id: 'a' }, { id: 'b' }] }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    const r = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r.models).toEqual(['a', 'b']);
  });

  it('auto text 404 → 无候选，报错', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    const r = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r.kind).toBe('bad_request');
    expect(r.models).toEqual([]);
  });

  it('auto image 404 → 回退 openai-images 候选', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'image', protocol: 'openai-images' });
    const r = await fetchModels(p, 'image', { fetchImpl: fetchMock });
    expect(r.source).toBe('candidate');
    expect(r.models).toEqual(expect.arrayContaining(['dall-e-3']));
  });

  it('auto tts 404 → 回退 openai-speech 候选', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'tts', protocol: 'openai-speech' });
    const r = await fetchModels(p, 'tts', { fetchImpl: fetchMock });
    expect(r.source).toBe('candidate');
    expect(r.models).toEqual(expect.arrayContaining(['tts-1']));
  });

  it('auto video vendor-task 404 → 回退描述符候选', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'video', protocol: 'vendor-task', vendorDescriptorId: 'kling-official' });
    const r = await fetchModels(p, 'video', { fetchImpl: fetchMock });
    expect(r.source).toBe('candidate');
    expect(r.models).toEqual(expect.arrayContaining(['kling-v2-6']));
  });

  it('auto openai-videos 404 → 回退协议级候选', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'video', protocol: 'openai-videos' });
    const r = await fetchModels(p, 'video', { fetchImpl: fetchMock });
    expect(r.source).toBe('candidate');
    expect(r.models).toEqual(expect.arrayContaining(['sora-1']));
  });

  it('image 401 → 回退候选并带鉴权提示', async () => {
    const fetchMock = jsonFetch([{ status: 401 }]);
    const p = provider({ id: 'p', capability: 'image', protocol: 'openai-images' });
    const r = await fetchModels(p, 'image', { fetchImpl: fetchMock });
    expect(r.source).toBe('candidate');
    expect(r.error).toMatch(/鉴权失败/);
  });

  it('modelFilter 白名单过滤 auto 结果', async () => {
    const fetchMock = jsonFetch([{ status: 200, json: { data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] } }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat', modelFilter: ['gpt-4o'] });
    const r = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r.models).toEqual(['gpt-4o']);
  });

  it('白名单也作用于候选回退', async () => {
    const fetchMock = jsonFetch([{ status: 404 }]);
    const p = provider({ id: 'p', capability: 'image', protocol: 'openai-images', modelFilter: ['dall-e-2'] });
    const r = await fetchModels(p, 'image', { fetchImpl: fetchMock });
    expect(r.models).toEqual(['dall-e-2']);
  });

  it('缓存命中：同凭据二次调用不重复请求', async () => {
    const fetchMock = jsonFetch([{ status: 200, json: { data: [{ id: 'a' }, { id: 'b' }] } }]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    const r1 = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r1.cached).toBeFalsy();
    const r2 = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r2.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh 忽略缓存', async () => {
    const fetchMock = jsonFetch([
      { status: 200, json: { data: [{ id: 'a' }] } },
      { status: 200, json: { data: [{ id: 'b' }] } },
    ]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    await fetchModels(p, 'text', { fetchImpl: fetchMock });
    const r2 = await fetchModels(p, 'text', { fetchImpl: fetchMock, forceRefresh: true });
    expect(r2.models).toEqual(['b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('凭据变更使缓存失效并重拉', async () => {
    const fetchMock = jsonFetch([
      { status: 200, json: { data: [{ id: 'a' }] } },
      { status: 200, json: { data: [{ id: 'b' }] } },
    ]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    await fetchModels(p, 'text', { fetchImpl: fetchMock });
    const p2 = { ...p, apiKey: 'sk-other' };
    const r2 = await fetchModels(p2, 'text', { fetchImpl: fetchMock });
    expect(r2.models).toEqual(['b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('按 providerId 精确清缓存', async () => {
    const fetchMock = jsonFetch([
      { status: 200, json: { data: [{ id: 'a' }] } },
      { status: 200, json: { data: [{ id: 'b' }] } },
    ]);
    const p = provider({ id: 'p', capability: 'text', protocol: 'openai-chat' });
    await fetchModels(p, 'text', { fetchImpl: fetchMock });
    clearModelCache('p');
    const r2 = await fetchModels(p, 'text', { fetchImpl: fetchMock });
    expect(r2.models).toEqual(['b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
