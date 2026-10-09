/**
 * P9 单元测试：提供方模板（网关优先）
 */

import { PROVIDER_PRESETS, applyProviderPreset, getProviderPreset } from './presets';
import type { ProviderInstance } from './types';

function provider(
  p: Partial<ProviderInstance> & Pick<ProviderInstance, 'id' | 'capability'>
): ProviderInstance {
  return {
    label: p.id,
    protocol: 'openai-chat',
    baseUrl: 'https://old/v1',
    apiKey: '',
    authStyle: 'bearer',
    modelSource: 'auto',
    enabled: true,
    createdAt: 0,
    ...p,
  };
}

describe('provider presets（P9 网关优先）', () => {
  it('AI Switch 网关模板排第一且标记 isGateway', () => {
    expect(PROVIDER_PRESETS[0].id).toBe('ai-switch');
    expect(PROVIDER_PRESETS[0].isGateway).toBe(true);
  });

  it('applyProviderPreset：按能力给协议 + 置 isGateway + 建议名称', () => {
    const gw = getProviderPreset('ai-switch')!;

    const text = applyProviderPreset(provider({ id: 'p', capability: 'text', label: '' }), gw);
    expect(text.protocol).toBe('openai-chat');
    expect(text.isGateway).toBe(true);
    expect(text.label).toBe('AI Switch 网关');

    const img = applyProviderPreset(provider({ id: 'p', capability: 'image', label: '' }), gw);
    expect(img.protocol).toBe('openai-images');

    const vid = applyProviderPreset(provider({ id: 'p', capability: 'video', label: '' }), gw);
    expect(vid.protocol).toBe('openai-videos');
  });

  it('已填名称不被模板覆盖；非网关模板清掉 isGateway', () => {
    const ds = getProviderPreset('deepseek')!;
    const p = applyProviderPreset(
      provider({ id: 'p', capability: 'text', label: '我的实例', isGateway: true }),
      ds
    );
    expect(p.label).toBe('我的实例');
    expect(p.isGateway).toBe(false);
    expect(p.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(p.protocol).toBe('openai-chat');
  });

  it('ollama 模板鉴权 none；自定义模板清空 baseUrl', () => {
    const ollama = getProviderPreset('ollama')!;
    expect(applyProviderPreset(provider({ id: 'p', capability: 'text' }), ollama).authStyle).toBe(
      'none'
    );

    const custom = getProviderPreset('custom')!;
    expect(applyProviderPreset(provider({ id: 'p', capability: 'text' }), custom).baseUrl).toBe('');
  });
});
