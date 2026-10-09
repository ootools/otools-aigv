/**
 * B1：图像 / 视频 / 语音服务「接新客户端」验证
 * 配了新架构的 image / video / tts 提供方实例时，旧服务入口应改走新统一客户端，
 * 并把新客户端的返回映射回旧返回类型。（未配置时回退旧链路由既有测试覆盖。）
 */

import { callImageModel } from '@/core/ai/image-client';
import { callTtsModel } from '@/core/ai/tts-client';
import { callVideoModel } from '@/core/ai/video-client';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import { generateImage, generateVideo } from '@/core/services/ai/image/image-generation-service';
import { DEFAULT_TTS_CONFIG , ttsService } from '@/core/services/audio/tts-service';

jest.mock('@/core/ai/image-client', () => ({ callImageModel: jest.fn() }));
jest.mock('@/core/ai/video-client', () => ({ callVideoModel: jest.fn() }));
jest.mock('@/core/ai/tts-client', () => ({ callTtsModel: jest.fn() }));

const mockImage = callImageModel as jest.Mock;
const mockVideo = callVideoModel as jest.Mock;
const mockTts = callTtsModel as jest.Mock;

function provider(id: string, capability: 'image' | 'video' | 'tts', protocol: string) {
  return {
    id,
    label: `${capability}-${id}`,
    capability,
    protocol,
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
    authStyle: 'bearer',
    modelSource: 'auto',
    enabled: true,
    createdAt: 1,
    defaultModel: `${capability}-model`,
  };
}

function seed(providers: unknown[]) {
  localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 2, providers, capabilityDefaults: {}, slotBindings: {} })
  );
}

describe('媒体服务接新客户端（B1）', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('generateImage：配了 image 实例 → 走 callImageModel 并映射结果', async () => {
    seed([provider('img1', 'image', 'openai-images')]);
    mockImage.mockResolvedValue({ images: [{ url: 'https://cdn/1.png' }] });

    const res = await generateImage('一只赛博朋克猫', { size: '2K' });

    expect(mockImage).toHaveBeenCalledTimes(1);
    const [settingsArg, optsArg] = mockImage.mock.calls[0];
    expect(settingsArg.providers).toHaveLength(1);
    expect(optsArg).toMatchObject({ prompt: '一只赛博朋克猫', size: '2K' });
    expect(res.url).toBe('https://cdn/1.png');
    expect(res.width).toBe(2048);
    expect(res.height).toBe(2048);
  });

  it('generateVideo：配了 video 实例 → 走 callVideoModel 并把 succeeded 映射为 completed', async () => {
    seed([provider('vid1', 'video', 'openai-videos')]);
    mockVideo.mockResolvedValue({ status: 'succeeded', url: 'https://cdn/v.mp4' });

    const res = await generateVideo('镜头推进', { duration: 6 });

    expect(mockVideo).toHaveBeenCalledTimes(1);
    expect(mockVideo.mock.calls[0][1]).toMatchObject({ prompt: '镜头推进', durationSec: 6 });
    expect(res.url).toBe('https://cdn/v.mp4');
    expect(res.status).toBe('completed');
  });

  it('ttsService.synthesize：配了 tts 实例 → 走 callTtsModel 并映射 TTSResponse', async () => {
    seed([provider('tts1', 'tts', 'openai-speech')]);
    const audio = new ArrayBuffer(8);
    mockTts.mockResolvedValue({ audio, contentType: 'audio/mpeg' });

    const res = await ttsService.synthesize({ text: '你好世界', config: { ...DEFAULT_TTS_CONFIG } });

    expect(mockTts).toHaveBeenCalledTimes(1);
    expect(mockTts.mock.calls[0][1]).toMatchObject({ input: '你好世界' });
    expect(res.audio).toBe(audio);
    expect(res.size).toBe(8);
    expect(res.format).toBe('audio/mpeg');
    expect(res.duration).toBeGreaterThan(0);
  });
});
