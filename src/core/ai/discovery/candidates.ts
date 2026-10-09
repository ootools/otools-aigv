/**
 * 内置候选模型名清单（P3）
 * ===================================
 * 设计文档 §3.6：text/stt/embedding 调 `GET /models` 必发真请求；
 * image/tts 先试 /models，404/403 回退到「该协议的内置候选名清单」；
 * video 的候选名清单来自服务商描述符（见 vendor-task-descriptors.ts 的 candidateModels）。
 *
 * 这里只放「协议级」候选（image/tts 跨服务商通用、openai-videos 通用），
 * 因为它们不依赖具体服务商。video 各家差异大，候选挂在描述符上。
 *
 * 注意：候选清单只是「不支持 /models 时的兜底 + 编辑起点」，不再是模型真相来源
 * （真相来自真实 /models 拉取或用户手动填写）。
 */

/** openai-images 协议常见模型（DALL·E / GPT Image 系列） */
export const OPENAI_IMAGES_CANDIDATES: readonly string[] = ['dall-e-3', 'dall-e-2', 'gpt-image-1'];

/** openai-speech 协议常见模型（TTS 系列） */
export const OPENAI_SPEECH_CANDIDATES: readonly string[] = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'];

/** openai-videos（new-api / Sora 格式）通用候选 —— 实际应以 /models 为准，这里仅兜底 */
export const OPENAI_VIDEOS_CANDIDATES: readonly string[] = ['sora-1', 'sora-2', 'veo-2', 'kling-v2-6'];

/**
 * 按协议取「协议级」候选名清单（video 的协议级兜底；video 各家专属在描述符上）。
 * 返回 undefined 表示该协议没有协议级候选（例如需要具体描述符）。
 */
export function getProtocolCandidateModels(protocol: string): readonly string[] | undefined {
  switch (protocol) {
    case 'openai-images':
      return OPENAI_IMAGES_CANDIDATES;
    case 'openai-speech':
      return OPENAI_SPEECH_CANDIDATES;
    case 'openai-videos':
      return OPENAI_VIDEOS_CANDIDATES;
    default:
      return undefined;
  }
}
