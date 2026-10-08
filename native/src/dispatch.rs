//! 方法分发：把上游的 Tauri command 名称映射到本插件的实现。
//!
//! 宿主通过 `otools_plugin_invoke` 传入 `{ "method": "...", "payload": {...} }`，
//! 这里返回 OTools 契约信封：`{ "ok": true, "data": X }` 或 `{ "ok": false, "error": E }`
//! （宿主/前端桥会检查 `ok` 字段，命中 `data` 时直接解包返回给调用方）。
//!
//! 入参兼容两种命名：Tauri v2 会把 Rust 侧 snake_case 参数在 JS 侧写成 camelCase，
//! 上游前端代码里两种写法都存在，所以这里两种都收。

use serde_json::{json, Value};

/// 从 payload 中按候选键取字符串。
fn str_arg(payload: &Value, keys: &[&str]) -> Result<String, String> {
    for key in keys {
        if let Some(value) = payload.get(*key) {
            if let Some(text) = value.as_str() {
                return Ok(text.to_string());
            }
        }
    }
    Err(format!("缺少字符串参数: {}", keys.join(" / ")))
}

/// 从 payload 中按候选键取可反序列化结构。
fn struct_arg<T: serde::de::DeserializeOwned>(payload: &Value, keys: &[&str]) -> Result<T, String> {
    for key in keys {
        if let Some(value) = payload.get(*key) {
            if !value.is_null() {
                return serde_json::from_value(value.clone())
                    .map_err(|e| format!("参数 {} 解析失败: {}", key, e));
            }
        }
    }
    Err(format!("缺少对象参数: {}", keys.join(" / ")))
}

/// 取结构参数：优先取嵌套键，取不到就把整个 payload 当作结构。
///
/// 上游前端的调用方式不统一——`invoke('cut_video', options)` 直接平铺，
/// `invoke('save_app_settings', { settings })` 则是嵌套。两种都支持。
fn struct_arg_or_self<T: serde::de::DeserializeOwned>(payload: &Value, keys: &[&str]) -> Result<T, String> {
    if let Ok(nested) = struct_arg::<T>(payload, keys) {
        return Ok(nested);
    }
    serde_json::from_value(payload.clone()).map_err(|e| format!("参数解析失败: {}", e))
}

/// 从 payload 中按候选键取 u32。
fn u32_arg(payload: &Value, keys: &[&str], fallback: u32) -> u32 {
    for key in keys {
        if let Some(value) = payload.get(*key) {
            if let Some(number) = value.as_u64() {
                return number as u32;
            }
            if let Some(text) = value.as_str() {
                if let Ok(parsed) = text.parse::<u32>() {
                    return parsed;
                }
            }
        }
    }
    fallback
}

/// 分发入口。
pub fn dispatch(method: &str, payload: Value) -> Value {
    use crate::commands::{app, file, otools_fs, video};

    macro_rules! ok {
        ($expr:expr) => {
            match $expr {
                Ok(v) => json!({ "ok": true, "data": v }),
                Err(e) => json!({ "ok": false, "error": e }),
            }
        };
    }

    match method {
        // ---------------- 版本 / 项目（crates/ipc） ----------------
        "get_novella_version" => json!({ "ok": true, "data": novella_ipc::commands::get_novella_version() }),
        "create_new_project" => {
            ok!(str_arg(&payload, &["name"]).and_then(|name| {
                str_arg(&payload, &["author"]).map(|author| {
                    novella_ipc::commands::create_new_project(name, author)
                })
            }))
        }
        "parse_novel_script" => {
            ok!(str_arg(&payload, &["text"])
                .map(novella_ipc::commands::parse_novel_script))
        }
        "execute_advanced_pipeline" => {
            ok!(str_arg(&payload, &["text", "textValue"]).and_then(|text| {
                str_arg(&payload, &["style_preset", "stylePreset"])
                    .map(|preset| novella_ipc::commands::execute_advanced_pipeline(text, preset))
            }))
        }
        "detect_hardware_accel" => {
            json!({ "ok": true, "data": novella_ipc::commands::detect_hardware_accel() })
        }
        "get_project_config" => {
            json!({ "ok": true, "data": novella_ipc::commands::get_project_config() })
        }
        "validate_project_data" => {
            ok!(str_arg(&payload, &["name"]).and_then(|name| {
                str_arg(&payload, &["author"])
                    .and_then(|author| novella_ipc::commands::validate_project_data(name, author))
            }))
        }
        // 三条素材输入路径
        "parse_novel_to_script" => {
            ok!(str_arg(&payload, &["text"]).and_then(|text| {
                str_arg(&payload, &["style_preset", "stylePreset"])
                    .map(|preset| novella_ipc::commands::parse_novel_to_script(text, preset))
            }))
        }
        "parse_direct_script" => {
            ok!(str_arg(&payload, &["text"]).map(novella_ipc::commands::parse_direct_script))
        }
        "generate_script_from_idea" => {
            ok!(str_arg(&payload, &["idea"]).and_then(|idea| {
                let episodes = u32_arg(&payload, &["episodes"], 1);
                str_arg(&payload, &["style_preset", "stylePreset"]).map(|preset| {
                    novella_ipc::commands::generate_script_from_idea(idea, episodes, preset)
                })
            }))
        }

        // ---------------- 视频（commands::video） ----------------
        "analyze_video" => {
            ok!(str_arg(&payload, &["path"]).and_then(video::analyze_video))
        }
        "extract_key_frames" => {
            ok!(str_arg(&payload, &["path"]).and_then(|path| {
                video::extract_key_frames(path, u32_arg(&payload, &["count"], 8))
            }))
        }
        "generate_thumbnail" => {
            ok!(str_arg(&payload, &["path"]).and_then(video::generate_thumbnail))
        }
        "cut_video" => {
            ok!(struct_arg_or_self(&payload, &["params", "options"])
                .and_then(video::cut_video))
        }
        "generate_preview" => {
            ok!(struct_arg_or_self(&payload, &["params", "options"])
                .and_then(video::generate_preview))
        }
        "clean_temp_file" => {
            ok!(struct_arg_or_self(&payload, &["params"])
                .and_then(video::clean_temp_file))
        }
        "check_ffmpeg" => ok!(video::check_ffmpeg()),

        // ---------------- 上游前端调用但上游 Rust 未实现的命令 ----------------
        // `export_video` 在 novella 的 Tauri 后端里就没有对应实现（前端留了
        // `export-progress` 事件监听），这里给出明确错误而不是「Unknown method」，
        // 便于定位；导出实际走 `cut_video` / `generate_preview`。
        "export_video" => json!({
            "ok": false,
            "error": "上游 Novella 未提供 export_video 命令实现，请使用 cut_video / generate_preview",
        }),
        // 全局快捷键在 OTools 宿主下由宿主/用户配置管理，插件侧不接受注册。
        "register_global_shortcut" => {
            log::info!("register_global_shortcut：全局快捷键由 OTools 宿主管理，插件侧忽略");
            json!({ "ok": true, "data": null })
        }
        "unregister_global_shortcut" => {
            log::info!("unregister_global_shortcut：全局快捷键由 OTools 宿主管理，插件侧忽略");
            json!({ "ok": true, "data": null })
        }
        "is_global_shortcut_registered" => json!({ "ok": true, "data": false }),

        // ---------------- 应用 / 设置 / 路径（commands::app） ----------------
        // 窗口操作在 OTools 宿主下由宿主管理，插件侧为记录性空实现。
        "show_main_window" | "show_window" => ok!(app::show_main_window()),
        "hide_main_window" | "hide_window" => ok!(app::hide_main_window()),
        "toggle_fullscreen" => ok!(app::toggle_fullscreen()),
        "get_app_settings" => ok!(app::get_app_settings()),
        "save_app_settings" => {
            ok!(struct_arg(&payload, &["settings", "settingsValue"])
                .and_then(app::save_app_settings))
        }
        "check_runtime_dependencies" => ok!(app::check_runtime_dependencies()),
        "get_app_data_path" => ok!(app::get_app_data_path()),
        "open_file_location" => {
            ok!(str_arg(&payload, &["path"]).and_then(app::open_file_location))
        }
        "open_file" => ok!(str_arg(&payload, &["path"]).and_then(app::open_file)),

        // ---------------- 工程文件（commands::file） ----------------
        "check_app_data_directory" => ok!(file::check_app_data_directory()),
        "save_project_file" => {
            ok!(str_arg(&payload, &["project_id", "projectId"]).and_then(|project_id| {
                str_arg(&payload, &["content", "contents"])
                    .and_then(|content| file::save_project_file(project_id, content))
            }))
        }
        "read_project_file" => {
            ok!(str_arg(&payload, &["project_id", "projectId"])
                .and_then(file::read_project_file))
        }
        "list_app_data_files" => {
            ok!(str_arg(&payload, &["directory"]).and_then(file::list_app_data_files))
        }
        "delete_project_file" => {
            ok!(str_arg(&payload, &["project_id", "projectId"])
                .and_then(file::delete_project_file))
        }
        "remove_file" => ok!(str_arg(&payload, &["path"]).and_then(file::remove_file)),
        "write_text_file" => {
            ok!(str_arg(&payload, &["path"]).and_then(|path| {
                str_arg(&payload, &["content"]).and_then(|content| file::write_text_file(path, content))
            }))
        }

        // ---------------- 通用文件系统（OTools 胶水层，见 commands/otools_fs.rs） ----------------
        "path_exists" => ok!(str_arg(&payload, &["path"]).and_then(otools_fs::path_exists)),
        "read_text_file" => ok!(str_arg(&payload, &["path"]).and_then(otools_fs::read_text_file)),
        "create_dir" => ok!(str_arg(&payload, &["path"]).and_then(otools_fs::create_dir)),
        "remove_path" => {
            ok!(str_arg(&payload, &["path"]).and_then(|path| {
                let recursive = payload
                    .get("recursive")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                otools_fs::remove_path(path, recursive)
            }))
        }
        "read_dir" => ok!(str_arg(&payload, &["path"]).and_then(otools_fs::read_dir)),
        "join_path" => {
            let parts = payload
                .get("parts")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .map(|item| item.as_str().unwrap_or_default().to_string())
                        .collect::<Vec<String>>()
                })
                .unwrap_or_default();
            ok!(otools_fs::join_path(parts))
        }

        // ---------------- 宿主热更新握手 ----------------
        // 宿主换库前会调用，要求插件停掉常驻后台任务。本插件没有常驻线程。
        "__otools_shutdown__" => json!({ "ok": true, "data": "otools-aigv 无后台常驻任务" }),

        _ => json!({
            "ok": false,
            "error": format!("Unknown method: {}", method),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端会调用的每个命令都必须被 dispatch 识别。
    /// 漏注册时前端只会看到「Unknown method」，肉眼很难发现，所以用测试钉住。
    #[test]
    fn dispatch_registers_every_frontend_command() {
        let methods = [
            "get_novella_version",
            "create_new_project",
            "parse_novel_script",
            "execute_advanced_pipeline",
            "detect_hardware_accel",
            "get_project_config",
            "validate_project_data",
            "parse_novel_to_script",
            "parse_direct_script",
            "generate_script_from_idea",
            "analyze_video",
            "extract_key_frames",
            "generate_thumbnail",
            "cut_video",
            "generate_preview",
            "clean_temp_file",
            "check_ffmpeg",
            "export_video",
            "register_global_shortcut",
            "unregister_global_shortcut",
            "is_global_shortcut_registered",
            "show_main_window",
            "show_window",
            "hide_main_window",
            "hide_window",
            "toggle_fullscreen",
            "get_app_settings",
            "save_app_settings",
            "check_runtime_dependencies",
            "get_app_data_path",
            "open_file_location",
            "open_file",
            "check_app_data_directory",
            "save_project_file",
            "read_project_file",
            "list_app_data_files",
            "delete_project_file",
            "remove_file",
            "write_text_file",
            "path_exists",
            "read_text_file",
            "create_dir",
            "remove_path",
            "read_dir",
            "join_path",
            "__otools_shutdown__",
        ];

        for method in methods {
            let response = dispatch(method, json!({}));
            let error = response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default();
            assert!(
                !error.starts_with("Unknown method"),
                "{method} 未注册到 dispatch"
            );
        }
    }

    #[test]
    fn unknown_method_reports_error() {
        let response = dispatch("no_such_method", json!({}));
        assert_eq!(response["ok"], json!(false));
        assert!(response["error"].as_str().unwrap().contains("Unknown method"));
    }

    #[test]
    fn missing_argument_is_reported_as_error() {
        let response = dispatch("read_project_file", json!({}));
        assert_eq!(response["ok"], json!(false));
        assert!(response["error"].as_str().unwrap().contains("缺少"));
    }

    #[test]
    fn camel_case_argument_is_accepted() {
        // 只验证参数被识别（文件不存在会走到 file 层的读取错误，而不是参数错误）
        let response = dispatch("read_project_file", json!({ "projectId": "demo" }));
        let error = response["error"].as_str().unwrap_or_default();
        assert!(!error.contains("缺少"), "camelCase 参数应被识别: {error}");
    }

    #[test]
    fn version_command_returns_data_envelope() {
        let response = dispatch("get_novella_version", json!({}));
        assert_eq!(response["ok"], json!(true));
        assert!(response["data"].is_string());
    }
}
