/**
 * 视觉一致性评分（新架构）
 * 配了文本提供方 → 走 callTextModel（多模态内容块）；未配置 → 启发式兜底。
 */

import { callTextModel } from '@/core/ai/text-client';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import { visualConsistencyScorer } from '@/core/services/video/visual-consistency-scorer-service';
import type { VisualConsistencyInput } from '@/core/services/video/visual-consistency-types';

jest.mock('@/core/ai/text-client', () => ({ callTextModel: jest.fn() }));

const mockText = callTextModel as jest.Mock;

function seedTextProvider() {
  localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      providers: [
        {
          id: 'txt1',
          label: 'VLM 中转',
          capability: 'text',
          protocol: 'openai-chat',
          baseUrl: 'https://relay.example.com/v1',
          apiKey: 'k',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 1,
          defaultModel: 'gpt-4o',
        },
      ],
      capabilityDefaults: {},
      slotBindings: {},
    })
  );
}

const input: VisualConsistencyInput = {
  frameUrls: ['https://frame/1.png'],
  characterReferences: [
    {
      characterId: 'c1',
      name: '林修',
      referencePrompt: '黑发少年 机械手臂',
      referenceImageUrls: { front: 'https://ref/front.png' },
    },
  ],
};

describe('visualConsistencyScorer（新架构）', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('配了文本提供方 → 走 callTextModel（多模态内容块）并解析分数', async () => {
    seedTextProvider();
    mockText.mockResolvedValue({ content: '87', model: 'gpt-4o' });

    const res = await visualConsistencyScorer.evaluate(input);

    expect(mockText).toHaveBeenCalledTimes(1);
    const messages = mockText.mock.calls[0][2];
    // 消息里应包含图片内容块（多模态）
    expect(JSON.stringify(messages)).toContain('image_url');
    expect(res.characterScores[0].score).toBe(87);
    expect(res.model).toBe('gpt-4o');
  });

  it('未配置文本提供方 → 启发式兜底（不调用 callTextModel）', async () => {
    const res = await visualConsistencyScorer.evaluate(input);

    expect(mockText).not.toHaveBeenCalled();
    expect(res.characterScores).toHaveLength(1);
    expect(res.characterScores[0].score).toBeGreaterThanOrEqual(0);
    expect(res.model).toBe('heuristic');
  });
});
