//! App settings service: read / write the JSON-backed `AppSettings` file
//! located in the plugin config directory.
//!
//! 【OTools 插件适配】上游用 Tauri 的 `AppHandle::path().app_config_dir()`，
//! 这里改为 `crate::paths::ensure_tool_config_dir()`（`~/.otools/local/aigv/config`）。
//! 文件名与 JSON 结构保持不变。

use std::fs;

use crate::models::app_settings::AppSettings;
use crate::paths;

/// Read the app settings. Returns the default settings if no file exists yet.
pub fn read() -> Result<AppSettings, String> {
    let config_dir = paths::ensure_tool_config_dir()?;
    let settings_file = config_dir.join("settings.json");

    if settings_file.exists() {
        let content = fs::read_to_string(&settings_file).map_err(|e| e.to_string())?;
        let settings: AppSettings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(settings)
    } else {
        Ok(AppSettings::default())
    }
}

/// Persist the app settings to disk.
pub fn write(settings: &AppSettings) -> Result<(), String> {
    use log::info;

    let config_dir = paths::ensure_tool_config_dir()?;

    let settings_file = config_dir.join("settings.json");
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&settings_file, content).map_err(|e| e.to_string())?;

    info!("应用设置已保存");
    Ok(())
}
