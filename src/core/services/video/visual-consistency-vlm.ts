/**
 * VLM 驱动的视觉一致性评分
 * @module core/services/video/visual-consistency-vlm
 *
 * 提取自原 VisualConsistencyScorer.compareFrameWithReference + evaluateWithVLM。
 * 行为字节级一致：单帧 prompt 拼接 + VLM 调用 + 整数解析 + 失败兜底。
 */

import { evaluateByPromptMatch } from './visual-consistency-heuristic';
import {
  NO_REFERENCE_NOTE,
  VLM_FALLBACK_SCORE,
  pickScoreNotes,
  buildConsistencyResult,
  type CharacterConsistencyScore,
  type VisualConsistencyInput,
  type VisualConsistencyResult,
} from './visual-consistency-types';

import type { OpenAIChatContentPart, OpenAIChatMessage } from '@/core/ai/protocols/openai-chat';
import { callTextModel } from '@/core/ai/text-client';
import { resolveModelRef } from '@/core/config/model-settings/resolver';
import type { ModelSettings } from '@/core/config/model-settings/types';
import type { CharacterVideoRef } from '@/core/services/ai/image/image-generation/types';


/** VLM 评估 prompt 模板（与原 compareFrameWithReference 内联字符串字节级一致） */
const VLM_PROMPT_TEMPLATE = `You are a visual consistency evaluator for anime/comic characters.

Reference images show the character's official appearance (front view and full body).
Test image is a frame from an animated video.

Your task: Judge whether the character in the test image matches the reference character's appearance.

Rate consistency on a scale of 0-100:
- 90-100: Character clearly matches, same hair, eyes, clothing, overall style
- 70-89: Character mostly matches, minor differences (lighting, pose)
- 50-69: Partial match, some features different (hair color, outfit changed)
- 30-49: Poor match, significant differences
- 0-29: Different character entirely

Character reference: __CHAR_DESC__

Respond ONLY with a single integer between 0-100. No explanation.`;

/** 构造 VLM 评估 prompt */
function buildVlmPrompt(characterDesc: string): string {
  return VLM_PROMPT_TEMPLATE.replace('__CHAR_DESC__', characterDesc);
}

/** 从 VLM 文本响应中提取 0-100 整数（与原 parseInt + replace + clamp 字节级一致） */
function parseVlmScore(text: string): number {
  const cleaned = text.trim().replace(/[^0-9]/g, '');
  const score = parseInt(cleaned, 10);
  if (isNaN(score)) return VLM_FALLBACK_SCORE;
  return Math.max(0, Math.min(100, score));
}

/** 构造参考图内容块列表 */
function buildReferenceImages(referenceUrls: string[], charName: string): OpenAIChatContentPart[] {
  return referenceUrls.flatMap((url, i): OpenAIChatContentPart[] => [
    { type: 'text', text: `Reference image ${i + 1} (character: ${charName}):` },
    { type: 'image_url', image_url: { url, detail: 'low' } },
  ]);
}

/**
 * 用 VLM 比较单帧与参考图一致性
 *
 * 走新架构：`callTextModel`（openai-chat 单协议，支持多模态内容块），
 * 槽位 `util.fast`（杂活 → 便宜小模型）；解析失败兜底 `VLM_FALLBACK_SCORE`。
 */
export async function compareFrameWithReference(
  settings: ModelSettings,
  frameUrl: string,
  referenceUrls: string[],
  charRef: CharacterVideoRef
): Promise<number> {
  const characterDesc = charRef.referencePrompt || charRef.name;
  const prompt = buildVlmPrompt(characterDesc);

  const content: OpenAIChatContentPart[] = [
    ...buildReferenceImages(referenceUrls, charRef.name),
    { type: 'text', text: `\nTest image (evaluate consistency):` },
    { type: 'image_url', image_url: { url: frameUrl, detail: 'low' } },
  ];
  const messages: OpenAIChatMessage[] = [
    { role: 'user', content },
    { role: 'user', content: prompt },
  ];

  try {
    const response = await callTextModel(settings, 'text', messages, { slot: 'util.fast' });
    return parseVlmScore(response.content);
  } catch {
    return VLM_FALLBACK_SCORE;
  }
}

/** 提取角色参考图（front / fullBody 优先） */
function getReferenceUrls(charRef: CharacterVideoRef): string[] {
  return [charRef.referenceImageUrls?.front, charRef.referenceImageUrls?.fullBody].filter(
    (u): u is string => !!u
  );
}

/**
 * VLM 评分主入口
 *
 * 行为与原 `evaluateWithVLM` 字节级一致：
 *   - 遍历 characterReferences
 *   - 无参考图时用 evaluateByPromptMatch 兜底（无 provider 提示）
 *   - 否则逐帧调 compareFrameWithReference，累加求平均
 *   - notes 三档（>=80 / >=60 / else）
 *   - 聚合 overallScore
 */
export async function evaluateWithVLM(
  settings: ModelSettings,
  input: VisualConsistencyInput
): Promise<VisualConsistencyResult> {
  const { frameUrls, characterReferences } = input;
  // 解析出实际使用的模型名（仅用于结果回显）；真正发请求在 compareFrameWithReference 内
  const { modelId } = resolveModelRef(settings, 'text', { slot: 'util.fast' });
  const characterScores: CharacterConsistencyScore[] = [];

  for (const charRef of characterReferences) {
    const referenceUrls = getReferenceUrls(charRef);

    if (referenceUrls.length === 0) {
      const score = evaluateByPromptMatchFallback(charRef);
      characterScores.push({
        characterId: charRef.characterId,
        characterName: charRef.name,
        score,
        frameScores: Array.from({ length: frameUrls.length }, () => score),
        notes: [NO_REFERENCE_NOTE],
      });
      continue;
    }

    const frameScores: number[] = [];
    for (let i = 0; i < frameUrls.length; i++) {
      const frameUrl = frameUrls[i];
      const frameScore = await compareFrameWithReference(settings, frameUrl, referenceUrls, charRef);
      frameScores.push(frameScore);
    }

    const avgScore = frameScores.reduce((a, b) => a + b, 0) / frameScores.length;
    characterScores.push({
      characterId: charRef.characterId,
      characterName: charRef.name,
      score: Math.round(avgScore),
      frameScores,
      notes: [pickScoreNotes(Math.round(avgScore))],
    });
  }

  return buildConsistencyResult(characterScores, frameUrls.length, modelId);
}

// 注：VLM 分支的"无参考图"走的是 evaluateByPromptMatch，但原代码接受 charRef 而非 prompt。
// 这里内联一个简化版本以避免循环依赖（与原 evaluateByPromptMatch(frameUrls, charRef) 行为一致）。
function evaluateByPromptMatchFallback(charRef: CharacterVideoRef): number {
  return evaluateByPromptMatch(charRef.referencePrompt ?? '');
}
