/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_OPENAI_API_KEY: string;
  readonly VITE_ANTHROPIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * 【OTools 插件适配】删除了上游这里对 `@tauri-apps/api/core` 的 ambient 声明：
 * 它只声明了 invoke / convertFileSrc / isTauri 三个导出，会**遮蔽**真实类型，
 * 导致 `@tauri-apps/api/event` 等子模块的导出在类型检查里找不到。
 *
 * 构建期这些 specifier 会被 vite 别名到 OTools SDK 的 shim
 * （见 vite.config.ts），类型检查则继续使用 `@tauri-apps/api` 包自带的声明。
 */
