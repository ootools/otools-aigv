/**
 * MasterDirectorAgent P5 测试：调度子 Agent 前按槽位解析，并在日志里打出
 * 实际调用的提供方 / 模型（验收：换 provider 后日志可见实际用的是哪家）。
 */

import { saveModelSettings } from '@/core/config/model-settings/store';
import type { ModelSettings, ProviderInstance } from '@/core/config/model-settings/types';
import { MasterDirectorAgent } from '@/core/services/agent/MasterDirectorAgent';

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

describe('MasterDirectorAgent — P5 按槽位解析并打日志', () => {
  it('调度子 Agent 前，日志里应出现该槽位实际绑定的提供方', async () => {
    await saveModelSettings(
      settings({
        providers: [
          provider({ id: 'deepseek', label: 'DeepSeek 官方', capability: 'text', defaultModel: 'deepseek-chat' }),
        ],
        slotBindings: {
          'script.ingest': { slot: 'script.ingest', capability: 'text', ref: { providerId: 'deepseek', modelId: 'deepseek-chat' } },
        },
      })
    );

    const director = new MasterDirectorAgent('【第一章】林修站在楼顶。', 'novel_text', 'P5 槽位日志测试');
    const blackboard = director.getBlackboard();
    await director.execute();

    const logs = blackboard.getData().logs;
    const hit = logs.find((l) => l.action.includes('script.ingest') && l.action.includes('DeepSeek 官方'));
    expect(hit).toBeDefined();
    // 验收点：实际调用的模型也一并暴露
    expect(hit?.action).toContain('deepseek-chat');
  });

  it('槽位未配置可用提供方时，打 warn 而非阻断调度', async () => {
    // 只配了 image 提供方，text 槽位（script.ingest 等）解析不到 → 应告警但仍完成
    await saveModelSettings(settings({ providers: [provider({ id: 'img', capability: 'image' })] }));

    const director = new MasterDirectorAgent('某剧本正文', 'script_text', 'P5 未配置 warn 测试');
    const blackboard = director.getBlackboard();
    await director.execute();

    const logs = blackboard.getData().logs;
    expect(logs.some((l) => l.level === 'warn' && l.action.includes('未解析到可用提供方'))).toBe(true);
    expect(blackboard.getData().stage).toBe('completed');
  });
});
