//! OTools aigv native 插件后端。
//!
//! 复刻自 [Agions/novella](https://github.com/Agions/novella) 的 `src-tauri`：
//! 业务逻辑（`services` / `models` / `utils` / `constants` 与 `crates/*`）与上游一致，
//! 只把「Tauri 应用」这一层换成「OTools native 插件」：
//!
//! - 上游：`tauri::Builder::...invoke_handler(generate_handler![...])`，前端用 `invoke('cmd', args)`
//! - 现在：[`dispatch`] 按方法名分发，宿主经 `otools_plugin_invoke` 传入 `{ method, payload }`
//!
//! 运行时依赖的差异集中在这几处，其余代码保持上游原样：
//! - `AppHandle` 相关：窗口操作改为宿主管理（空实现）、路径改为 [`paths`]
//! - `#[tauri::command]` 属性与 `async` 包装：由 [`dispatch`] 直接同步调用替代
//! - release profile 的 `panic`：`abort` → `unwind`（插件 FFI 边界要求，见 [`ffi_guard`]）
//!
//! 目录结构：
//! - `commands::*` — 命令路由（无业务逻辑）
//! - `services::*` — 业务逻辑（FFmpeg、设置、视频处理）
//! - `models::*`   — 数据结构
//! - `utils::*`    — 路径校验、ID 生成、FFmpeg 助手
//! - `constants::*`— 白名单等编译期常量

pub mod commands;
pub mod constants;
pub mod dispatch;
pub mod ffi_guard;
pub mod models;
pub mod paths;
pub mod services;
pub mod utils;

pub use dispatch::dispatch;

use std::sync::Once;

static LOG_INIT: Once = Once::new();

/// 初始化日志：写入 `~/.otools/logs/aigv/aigv.log`，失败则回退到 stderr。
///
/// 上游在 `run()` 里初始化 env_logger；插件没有 `run()`，改为首次调用时惰性初始化。
fn init_logging() {
    LOG_INIT.call_once(|| {
        let builder = || {
            env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        };

        let log_dir = paths::tool_logs_dir();
        if paths::ensure_dir(&log_dir).is_ok() {
            if let Ok(file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_dir.join("aigv.log"))
            {
                builder().target(env_logger::Target::Pipe(Box::new(file))).init();
                return;
            }
        }

        builder().init();
    });
}

/// 处理一次宿主调用，返回 OTools 契约信封。
///
/// 输入形如 `{ "method": "analyze_video", "payload": { "path": "..." } }`。
fn invoke_impl(input_ptr: *const u8, input_len: usize, output_len: *mut usize) -> *mut u8 {
    ffi_guard::guard_invoke(input_ptr, input_len, output_len, |input| {
        init_logging();

        let parsed: serde_json::Value =
            serde_json::from_slice(input).map_err(|error| format!("Invalid input: {}", error))?;

        let (method, payload) = match parsed {
            serde_json::Value::Object(map) => (
                map.get("method")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                map.get("payload").cloned().unwrap_or(serde_json::Value::Null),
            ),
            _ => (String::new(), serde_json::Value::Null),
        };

        Ok(dispatch(&method, payload))
    })
}

/// 宿主调用入口。
///
/// # Safety
///
/// `input_ptr`/`input_len` 必须描述一段可读内存，`output_len` 必须是可写指针。
/// 指针为 null 时返回 null，宿主会据此判为调用失败。
#[cfg(not(feature = "embed"))]
#[no_mangle]
pub extern "C" fn otools_plugin_invoke(
    input_ptr: *const u8,
    input_len: usize,
    output_len: *mut usize,
) -> *mut u8 {
    invoke_impl(input_ptr, input_len, output_len)
}

/// 释放 `otools_plugin_invoke` 返回的缓冲区。
///
/// # Safety
///
/// `ptr`/`len` 必须来自本插件的 `otools_plugin_invoke`，且只能释放一次。
#[cfg(not(feature = "embed"))]
#[no_mangle]
pub extern "C" fn otools_plugin_free(ptr: *mut u8, len: usize) {
    ffi_guard::free_response(ptr, len)
}
