//! 通用文件系统命令（OTools 插件架构的胶水层）。
//!
//! 上游 Novella 的前端直接用 `@tauri-apps/plugin-fs`（由 Tauri 的 fs 插件提供
//! 沙箱化的读写）。OTools 插件里前端能拿到的宿主文件能力只有
//! `readHostFile` / `writeHostFile` / `listHostDir`，缺少 exists / mkdir / remove /
//! readDir，因此在这里补一组最薄的等价命令，供
//! `src/infrastructure/otools-shims/fs-shim.ts` 使用。
//!
//! 这一组命令是**新增**的（不属于上游），所以单独成文件，方便与上游代码区分。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 目录项（与 Tauri fs 插件的 `DirEntry` 字段对齐，前端 shim 直接映射）。
#[derive(Serialize, Debug, Clone)]
pub struct DirEntryDto {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
}

fn to_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("路径为空".to_string());
    }
    if trimmed.contains('\0') {
        return Err("路径包含空字节".to_string());
    }
    Ok(PathBuf::from(trimmed))
}

/// 路径是否存在。
pub fn path_exists(path: String) -> Result<bool, String> {
    let target = to_path(&path)?;
    Ok(target.exists())
}

/// 读取文本文件（UTF-8；带 BOM 时自动去掉）。
pub fn read_text_file(path: String) -> Result<String, String> {
    let target = to_path(&path)?;
    let bytes = fs::read(&target).map_err(|e| format!("读取文件失败 {}: {}", target.display(), e))?;
    // 去掉 UTF-8 BOM，避免 JSON.parse 失败
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes[3..].to_vec()
    } else {
        bytes
    };
    String::from_utf8(bytes).map_err(|e| format!("文件不是合法 UTF-8 {}: {}", target.display(), e))
}

/// 创建目录（递归，幂等）。
pub fn create_dir(path: String) -> Result<(), String> {
    let target = to_path(&path)?;
    fs::create_dir_all(&target).map_err(|e| format!("创建目录失败 {}: {}", target.display(), e))
}

/// 删除文件或目录。
///
/// 安全约束：拒绝删除文件系统根与用户主目录本身，避免误传空/根路径造成灾难。
/// 其余路径按 `recursive` 决定是否递归删除。
pub fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    let target = to_path(&path)?;

    if target.parent().is_none() {
        return Err(format!("拒绝删除文件系统根: {}", target.display()));
    }
    if let Some(home) = dirs::home_dir() {
        if target == home {
            return Err("拒绝删除用户主目录".to_string());
        }
    }

    let metadata = fs::symlink_metadata(&target)
        .map_err(|e| format!("读取路径信息失败 {}: {}", target.display(), e))?;

    if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(&target)
                .map_err(|e| format!("删除目录失败 {}: {}", target.display(), e))
        } else {
            fs::remove_dir(&target).map_err(|e| format!("删除目录失败 {}: {}", target.display(), e))
        }
    } else {
        fs::remove_file(&target).map_err(|e| format!("删除文件失败 {}: {}", target.display(), e))
    }
}

/// 列举目录内容。
pub fn read_dir(path: String) -> Result<Vec<DirEntryDto>, String> {
    let target = to_path(&path)?;
    let entries = fs::read_dir(&target).map_err(|e| format!("列举目录失败 {}: {}", target.display(), e))?;

    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        result.push(DirEntryDto {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry_path.to_string_lossy().to_string(),
            is_directory: file_type.is_dir(),
            is_file: file_type.is_file(),
            is_symlink: file_type.is_symlink(),
        });
    }

    // 目录优先、同名按字典序，保证前端列表稳定
    result.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(result)
}

/// 拼接路径片段（前端 shim 用来拼 appDataDir 下的子路径）。
pub fn join_path(parts: Vec<String>) -> Result<String, String> {
    let mut iter = parts.into_iter().filter(|part| !part.trim().is_empty());
    let first = iter.next().ok_or_else(|| "路径片段为空".to_string())?;
    let mut result = Path::new(&first).to_path_buf();
    for part in iter {
        result = result.join(part);
    }
    Ok(result.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_path_is_rejected() {
        assert!(to_path("").is_err());
        assert!(to_path("   ").is_err());
        assert!(to_path("a\0b").is_err());
    }

    #[test]
    fn filesystem_root_is_never_removed() {
        let root = if cfg!(target_os = "windows") { "C:\\" } else { "/" };
        assert!(remove_path(root.to_string(), true).is_err());
    }

    #[test]
    fn join_path_skips_empty_segments() {
        let joined = join_path(vec!["/tmp".to_string(), "".to_string(), "a".to_string()]).unwrap();
        assert!(joined.ends_with("a"));
    }

    #[test]
    fn read_dir_reports_missing_directory() {
        let missing = if cfg!(target_os = "windows") {
            "C:\\__otools_aigv_missing__"
        } else {
            "/__otools_aigv_missing__"
        };
        assert!(read_dir(missing.to_string()).is_err());
    }
}
