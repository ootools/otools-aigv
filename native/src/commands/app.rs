//! App-level commands: window management, settings, paths.
//!
//! 【OTools 插件适配】上游这些命令都接收 Tauri 的 `AppHandle`：
//! - 窗口操作（show / hide / fullscreen）在插件形态下由宿主统一管理，
//!   插件没有也不应该有窗口控制权，这里改为「记录并成功返回」，
//!   让前端既有的 fire-and-forget 调用不会抛错。
//! - 路径类改为 `crate::paths`（`~/.otools/local/aigv`），见该模块文档。
//! - 其余命令逻辑与上游一致。

use std::process::Command;

use log::info;

use crate::models::app_settings::AppSettings;
use crate::paths;
use crate::services::config::settings;
use crate::utils::path_validator::validate_input_path;

/// 显示主窗口。
///
/// OTools 宿主管理所有窗口/标签页，插件无法直接操作；此处仅记录，
/// 与上游「显示主窗口」的调用语义保持一致（不报错）。
pub fn show_main_window() -> Result<(), String> {
    info!("show_main_window：窗口由 OTools 宿主管理，插件侧无操作");
    Ok(())
}

/// 隐藏主窗口。语义同上。
pub fn hide_main_window() -> Result<(), String> {
    info!("hide_main_window：窗口由 OTools 宿主管理，插件侧无操作");
    Ok(())
}

/// 切换主窗口全屏。语义同上，返回切换后的状态（宿主不可知，恒返回 `true` 表示已切换）。
pub fn toggle_fullscreen() -> Result<bool, String> {
    info!("toggle_fullscreen：窗口由 OTools 宿主管理，插件侧无操作");
    Ok(true)
}

/// 读取当前 `AppSettings`。
pub fn get_app_settings() -> Result<AppSettings, String> {
    settings::read()
}

/// 持久化 `AppSettings` 到磁盘。
pub fn save_app_settings(settings_value: AppSettings) -> Result<(), String> {
    settings::write(&settings_value)
}

/// 返回插件的 OS 相关数据目录路径（`~/.otools/local/aigv`）。
pub fn get_app_data_path() -> Result<String, String> {
    let dir = paths::ensure_tool_local_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

/// 在文件管理器中打开 `path` 所在目录。
pub fn open_file_location(path: String) -> Result<(), String> {
    validate_input_path(&path)?;
    let path = std::path::PathBuf::from(&path);

    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    let parent = if path.is_file() {
        path.parent().map(|p| p.to_path_buf())
    } else {
        Some(path)
    };

    if let Some(dir) = parent {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(dir).spawn().map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "windows")]
        {
            Command::new("explorer")
                .arg(dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        {
            Command::new("xdg-open")
                .arg(dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        Err("无法确定父目录".to_string())
    }
}

/// 检查运行时依赖（WebView2 与 FFmpeg）。
///
/// 注意：在 OTools 宿主内 WebView 由宿主提供，WebView2 检测仅作信息展示保留。
pub fn check_runtime_dependencies() -> Result<std::collections::HashMap<String, serde_json::Value>, String> {
    let mut result = std::collections::HashMap::new();

    // `reg query` 会拉起外部进程。单元测试里（dispatch 注册表测试会逐个调用命令）
    // 不需要真的探测系统，跳过以免测试依赖外部程序与沙箱策略。
    #[cfg(all(target_os = "windows", not(test)))]
    {
        match Command::new("cmd").args([
            "/c",
            "reg",
            "query",
            "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ]).output() {
            Ok(output) if output.status.success() => {
                result.insert("webview2_installed".to_string(), serde_json::Value::Bool(true));
            }
            _ => {
                result.insert("webview2_installed".to_string(), serde_json::Value::Bool(false));
                result.insert("webview2_install_url".to_string(), serde_json::Value::String(
                    "https://developer.microsoft.com/en-us/microsoft-edge/webview2/".to_string()
                ));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        result.insert("webview2_installed".to_string(), serde_json::Value::Bool(true));
    }

    #[cfg(all(target_os = "windows", test))]
    {
        result.insert("webview2_installed".to_string(), serde_json::Value::Bool(true));
    }

    match Command::new("ffmpeg").arg("-version").output() {
        Ok(output) if output.status.success() => {
            let version_str = String::from_utf8_lossy(&output.stdout);
            result.insert("ffmpeg_installed".to_string(), serde_json::Value::Bool(true));
            result.insert("ffmpeg_version".to_string(), serde_json::Value::String(
                version_str.lines().next().unwrap_or("").to_string()
            ));
        }
        _ => {
            result.insert("ffmpeg_installed".to_string(), serde_json::Value::Bool(false));
        }
    }

    Ok(result)
}

/// 用系统默认程序打开文件（对应前端 `open_file`）。
pub fn open_file(path: String) -> Result<(), String> {
    validate_input_path(&path)?;
    let path = std::path::PathBuf::from(&path);
    if !path.exists() {
        return Err("文件不存在".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // cmd /c start 需要空标题参数，否则带引号的路径会被当成窗口标题
        Command::new("cmd")
            .args(["/c", "start", ""])
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
