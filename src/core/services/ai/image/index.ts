/**
 * AI image & video generation services.
 *
 * 新架构下统一走 `image-generation-service`（内部 → `@/core/ai/image-client` /
 * `video-client`）；旧的 Seedream / Kling / Vidu / Seedance 各自 adapter 已移除。
 * `./image-generation` 子目录仅保留 types 与 `getAPIKey`（后者服务于 lip-sync）。
 */

export * from './image-generation-service';
export * from './image-generation';
