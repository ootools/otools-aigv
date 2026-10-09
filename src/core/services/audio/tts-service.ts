/**
 * TTS (Text-to-Speech) 服务门面（新架构）
 * =================================================================
 * 只走新架构：解析 tts 能力（槽位）→ `@/core/ai/tts-client` 的 `callTtsModel`（openai-speech）。
 *
 * 旧链路（Edge TTS 直连 + 5 家 stub provider 的 `SYNTHESIZE_REGISTRY` 路由）已**移除**；
 * 未配置可用 tts 提供方时由 `resolveModelRef` 抛出具名 `ModelResolutionError`。
 *
 * 本文件作为对外门面，保留原方法签名：
 *   getVoices / getAllVoices / getVoiceById / synthesize / streamSynthesize /
 *   cancelRequest / saveAudio，并顶层 export { ttsService, DEFAULT_TTS_CONFIG, TTS_VOICES }。
 */

import { DEFAULT_TTS_CONFIG } from './tts-types';
import { estimateDuration, saveAudio } from './tts-utils';
import { TTS_VOICES } from './tts-voices';

import type {
  TTSProvider,
  TTSVoice,
  TTSRequest,
  TTSResponse,
  TTSStreamChunk,
} from '@/common/types';
import { callTtsModel } from '@/core/ai/tts-client';
import { loadModelSettings } from '@/core/config/model-settings';


// 顶层常量导出（保持外部 import 路径不变）
export { DEFAULT_TTS_CONFIG, TTS_VOICES };

class TTSService {
  private abortControllers: Map<string, AbortController> = new Map();

  /** 获取指定 provider 的所有音色 */
  getVoices(provider: TTSProvider): TTSVoice[] {
    return TTS_VOICES[provider] || [];
  }

  /** 获取所有 provider 的全部音色（flat） */
  getAllVoices(): TTSVoice[] {
    return Object.values(TTS_VOICES).flat();
  }

  /** 按 ID 查找音色 */
  getVoiceById(id: string): TTSVoice | undefined {
    return this.getAllVoices().find((v) => v.id === id);
  }

  /**
   * 一次性合成语音（走新架构 openai-speech 适配器）。
   */
  async synthesize(request: TTSRequest): Promise<TTSResponse> {
    const { text, config, signal } = request;
    if (!text || text.trim().length === 0) {
      throw new Error('文本内容不能为空');
    }

    const modelSettings = await loadModelSettings();
    const res = await callTtsModel(modelSettings, {
      input: text,
      voice: config.voice,
      speed: config.speed,
      signal,
    });

    return {
      audio: res.audio,
      duration: estimateDuration(text, config.speed || 1),
      size: res.audio.byteLength,
      format: res.contentType ?? config.format,
    };
  }

  /**
   * 流式合成语音。
   * 新架构无真流式接口，故一次性合成后单块吐出（保持调用方 `for await` 语义不变）。
   */
  async *streamSynthesize(request: TTSRequest): AsyncGenerator<TTSStreamChunk> {
    const response = await this.synthesize(request);
    yield { audio: response.audio, isFinal: true };
  }

  /**
   * 取消指定请求（按 requestId abort fetch）
   */
  cancelRequest(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  /**
   * 保存音频到本地（浏览器下载）
   * 委托给 tts-utils.saveAudio
   */
  async saveAudio(audio: ArrayBuffer, filename: string): Promise<void> {
    saveAudio(audio, filename);
  }
}

export const ttsService = new TTSService();
export default ttsService;
