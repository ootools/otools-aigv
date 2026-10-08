//! 插件数据目录解析。
//!
//! 上游 Novella 用 Tauri 的 `app_data_dir()` / `app_config_dir()`（由 Tauri runtime
//! 从 `tauri.conf.json` 的 identifier 推导）。OTools 插件没有 Tauri runtime，
//! 因此改为遵循 OTools 的目录约定（与 `otools/crates/ot-storage` 一致）：
//!
//! ```text
//! ~/.otools/local/<tool>            插件本地数据
//! ~/.otools/local/<tool>/config     插件配置
//! ~/.otools/logs/<tool>             插件日志
//! ```
//!
//! 这是「需要兼容 otools 插件架构」的部分之一：只替换路径来源，
//! 目录内文件的组织方式与上游保持一致。

use std::fs;
use std::path::{Path, PathBuf};

const OTOOLS_DIR: &str = ".otools";
const LOCAL_DATA_DIR: &str = "local";
const LOGS_DIR: &str = "logs";
const CONFIG_DIR: &str = "config";

/// 本插件在 OTools 目录约定下的作用域名。
pub const TOOL_NAME: &str = "aigv";

fn home_dir() -> PathBuf {
    dirs::home_dir()
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn normalize_scope_name(raw: &str) -> String {
    let normalized = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if normalized.is_empty() {
        "unknown".to_string()
    } else {
        normalized
    }
}

/// `~/.otools`
pub fn otools_root_dir() -> PathBuf {
    home_dir().join(OTOOLS_DIR)
}

/// `~/.otools/local`
pub fn otools_local_dir() -> PathBuf {
    otools_root_dir().join(LOCAL_DATA_DIR)
}

/// 插件本地数据目录（替代上游的 `app_data_dir()`）：`~/.otools/local/aigv`
pub fn tool_local_dir() -> PathBuf {
    otools_local_dir().join(normalize_scope_name(TOOL_NAME))
}

/// 插件配置目录（替代上游的 `app_config_dir()`）：`~/.otools/local/aigv/config`
pub fn tool_config_dir() -> PathBuf {
    tool_local_dir().join(CONFIG_DIR)
}

/// 插件日志目录：`~/.otools/logs/aigv`
pub fn tool_logs_dir() -> PathBuf {
    otools_root_dir().join(LOGS_DIR).join(normalize_scope_name(TOOL_NAME))
}

/// 创建目录（幂等）。
pub fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败 {}: {}", dir.display(), e))
}

/// 取得插件数据目录并确保存在。
pub fn ensure_tool_local_dir() -> Result<PathBuf, String> {
    let dir = tool_local_dir();
    ensure_dir(&dir)?;
    Ok(dir)
}

/// 取得插件配置目录并确保存在。
pub fn ensure_tool_config_dir() -> Result<PathBuf, String> {
    let dir = tool_config_dir();
    ensure_dir(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_name_is_normalized() {
        assert_eq!(normalize_scope_name("AIGV"), "aigv");
        assert_eq!(normalize_scope_name(" a i g v "), "a_i_g_v");
        assert_eq!(normalize_scope_name(""), "unknown");
    }

    #[test]
    fn local_dir_follows_otools_convention() {
        let dir = tool_local_dir();
        assert!(dir.ends_with(Path::new(".otools").join("local").join("aigv")));
        assert!(tool_config_dir().ends_with(Path::new("aigv").join("config")));
        assert!(tool_logs_dir().ends_with(Path::new("logs").join("aigv")));
    }
}
