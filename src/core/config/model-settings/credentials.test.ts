/**
 * P6 单元测试：凭据复制 / 继承
 */

import {
  applyCredentials,
  copyCredentials,
  extractCredentials,
  hasUsableCredentials,
  resolveEffectiveCredentials,
  withEffectiveCredentials,
} from './credentials';
import { resolveModelRef } from './resolver';
import type { ModelSettings, ProviderInstance } from './types';

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

describe('credentials — 复制 / 继承（P6）', () => {
  it('extractCredentials 抽出凭据字段', () => {
    const p = provider({
      id: 'p1',
      capability: 'text',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-x',
      extraHeaders: { 'X-A': '1' },
      accessKey: 'ak',
      secretKey: 'sk',
    });
    expect(extractCredentials(p)).toEqual({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-x',
      authStyle: 'bearer',
      extraHeaders: { 'X-A': '1' },
      queryParams: undefined,
      accessKey: 'ak',
      secretKey: 'sk',
    });
  });

  it('copyCredentials 一次性复制：覆盖凭据但保留身份 / 模型配置，且不建立继承', () => {
    const source = provider({
      id: 'src',
      capability: 'text',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-src',
      extraHeaders: { 'X-S': '1' },
    });
    const target = provider({ id: 'img', capability: 'image', baseUrl: 'https://old/v1', apiKey: '', defaultModel: 'flux' });

    const copied = copyCredentials(target, source);
    expect(copied.id).toBe('img');
    expect(copied.capability).toBe('image');
    expect(copied.defaultModel).toBe('flux');
    expect(copied.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(copied.apiKey).toBe('sk-src');
    expect(copied.extraHeaders).toEqual({ 'X-S': '1' });
    expect(copied.credentialSourceId).toBeUndefined();
  });

  it('applyCredentials 合并凭据字段（返回新对象）', () => {
    const p = provider({ id: 'p', capability: 'text', apiKey: '' });
    const merged = applyCredentials(p, {
      baseUrl: 'https://relay/v1',
      apiKey: 'sk-relay',
      authStyle: 'x-api-key',
    });
    expect(merged).not.toBe(p);
    expect(merged.apiKey).toBe('sk-relay');
    expect(merged.authStyle).toBe('x-api-key');
    expect(merged.id).toBe('p');
  });

  it('resolveEffectiveCredentials：跟随 credentialSourceId 继承源实例凭据', () => {
    const text = provider({ id: 'text', capability: 'text', baseUrl: 'https://relay/v1', apiKey: 'sk-relay' });
    const img = provider({ id: 'img', capability: 'image', baseUrl: '', apiKey: '', credentialSourceId: 'text' });
    const creds = resolveEffectiveCredentials(settings({ providers: [text, img] }), img);
    expect(creds.baseUrl).toBe('https://relay/v1');
    expect(creds.apiKey).toBe('sk-relay');
  });

  it('多级继承取链尾；成环时不死循环', () => {
    const a = provider({ id: 'a', capability: 'image', apiKey: '', credentialSourceId: 'b' });
    const b = provider({ id: 'b', capability: 'image', apiKey: '', credentialSourceId: 'c' });
    const c = provider({ id: 'c', capability: 'image', apiKey: 'sk-c', baseUrl: 'https://c/v1' });
    expect(resolveEffectiveCredentials(settings({ providers: [a, b, c] }), a).apiKey).toBe('sk-c');

    const x = provider({ id: 'x', capability: 'image', apiKey: '', credentialSourceId: 'y' });
    const y = provider({ id: 'y', capability: 'image', apiKey: '', credentialSourceId: 'x' });
    // 环内无有效凭据 → 落到链上实例自己的（空）key，不抛不挂
    expect(resolveEffectiveCredentials(settings({ providers: [x, y] }), x).apiKey).toBe('');
  });

  it('源不存在 → 优雅回退自己的凭据', () => {
    const p = provider({ id: 'p', capability: 'image', apiKey: 'sk-own', credentialSourceId: 'ghost' });
    expect(resolveEffectiveCredentials(settings({ providers: [p] }), p).apiKey).toBe('sk-own');
  });

  it('withEffectiveCredentials：无继承原样返回（保持引用），有继承返回合并后的新实例', () => {
    const text = provider({ id: 'text', capability: 'text', baseUrl: 'https://relay/v1', apiKey: 'sk-relay' });
    const own = provider({ id: 'own', capability: 'text' });
    const s = settings({ providers: [text, own] });
    expect(withEffectiveCredentials(s, own)).toBe(own);

    const img = provider({ id: 'img', capability: 'image', baseUrl: '', apiKey: '', credentialSourceId: 'text' });
    const merged = withEffectiveCredentials(s, img);
    expect(merged).not.toBe(img);
    expect(merged.apiKey).toBe('sk-relay');
    expect(merged.id).toBe('img');
  });

  it('hasUsableCredentials：自身无 key 但继承到 key → true', () => {
    const text = provider({ id: 'text', capability: 'text', apiKey: 'sk-relay' });
    const img = provider({ id: 'img', capability: 'image', apiKey: '', credentialSourceId: 'text' });
    const s = settings({ providers: [text, img] });
    expect(hasUsableCredentials(s, img)).toBe(true);
    expect(hasUsableCredentials(s, provider({ id: 'nokey', capability: 'image', apiKey: '' }))).toBe(false);
  });

  it('resolveModelRef 集成：兜底也会选中「靠继承拿到凭据」的实例，并套用继承凭据', () => {
    const text = provider({ id: 'text', capability: 'text', baseUrl: 'https://relay/v1', apiKey: 'sk-relay' });
    const img = provider({ id: 'img', capability: 'image', baseUrl: '', apiKey: '', credentialSourceId: 'text', defaultModel: 'flux' });
    const s = settings({ providers: [text, img] });

    const { provider: pr, modelId } = resolveModelRef(s, 'image');
    expect(pr.id).toBe('img');
    expect(pr.apiKey).toBe('sk-relay');
    expect(modelId).toBe('flux');
  });
});
