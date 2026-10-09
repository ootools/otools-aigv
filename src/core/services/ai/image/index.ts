/**
 * AI image & video generation services.
 *
 * 新架构下统一走 `image-generation-service`（内部 → `@/core/ai/image-client` /
 * `video-client`）；旧的 Seedream / Kling / Vidu / Seedance 各自 adapter 已移除。
 * `./image-generation` 子目录仅保留类型定义（`types.ts`）。
 */

export * from './image-generation-service';
export * from './image-generation';
