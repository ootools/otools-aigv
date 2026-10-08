//! 命令面，按域分组。
//!
//! 所有命令都是纯路由：校验入参后交给 `services::*` 处理，自身不含业务逻辑。
//!
//! 【OTools 插件适配】上游这里是 `#[tauri::command]` 函数集合，由 Tauri 的
//! `generate_handler!` 注册；现在改成普通函数，由 crate 根部的
//! [`crate::dispatch`] 按方法名分发。函数签名与逻辑保持上游原样。

pub mod app;
pub mod file;
pub mod otools_fs;
pub mod video;
