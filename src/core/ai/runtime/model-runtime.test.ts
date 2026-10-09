/**
 * P5 单元测试：模型运行时（槽位 → 提供方 / 模型 解析）
 *
 * 设计 §3.5 + 类型层 `capabilityForSlot`：把「槽位」语义收敛到一个入口，
 * 供 MasterDirectorAgent 按槽位解析并打日志、供服务层按 slot 调 LLM。
 */

import { resolveSlotModel, resolveSlotModelSafe } from './model-runtime';

import { ModelResolutionError } from '@/core/config/model-settings/resolver';
import type { ModelSettings, ProviderInstance, SlotId } from '@/core/config/model-settings/types';

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

describe('model-runtime — 槽位解析', () => {
  it('script.ingest 映射到 text 能力并按槽位绑定解析', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text', defaultModel: 'gpt-4o' })],
      slotBindings: {
        'script.ingest': { slot: 'script.ingest', capability: 'text', ref: { providerId: 'p1', modelId: 'gpt-4o-mini' } },
      },
    });
    const r = resolveSlotModel(s, 'script.ingest');
    expect(r.capability).toBe('text');
    expect(r.provider.id).toBe('p1');
    expect(r.modelId).toBe('gpt-4o-mini');
  });

  it('项目级覆盖优先于全局槽位绑定（P6）', () => {
    const s = settings({
      providers: [provider({ id: 'p1', capability: 'text' }), provider({ id: 'p2', capability: 'text' })],
      slotBindings: {
        'script.ingest': { slot: 'script.ingest', capability: 'text', ref: { providerId: 'p1', modelId: 'm1' } },
      },
    });
    const r = resolveSlotModel(s, 'script.ingest', {
      projectOverride: { slotBindings: { 'script.ingest': { providerId: 'p2', modelId: 'm2' } } },
    });
    expect(r.provider.id).toBe('p2');
    expect(r.modelId).toBe('m2');
  });

  it('storyboard.image → image，video.generate → video，audio.tts → tts', () => {
    const s = settings({
      providers: [
        provider({ id: 'img', capability: 'image' }),
        provider({ id: 'vid', capability: 'video' }),
        provider({ id: 'tts', capability: 'tts' }),
      ],
      slotBindings: {
        'storyboard.image': { slot: 'storyboard.image', capability: 'image', ref: { providerId: 'img' } },
        'video.generate': { slot: 'video.generate', capability: 'video', ref: { providerId: 'vid' } },
        'audio.tts': { slot: 'audio.tts', capability: 'tts', ref: { providerId: 'tts' } },
      },
    });
    expect(resolveSlotModel(s, 'storyboard.image').capability).toBe('image');
    expect(resolveSlotModel(s, 'video.generate').capability).toBe('video');
    expect(resolveSlotModel(s, 'audio.tts').capability).toBe('tts');
  });

  it('util.fast 与未显式列举的默认槽位归 text', () => {
    const s = settings({
      providers: [provider({ id: 'fast', capability: 'text' })],
      slotBindings: { 'util.fast': { slot: 'util.fast', capability: 'text', ref: { providerId: 'fast' } } },
    });
    expect(resolveSlotModel(s, 'util.fast').capability).toBe('text');
    expect(resolveSlotModel(s, 'script.rewrite' as SlotId).capability).toBe('text');
  });

  it('resolveSlotModelSafe：无设置 / 无槽位 / 无任何提供方时返回 null（不抛）', () => {
    expect(resolveSlotModelSafe(null, 'script.ingest')).toBeNull();
    expect(resolveSlotModelSafe(settings(), undefined)).toBeNull();
    // 没有任何提供方时，即便给了槽位也无法解析 → 返回 null 而非抛错
    expect(resolveSlotModelSafe(settings({ providers: [] }), 'script.ingest')).toBeNull();
  });

  it('resolveSlotModel：槽位无可用提供方抛具名 ModelResolutionError', () => {
    const s = settings({ providers: [provider({ id: 'img', capability: 'image' })] });
    expect(() => resolveSlotModel(s, 'script.ingest')).toThrow(ModelResolutionError);
  });
});
