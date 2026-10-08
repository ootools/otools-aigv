//! Novella Strong-Typed IPC Module
//!
//! 【OTools 插件适配】上游这里的函数都带 `#[tauri::command]`（并由 `src-tauri` 的
//! `generate_handler!` 注册），因此本 crate 依赖 `tauri`。插件形态下由
//! `native/src/dispatch.rs` 直接调用这些普通函数，不再需要宏与 Tauri 依赖，
//! 于是去掉属性与依赖——函数签名、逻辑、返回类型完全不变。

pub mod commands {
    use novella_ai::{parser::NovelScriptParser, parser::ScriptParseResult, ArtStylePreset, GenerationPipeline};
    use novella_core::models::{EpisodeModel, MangaProject};
    use novella_core::ProjectStore;
    use novella_media::{detect_hardware_capabilities, HardwareEncoderCaps};

    pub fn get_novella_version() -> String {
        "0.0.1".to_string()
    }

    pub fn create_new_project(name: String, author: String) -> MangaProject {
        ProjectStore::create_new_project(&name, &author)
    }

    pub fn parse_novel_script(text: String) -> Vec<EpisodeModel> {
        GenerationPipeline::execute_optimized_pipeline(&text, ArtStylePreset::ModernAnime, &[])
    }

    pub fn execute_advanced_pipeline(text: String, style_preset: String) -> Vec<EpisodeModel> {
        let preset = match style_preset.as_str() {
            "xianxia" => ArtStylePreset::Xianxia,
            "cyberpunk" => ArtStylePreset::Cyberpunk,
            "shonen" => ArtStylePreset::ShonenAction,
            "dark_fantasy" => ArtStylePreset::DarkFantasy,
            _ => ArtStylePreset::ModernAnime,
        };

        GenerationPipeline::execute_optimized_pipeline(&text, preset, &[])
    }

    pub fn detect_hardware_accel() -> HardwareEncoderCaps {
        detect_hardware_capabilities()
    }

    pub fn get_project_config() -> novella_core::models::ProjectConfig {
        novella_core::models::ProjectConfig::default()
    }

    pub fn validate_project_data(name: String, author: String) -> Result<bool, String> {
        if name.is_empty() {
            return Err("Project name cannot be empty".to_string());
        }
        if author.is_empty() {
            return Err("Project author cannot be empty".to_string());
        }
        Ok(true)
    }

    /// 路径 1: 小说文本上传 $\rightarrow$ 智能转换全功能剧本
    pub fn parse_novel_to_script(text: String, style_preset: String) -> ScriptParseResult {
        let preset = match style_preset.as_str() {
            "xianxia" => ArtStylePreset::Xianxia,
            "cyberpunk" => ArtStylePreset::Cyberpunk,
            "shonen" => ArtStylePreset::ShonenAction,
            "dark_fantasy" => ArtStylePreset::DarkFantasy,
            _ => ArtStylePreset::ModernAnime,
        };
        NovelScriptParser::parse_novel_to_script(&text, preset)
    }

    /// 路径 2: 直接上传专业格式剧本
    pub fn parse_direct_script(text: String) -> ScriptParseResult {
        NovelScriptParser::parse_direct_script(&text)
    }

    /// 路径 3: 输入创意灵感/大纲，AI 自动生成分集剧本
    pub fn generate_script_from_idea(idea: String, episodes: u32, style_preset: String) -> ScriptParseResult {
        let preset = match style_preset.as_str() {
            "xianxia" => ArtStylePreset::Xianxia,
            "cyberpunk" => ArtStylePreset::Cyberpunk,
            "shonen" => ArtStylePreset::ShonenAction,
            "dark_fantasy" => ArtStylePreset::DarkFantasy,
            _ => ArtStylePreset::ModernAnime,
        };
        NovelScriptParser::generate_script_from_idea(&idea, episodes, preset)
    }
}
