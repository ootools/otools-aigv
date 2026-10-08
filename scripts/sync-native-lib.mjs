/**
 * 把 cargo 产出的 cdylib 按 OTools 宿主约定同步到 `lib/`。
 * ---------------------------------------------------------------
 * 宿主按平台固定文件名加载 native 库（见 otools 的
 * `src-tauri/src/platform/native_plugins/core.rs::platform_lib_name`）：
 *   Windows -> lib/Windows.dll
 *   macOS   -> lib/macOS.dylib
 *   Linux   -> lib/Linux.so
 *
 * 用法：node scripts/sync-native-lib.mjs [--profile release|debug] [--out-name macOS-arm64.dylib]
 *
 * `--out-name` 用于 CI 的多架构 staging：macOS 上先分别产出
 * `macOS-arm64.dylib` / `macOS-x86_64.dylib`，再由打包 job 用 lipo 合成
 * `macOS.dylib`（见 .github/workflows/release-plugin.yml）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const profile = arg('profile', 'release');

/** 宿主约定的目标文件名 */
const targetLibName = () => {
  const override = String(arg('out-name', '') || '').trim();
  if (override) {
    if (path.basename(override) !== override) {
      throw new Error(`--out-name 不能包含路径分隔符：${override}`);
    }
    return override;
  }
  if (process.platform === 'win32') return 'Windows.dll';
  if (process.platform === 'darwin') return 'macOS.dylib';
  if (process.platform === 'linux') return 'Linux.so';
  throw new Error(`不支持的平台：${process.platform}`);
};

/** cargo 产出的文件名 */
const builtLibName = () => {
  if (process.platform === 'win32') return 'otools_aigv_native.dll';
  if (process.platform === 'darwin') return 'libotools_aigv_native.dylib';
  return 'libotools_aigv_native.so';
};

const source = path.join(repoRoot, 'target', profile, builtLibName());
if (!fs.existsSync(source)) {
  console.error(`找不到构建产物：${source}`);
  console.error(`请先执行：cargo build ${profile === 'release' ? '--release' : ''} -p otools-aigv-native`);
  process.exit(1);
}

const targetDir = path.join(repoRoot, 'lib');
fs.mkdirSync(targetDir, { recursive: true });
const target = path.join(targetDir, targetLibName());

// 覆盖前留一份备份，便于回滚（与仓库既有 *.bak-<时间戳> 约定一致）
if (fs.existsSync(target)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(target, `${target}.bak-${stamp}`);
}

fs.copyFileSync(source, target);
const sizeMb = (fs.statSync(target).size / 1024 / 1024).toFixed(2);
console.log(`已同步 native 库：${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, target)} (${sizeMb} MB)`);
