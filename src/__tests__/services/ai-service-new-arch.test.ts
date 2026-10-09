/**
 * B2：aiService 文本链路已完全走新架构
 * - 配了文本提供方 → 走 callTextModel（openai-chat 单协议）
 * - 未配置 → 抛具名错误，不再回退到已删除的 providerRegistry / dispatchAIRequest
 */

import { callTextModel } from '@/core/ai/text-client';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import { aiService } from '@/core/services/ai/text/ai-service';

jest.mock('@/core/ai/text-client', () => ({ callTextModel: jest.fn() }));

const mockCallText = callTextModel as jest.Mock;

function seed(providers: unknown[]) {
  localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 2, providers, capabilityDefaults: {}, slotBindings: {} })
  );
}

describe('aiService 文本链路（B2）', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    aiService.setMockMode(false);
  });

  it('配置了文本提供方 → 走 callTextModel（新架构）', async () => {
    seed([
      {
        id: 'txt1',
        label: 'DeepSeek 官方',
        capability: 'text',
        protocol: 'openai-chat',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'k',
        authStyle: 'bearer',
        modelSource: 'auto',
        enabled: true,
        createdAt: 1,
        defaultModel: 'deepseek-chat',
      },
    ]);
    mockCallText.mockResolvedValue({ content: 'hello', model: 'deepseek-chat' });

    const out = await aiService.generate('你好', { model: 'hy3', provider: 'tencent', slot: 'util.fast' });

    expect(mockCallText).toHaveBeenCalledTimes(1);
    expect(out).toBe('hello');
  });

  it('未配置文本提供方 → 抛具名「未配置任何可用的文本提供方」（不再回退旧 registry）', async () => {
    seed([]);
    await expect(aiService.generate('你好', { model: 'hy3', provider: 'tencent' })).rejects.toThrow(
      /未配置任何可用的文本提供方/
    );
    expect(mockCallText).not.toHaveBeenCalled();
  });
});
