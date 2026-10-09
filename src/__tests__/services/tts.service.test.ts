/**
 * TTS 服务测试（新架构：只走 callTtsModel）
 */

import { callTtsModel } from '@/core/ai/tts-client';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import { ttsService, DEFAULT_TTS_CONFIG, TTS_VOICES } from '@/core/services';

jest.mock('@/core/ai/tts-client', () => ({ callTtsModel: jest.fn() }));

const mockTts = callTtsModel as jest.Mock;

function seedTtsProvider() {
  localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      providers: [
        {
          id: 'tts1',
          label: 'OpenAI 语音',
          capability: 'tts',
          protocol: 'openai-speech',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'k',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 1,
          defaultModel: 'tts-1',
        },
      ],
      capabilityDefaults: {},
      slotBindings: {},
    })
  );
}

describe('TTS Service', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('getVoices', () => {
    it('应该返回指定提供商的所有音色', () => {
      const voices = ttsService.getVoices('edge');
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0].provider).toBe('edge');
    });

    it('应该返回空数组当提供商不存在', () => {
      const voices = ttsService.getVoices('unknown' as never);
      expect(voices).toEqual([]);
    });
  });

  describe('getAllVoices', () => {
    it('应该返回所有提供商的音色', () => {
      const allVoices = ttsService.getAllVoices();
      expect(allVoices.length).toBeGreaterThan(0);
    });
  });

  describe('getVoiceById', () => {
    it('应该根据 ID 找到音色', () => {
      const voice = ttsService.getVoiceById('zh-CN-XiaoxiaoNeural');
      expect(voice).toBeDefined();
      expect(voice?.name).toBe('晓晓');
    });

    it('应该返回 undefined 当 ID 不存在', () => {
      expect(ttsService.getVoiceById('nonexistent')).toBeUndefined();
    });
  });

  describe('synthesize', () => {
    it('应该走新客户端（callTtsModel）并映射为 TTSResponse', async () => {
      seedTtsProvider();
      const audio = new ArrayBuffer(1000);
      mockTts.mockResolvedValue({ audio, contentType: 'audio/mpeg' });

      const response = await ttsService.synthesize({ text: '你好世界', config: DEFAULT_TTS_CONFIG });

      expect(mockTts).toHaveBeenCalledTimes(1);
      expect(mockTts.mock.calls[0][1]).toMatchObject({ input: '你好世界' });
      expect(response.audio).toBe(audio);
      expect(response.size).toBe(1000);
      expect(response.format).toBe('audio/mpeg');
      expect(response.duration).toBeGreaterThan(0);
    });

    it('应该在文本为空时抛出错误', async () => {
      await expect(
        ttsService.synthesize({ text: '', config: DEFAULT_TTS_CONFIG })
      ).rejects.toThrow('文本内容不能为空');
    });

    it('应该在文本只有空格时抛出错误', async () => {
      await expect(
        ttsService.synthesize({ text: '   ', config: DEFAULT_TTS_CONFIG })
      ).rejects.toThrow('文本内容不能为空');
    });
  });

  describe('streamSynthesize', () => {
    it('应该单块吐出音频', async () => {
      seedTtsProvider();
      mockTts.mockResolvedValue({ audio: new ArrayBuffer(500), contentType: 'audio/mpeg' });

      const chunks: unknown[] = [];
      for await (const chunk of ttsService.streamSynthesize({
        text: '你好世界',
        config: DEFAULT_TTS_CONFIG,
      })) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toHaveProperty('audio');
      expect(chunks[0]).toHaveProperty('isFinal', true);
    });
  });

  describe('cancelRequest', () => {
    it('应该能取消请求', () => {
      ttsService.cancelRequest('test-request'); // 不应该抛出错误
    });
  });
});

describe('TTS_VOICES', () => {
  it('应该包含 edge 音色', () => {
    expect(TTS_VOICES.edge.length).toBeGreaterThan(0);
  });

  it('edge 音色应该有正确属性', () => {
    const voice = TTS_VOICES.edge[0];
    expect(voice).toHaveProperty('id');
    expect(voice).toHaveProperty('name');
    expect(voice).toHaveProperty('gender');
    expect(voice).toHaveProperty('language');
    expect(voice).toHaveProperty('provider');
  });
});
