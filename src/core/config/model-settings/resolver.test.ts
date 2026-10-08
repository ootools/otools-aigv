/**
 * P2a 单元测试：模型引用解析（设计 §3.5 顺序）
 */

import { ModelResolutionError, resolveModelRef, resolveTextModelRef } from './resolver';
import type { Capability, ModelSettings, ProviderInstance, SlotId } from './types';

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
  return {
    schemaVersion: 2,
    providers: [],
    capabilityDefaults: {},
    slotBindings: {},
    ...p,
  };
}

describe('resolveModelRef — §3.5 解析顺序', () => {
  it('4. 全局能力默认：命中 capabilityDefaults', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', defaultModel: 'gpt-4o' })],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'gpt-4o-mini' } },
    });
    const { provider: pr, modelId } = resolveModelRef(s, 'text');
    expect(pr.id).toBe('p1');
    expect(modelId).toBe('gpt-4o-mini');
  });

  it('2. 全局槽位优先于 4. 能力默认', () => {
    const s = settings({
      providers: [
        provider({ id: 'p1', capability: 'text' }),
        provider({ id: 'p2', capability: 'text' }),
      ],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'm1' } },
      slotBindings: { 'util.fast': { slot: 'util.fast', capability: 'text', ref: { providerId: 'p2', modelId: 'm2' } } },
    });
    const { provider: pr, modelId } = resolveModelRef(s, 'text', { slot: 'util.fast' as SlotId });
    expect(pr.id).toBe('p2');
    expect(modelId).toBe('m2');
  });

  it('1. 项目级槽位优先于 2. 全局槽位', () => {
    const s = settings({
      providers: [
        provider({ id: 'p1', capability: 'text' }),
        provider({ id: 'p2', capability: 'text' }),
        provider({ id: 'p3', capability: 'text' }),
      ],
      slotBindings: { 'util.fast': { slot: 'util.fast', capability: 'text', ref: { providerId: 'p2', modelId: 'm2' } } },
    });
    const { provider: pr } = resolveModelRef(s, 'text', {
      slot: 'util.fast' as SlotId,
      projectOverride: { slotBindings: { 'util.fast': { providerId: 'p3', modelId: 'm3' } } },
    });
    expect(pr.id).toBe('p3');
  });

  it('3. 项目级能力默认优先于 4. 全局能力默认', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text' }), provider({ id: 'p2', capability: 'text' })],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'm1' } },
    });
    const { provider: pr } = resolveModelRef(s, 'text', {
      projectOverride: { capabilityDefaults: { text: { providerId: 'p2', modelId: 'm2' } } },
    });
    expect(pr.id).toBe('p2');
  });

  it('5. 无任何绑定/默认时，兜底到该能力第一个 enabled 且有 key 的实例', () => {
    const s = settings({
      providers: [
        provider({ id: 'disabled', capability: 'text', enabled: false, apiKey: 'k' }),
        provider({ id: 'nokey', capability: 'text', apiKey: '' }),
        provider({ id: 'good', capability: 'text', apiKey: 'k', defaultModel: 'fallback-model' }),
      ],
    });
    const { provider: pr, modelId } = resolveModelRef(s, 'text');
    expect(pr.id).toBe('good');
    expect(modelId).toBe('fallback-model');
  });

  it('ref 没有 modelId 时，回退 provider.defaultModel', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', defaultModel: 'gpt-4o' })],
      capabilityDefaults: { text: { providerId: 'p1' } },
    });
    const { modelId } = resolveModelRef(s, 'text');
    expect(modelId).toBe('gpt-4o');
  });

  it('6. 引用了不存在的 providerId → 抛出指名道姓的 ModelResolutionError', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text' })],
      capabilityDefaults: { text: { providerId: 'ghost', modelId: 'm' } },
    });
    expect(() => resolveModelRef(s, 'text')).toThrow(ModelResolutionError);
    try {
      resolveModelRef(s, 'text');
    } catch (e) {
      expect(e).toBeInstanceOf(ModelResolutionError);
      expect((e as ModelResolutionError).capability).toBe('text');
      expect((e as ModelResolutionError).message).toContain('ghost');
    }
  });

  it('provider 被禁用 → 抛错（而不是静默用禁用实例）', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', enabled: false })],
      capabilityDefaults: { text: { providerId: 'p1', modelId: 'm' } },
    });
    expect(() => resolveModelRef(s, 'text')).toThrow(/已禁用/);
  });

  it('6. 没有任何可用 text 提供方 → 抛错', () => {
    const s = settings({ providers: [provider({ id: 'img', capability: 'image' })] });
    expect(() => resolveModelRef(s as ModelSettings, 'text')).toThrow(ModelResolutionError);
  });

  it('resolveTextModelRef 走 text 能力', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', defaultModel: 'gpt-4o' })],
    });
    const { provider: pr, modelId } = resolveTextModelRef(s);
    expect(pr.capability).toBe<Capability>('text');
    expect(modelId).toBe('gpt-4o');
  });
});
