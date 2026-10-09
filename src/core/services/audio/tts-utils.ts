/**
 * TTS 通用工具函数
 *
 * 新架构下 TTS 统一走 `@/core/ai/tts-client`（openai-speech），旧的
 * Edge 直连实现（及其依赖的 escapeSSML / splitText）已移除，故这里只保留：
 *   - estimateDuration()   文本时长估算（中英文加权）
 *   - saveAudio()          浏览器端 ArrayBuffer → 下载文件
 */

/**
 * 估算音频时长（秒）
 * 经验值：中文每字 0.3s、英文每词 0.2s，最终除以 speed。
 */
export function estimateDuration(text: string, speed: number): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;

  const baseDuration = chineseChars * 0.3 + englishWords * 0.2;
  return baseDuration / speed;
}

/**
 * 浏览器端把 ArrayBuffer 音频数据保存为本地下载文件。
 * 通过 Blob + URL.createObjectURL + 临时 <a> 元素触发下载。
 */
export function saveAudio(audio: ArrayBuffer, filename: string): void {
  const blob = new Blob([audio], { type: 'audio/mp3' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
