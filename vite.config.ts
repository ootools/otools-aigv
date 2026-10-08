import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * OTools 插件工程配置
 * ---------------------------------------------------------------
 * 上游 Novella 是 Tauri 桌面应用：`@tauri-apps/*` 由 Tauri runtime 提供，
 * 所以 vite 把它们当作 external。插件形态下这些模块**必须被打进包**，
 * 并且要改指向 OTools 插件 SDK 的 shim（把 `invoke()` 路由到宿主的
 * native 插件桥），见 vendor/otools-plugin-sdk。
 *
 * SDK 是 otools 主仓库的 vendor 子模块，因此两种落位都探测一下：
 *  1. `otools/otools-aigv`（本仓库作为 xyito 子模块，与 otools 主仓库平级）
 *  2. `otools/otools/plugins/otools-aigv`（被 deploy 脚本同步进 otools 仓库）
 */
const SDK_DIR_CANDIDATES = [
  path.resolve(here, '../otools/vendor/otools-plugin-sdk/src'),
  path.resolve(here, '../../vendor/otools-plugin-sdk/src'),
];
const sdkDir = SDK_DIR_CANDIDATES.find((dir) => fs.existsSync(path.join(dir, 'index.ts')));

/** SDK 里已有的 shim（相对 SDK src 目录的文件名） */
const SDK_SHIMS = {
  '@tauri-apps/api/core': 'tauri-core-shim.ts',
  '@tauri-apps/api/event': 'tauri-event-shim.ts',
  '@tauri-apps/api/webview': 'tauri-webview-shim.ts',
  '@tauri-apps/api/app': 'tauri-app-shim.ts',
  '@tauri-apps/plugin-dialog': 'tauri-plugin-dialog-shim.ts',
  '@tauri-apps/plugin-notification': 'tauri-plugin-notification-shim.ts',
  '@tauri-apps/plugin-opener': 'tauri-plugin-opener-shim.ts',
  '@tauri-apps/plugin-process': 'tauri-plugin-process-shim.ts',
  '@tauri-apps/plugin-shell': 'tauri-plugin-shell-shim.ts',
  '@tauri-apps/plugin-updater': 'tauri-plugin-updater-shim.ts',
};

/**
 * SDK 未覆盖（或覆盖不全）的 Tauri 模块，用本仓库自带的 shim 顶上：
 * `api/window`（SDK 的 shim 缺 setTitle/setFullscreen/maximize 与
 * LogicalSize/LogicalPosition）、`api/path`、`plugin-fs`、`plugin-store`，
 * 以及几个已被 Tauri v2 合并、但上游代码仍在 import 的旧路径。
 */
const LOCAL_SHIMS = {
  '@tauri-apps/api/window': 'src/infrastructure/otools-shims/window-shim.ts',
  '@tauri-apps/api/path': 'src/infrastructure/otools-shims/path-shim.ts',
  '@tauri-apps/api/fs': 'src/infrastructure/otools-shims/fs-shim.ts',
  '@tauri-apps/api/dialog': 'src/infrastructure/otools-shims/dialog-shim.ts',
  '@tauri-apps/api/notification': 'src/infrastructure/otools-shims/notification-shim.ts',
  '@tauri-apps/plugin-fs': 'src/infrastructure/otools-shims/fs-shim.ts',
  '@tauri-apps/plugin-store': 'src/infrastructure/otools-shims/store-shim.ts',
};

const sdkAlias = sdkDir
  ? Object.fromEntries(
      Object.entries(SDK_SHIMS).map(([specifier, file]) => [specifier, path.join(sdkDir, file)]),
    )
  : {};

const localShimAlias = Object.fromEntries(
  Object.entries(LOCAL_SHIMS).map(([specifier, file]) => [specifier, path.resolve(here, file)]),
);

/** 独立开发端口，需与 plugin.json 的 devUrl 保持一致 */
const DEV_PORT = 6481;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  esbuild: {
    jsx: 'automatic',
  },

  clearScreen: false,

  define: {
    // 宿主桥在 __OToolsEnv 注入前用它识别插件身份
    __OTOOLS_PLUGIN_UUID__: JSON.stringify('otools-aigv'),
  },

  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: true,
    hmr: { protocol: 'ws', host: '127.0.0.1' },
  },

  preview: {
    host: '127.0.0.1',
    port: 4481,
    strictPort: true,
  },

  css: {
    devSourcemap: true,
    minify: true,
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        math: 'always',
      },
    },
    modules: {
      localsConvention: 'camelCase',
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(here, './src'),
      '@novella/core': path.resolve(here, './packages/core/src'),
      '@novella/ai-engine': path.resolve(here, './packages/ai-engine/src'),
      '@novella/storyboard': path.resolve(here, './packages/storyboard/src'),
      '@novella/audio-studio': path.resolve(here, './packages/audio-studio/src'),
      '@novella/render-pipeline': path.resolve(here, './packages/render-pipeline/src'),
      '@novella/ui': path.resolve(here, './packages/ui/src'),
      ...sdkAlias,
      ...localShimAlias,
    },
  },

  // 插件由宿主以相对路径加载 dist/index.html
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/react-router')) {
            return 'router-vendor';
          }
          if (id.includes('node_modules/zustand')) {
            return 'state-vendor';
          }
          if (id.includes('node_modules/@radix-ui') || id.includes('node_modules/lucide-react')) {
            return 'ui-vendor';
          }
          if (id.includes('node_modules/framer-motion')) {
            return 'animation-vendor';
          }
          if (id.includes('node_modules/axios')) {
            return 'http-vendor';
          }
          if (id.includes('node_modules/@ffmpeg')) {
            return 'ffmpeg-vendor';
          }
        },
      },
    },
  },
});
