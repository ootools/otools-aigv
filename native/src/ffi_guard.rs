//! OTools native 插件的 panic 安全 FFI 边界助手（自 `otools/crates/ot-plugin-ffi` 内联）。
//!
//! # 为什么需要它
//!
//! `otools_plugin_invoke` 是 `extern "C"` 边界。插件内部 panic **无法跨 DLL unwind**：
//! C 调用约定没有 unwind 机制，运行时会走 `panic_cannot_unwind` → `abort()`。
//! Windows 上表现为 `0xC000001D`（`ud2` + `__fastfail`），整个宿主进程被杀。
//!
//! # 做法
//!
//! 在插件内部、FFI 入口处捕获 panic，转成普通错误响应。这样不会有任何东西跨边界
//! unwind，宿主存活，用户看到的是正常报错而不是整个会话丢失。
//!
//! 这要求 cdylib 以 `panic = "unwind"` 构建（见仓库根 `Cargo.toml` 的 release profile）。
//!
//! # 为什么内联而不是依赖 `ot-plugin-ffi`
//!
//! 本插件是独立仓库（不位于 otools 主仓库内），用相对路径依赖 `otools/crates/ot-plugin-ffi`
//! 会把构建绑死在「两个仓库恰好并列检出」这个前提上。这里内联同一份契约，
//! 保持插件自包含。契约本身（响应信封 `{ ok, data }` / `{ ok, error }`、
//! `otools_plugin_invoke` / `otools_plugin_free` 的 C ABI）与宿主保持一致。

use serde_json::{json, Value};

/// 把 JSON 响应缓冲区按 C ABI 契约交给宿主：返回指针，长度写入 `output_len`。
///
/// # Safety
///
/// `ptr` 必须来自一个 `len` 长度的 `Vec<u8>`，所有权转移给宿主
/// （宿主最终会把它交回 `otools_plugin_free`）。
pub fn take_json_response(mut output: Vec<u8>, output_len: *mut usize) -> *mut u8 {
    if output.is_empty() {
        // 零长度缓冲区会让宿主的 `from_raw_parts` 变成非法调用。
        output.extend_from_slice(b"{}");
    }
    let len = output.len();
    unsafe {
        *output_len = len;
    }
    let ptr = output.as_mut_ptr();
    // 所有权已交给宿主，这里不能 drop。
    std::mem::forget(output);
    ptr
}

/// 构造 panic 被捕获时的 JSON 响应体。
fn panic_response(plugin: &str, message: &str) -> Value {
    json!({
        "ok": false,
        "error": format!("插件 {plugin} 内部错误: {message}"),
        "panic": true,
        "plugin": plugin,
    })
}

/// 从 panic payload 中取出可读信息。
fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_string();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "unknown panic payload".to_string()
}

/// 被守卫的 `otools_plugin_invoke` 主体。
///
/// `logic` 收到原始输入切片，返回 JSON 响应值或错误字符串；`logic` 内部任何 panic
/// 都会被捕获并转成错误响应，宿主进程不受影响。
///
/// # Safety
///
/// `input_ptr`/`input_len` 必须描述一段可读内存，`output_len` 必须是可写指针。
pub fn guard_invoke<F>(input_ptr: *const u8, input_len: usize, output_len: *mut usize, logic: F) -> *mut u8
where
    F: FnOnce(&[u8]) -> Result<Value, String>,
{
    const PLUGIN: &str = env!("CARGO_PKG_NAME");

    if input_ptr.is_null() || output_len.is_null() {
        return std::ptr::null_mut();
    }

    let input = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };

    // `AssertUnwindSafe` 是合理的：跨边界时我们没有持有宿主侧的不变式，
    // 而代价是丢掉整个进程。payload 只被格式化成字符串。
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| logic(input)));

    let response = match outcome {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({ "ok": false, "error": error }),
        Err(payload) => {
            let message = payload_message(payload.as_ref());
            panic_response(PLUGIN, &message)
        }
    };

    let encoded = serde_json::to_vec(&response)
        .unwrap_or_else(|_| br#"{"ok":false,"error":"serialize failed"}"#.to_vec());
    take_json_response(encoded, output_len)
}

/// `otools_plugin_free` 的主体。
///
/// 重建 `Vec` 是这里唯一可能真正出错的操作（长度不匹配即未定义行为），
/// 因此要校验并加守卫，而不是无条件信任。
///
/// **不要在这里加 `#[no_mangle]`**：本函数被编进插件 cdylib，而插件自己已经导出了
/// `otools_plugin_free`，在这里再导一次会在 Windows 上链接冲突（LNK2005）。
pub fn free_response(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let outcome = std::panic::catch_unwind(|| unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    });
    if outcome.is_err() {
        // 故意静默：重复释放是调用方的 bug，这里无法修复，
        // 但再 panic 一次只会把问题放大。
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn invoke_with<F>(input: &[u8], logic: F) -> Value
    where
        F: FnOnce(&[u8]) -> Result<Value, String> + std::panic::UnwindSafe,
    {
        let mut len: usize = 0;
        let ptr = guard_invoke(input.as_ptr(), input.len(), &mut len, logic);
        assert!(!ptr.is_null(), "guard 必须总是返回缓冲区");
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        let value: Value = serde_json::from_slice(bytes).expect("响应必须是 JSON");
        free_response(ptr, len);
        value
    }

    #[test]
    fn success_path_returns_value() {
        let value = invoke_with(b"{}", |_| Ok(json!({ "ok": true, "v": 7 })));
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["v"], json!(7));
    }

    #[test]
    fn error_path_is_returned_as_error_response() {
        let value = invoke_with(b"{}", |_| Err("bad request".to_string()));
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["error"], json!("bad request"));
    }

    #[test]
    fn panic_is_caught_and_reported_not_propagated() {
        // 重点：这里绝不能 unwind 出 FFI 边界。
        let value = invoke_with(b"{}", |_| panic!("plugin blew up"));
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["panic"], json!(true));
        assert!(value["error"].as_str().unwrap().contains("plugin blew up"));
    }

    #[test]
    fn null_input_pointer_is_rejected() {
        let mut len: usize = 0;
        let ptr = guard_invoke(std::ptr::null(), 0, &mut len, |_| Ok(json!({})));
        assert!(ptr.is_null());
    }

    #[test]
    fn null_output_pointer_is_rejected() {
        let input = b"{}";
        let ptr = guard_invoke(input.as_ptr(), input.len(), std::ptr::null_mut(), |_| Ok(json!({})));
        assert!(ptr.is_null());
    }

    #[test]
    fn empty_response_is_replaced_with_valid_json() {
        let mut len: usize = 0;
        let ptr = take_json_response(Vec::new(), &mut len);
        assert!(!ptr.is_null());
        assert!(len > 0);
        let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
        let value: Value = serde_json::from_slice(bytes).expect("合法 JSON");
        assert!(value.is_object());
        free_response(ptr, len);
    }

    #[test]
    fn input_slice_reaches_the_closure_unchanged() {
        let payload = br#"{"method":"ping"}"#;
        let value = invoke_with(payload, |input| {
            assert_eq!(input, payload);
            Ok(json!({ "ok": true }))
        });
        assert_eq!(value["ok"], json!(true));
    }
}
