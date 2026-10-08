# otools-aigv · Novella for OTools

**Novella（AI 漫剧 / 动画短剧 Multi-Agent 创作平台）的 OTools 插件版。**

复刻自 [Agions/novella](https://github.com/Agions/novella)（Tauri v2 + React 19 + Rust），
在保留其 Rust / React 源码的前提下，把「Tauri 桌面应用」这一层替换为「OTools 插件」：

| 层 | 上游 Novella | 本仓库 |
| --- | --- | --- |
| 前端 | React 19 + Vite，`@tauri-apps/*` 由 Tauri runtime 提供 | 同一套源码，`@tauri-apps/*` 在构建期被别名到 OTools 插件 SDK 的 shim |
| 后端 | `src-tauri` 作为 Tauri 应用，`invoke_handler(generate_handler![...])` | `native/` 作为 OTools native 插件（cdylib），`dispatch` 按方法名分发 |
| 运行时 | Tauri 管理窗口、路径、插件 | 窗口交给 OTools 宿主；路径改为 `~/.otools/local/aigv` |
| 打包 | Tauri 安装包 | `dist/` + `lib/` + `plugin.json`，由宿主加载 |

## 目录结构

```
plugin.json               OTools 插件清单（packid / uuid / entry / native.libDir / devUrl）
vite.config.ts            前端构建：注入 OTools SDK shim 别名、插件 UUID、dev 端口 6481
index.html                前端入口（含开屏 Splash）
src/                      React 前端（上游源码，改动见下）
  infrastructure/
    tauri-bridge/         上游的 Tauri 命令桥（未改）
    otools-shims/         本仓库新增：SDK 未覆盖的 Tauri 模块的 OTools 替代实现
packages/                 上游前端 monorepo 包（ai-engine / storyboard / ui / …）
crates/                   上游 Rust 业务 crate（core / ai / media / plugin / updater / ipc）
native/                   本仓库新增：OTools native 插件 crate（cdylib）
  src/dispatch.rs         方法分发表（原 Tauri command 名 → 实现）
  src/ffi_guard.rs        FFI 边界 panic 守卫
  src/paths.rs            OTools 目录约定
  src/commands/           上游命令层（app / file / video）+ 新增 otools_fs
  src/services/ models/ utils/ constants/   上游原样搬入
scripts/
  sync-native-lib.mjs     把 cargo 产物按宿主约定同步到 lib/<平台>.dll|dylib|so
  deploy-to-otools.ps1    同步插件到 otools 仓库 plugins/ 目录
```

## 开发与构建

```bash
pnpm install

# 前端
pnpm dev            # 独立开发调试（127.0.0.1:6481）
pnpm build          # 产出 dist/
pnpm check          # tsc + eslint

# native 后端
pnpm native:test    # cargo test -p otools-aigv-native
pnpm native:build   # cargo build --release -p otools-aigv-native
pnpm native:sync    # 同步到 lib/Windows.dll（按平台自动选名）
```

### 关于 OTools SDK

前端把 `@tauri-apps/*` 别名到 OTools 插件 SDK 的 shim（`vendor/otools-plugin-sdk`）。
SDK 位于 otools 主仓库，因此 `vite.config.ts` 会探测两种落位：

1. `../otools/vendor/otools-plugin-sdk/src` —— 本仓库与 otools 主仓库并列检出
2. `../../vendor/otools-plugin-sdk/src` —— 插件被同步进 `otools/otools/plugins/otools-aigv`

两种都不存在时仍可构建，但 `@tauri-apps/*` 会回落到本仓库自带的 shim
（`src/infrastructure/otools-shims/`），功能受限。

## 部署到 otools

```powershell
pwsh -File scripts/deploy-to-otools.ps1 -OtoolsRoot D:\Repos\xyito\otools\otools
# 之后在 otools 仓库中：
pnpm --dir plugins/otools-aigv install
pnpm --dir plugins/otools-aigv build
```

## 与上游的差异

### 1. Rust 侧（`src-tauri` → `native/`）

- 去掉 `#[tauri::command]` 与 `async` 包装，改为 `native/src/dispatch.rs` 同步调用；
  业务逻辑（`services` / `models` / `utils` / `constants` / `crates/*`）与上游一致。
- `AppHandle` 相关：
  - 窗口操作（show / hide / fullscreen）在插件形态下由宿主管理，改为记录性空实现。
  - `app_data_dir()` / `app_config_dir()` → `native/src/paths.rs`
    （`~/.otools/local/aigv` 与 `~/.otools/local/aigv/config`）。
- `crates/ipc` 去掉了 `tauri` 依赖（原本只为 `#[command]` 宏存在），
  函数签名与逻辑不变。这样 native cdylib 完全不依赖 Tauri runtime。
- release profile 的 `panic`：`abort` → `unwind`。
  **这是硬性要求**：`otools_plugin_invoke` 是 `extern "C"` 边界，panic 无法跨 DLL
  unwind，`abort` 会直接把宿主进程杀掉（0xC000001D）。`native/src/ffi_guard.rs`
  在边界内 `catch_unwind`，把 panic 转成普通错误响应。
- 新增命令（上游没有，属 OTools 胶水层，单独在 `commands/otools_fs.rs`）：
  `path_exists` / `read_text_file` / `create_dir` / `remove_path` / `read_dir` / `join_path`，
  供前端 fs shim 使用。

### 2. 前端侧

- `vite.config.ts`：移除 Tauri external 处理，改为注入 SDK shim 别名；`base: './'`；
  去掉 `vite-plugin-compression`（dist 会被打进插件包，gz/br 是浪费）。
- 新增 `src/infrastructure/otools-shims/`，补齐 SDK 未覆盖的 Tauri 模块：
  - `path-shim.ts` —— `@tauri-apps/api/path`（目录取自宿主 `window.otools.paths` 与 native `get_app_data_path`）
  - `fs-shim.ts` —— `@tauri-apps/plugin-fs`（宿主 `readHostFile`/`writeHostFile` + native fs 命令）
  - `store-shim.ts` —— `@tauri-apps/plugin-store`（JSON 落盘在插件数据目录）
  - `dialog-shim.ts` / `notification-shim.ts` —— 旧路径的等价实现
- `index.html` 里的绝对资源路径改为相对路径（`file://` 加载需要）。

### 3. 已知缺口

- `export_video`：上游 Rust 后端**本来就没有**这个命令的实现（前端留了
  `export-progress` 事件监听）。插件侧返回明确错误，导出请走
  `cut_video` / `generate_preview`。
- 全局快捷键注册（`register_global_shortcut` 等）：OTools 宿主统一管理，插件侧不接受注册。
- 窗口操作（最小化/最大化/全屏/置顶）：由宿主窗口管理，插件侧为空实现。
- `vite-plugin-compression`、Tauri 打包（`tauri.conf.json` / `capabilities`）等
  上游桌面端专属配置未搬入。

## 许可

MIT（沿用上游 Novella）。上游作者 Agions，上游仓库 <https://github.com/Agions/novella>。
