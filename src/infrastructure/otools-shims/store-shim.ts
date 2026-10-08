/**
 * `@tauri-apps/plugin-store` 的 OTools 替代实现
 * ---------------------------------------------------------------
 * Tauri 的 store 插件把 JSON 落盘在应用数据目录。插件里用本插件 native 后端
 * 的 `read_text_file` / `write_text_file` 操作 `~/.otools/local/aigv/<文件>`，
 * 保持相同的读写语义（load → get/set → save）。
 *
 * 上游只用到 `Store.load(filename)` 与 get / set / delete / keys / save，
 * 这里一并补齐 entries / values / clear / reload。
 */

import { appDataDir } from './path-shim';
import { exists, readTextFile, writeTextFile } from './fs-shim';

type StoreData = Record<string, unknown>;

export interface StoreOptions {
  autoSave?: boolean | number;
  defaults?: StoreData;
}

export class Store {
  private data: StoreData = {};
  private readonly path: string;

  private constructor(path: string) {
    this.path = path;
  }

  /** 打开（不存在则创建空 store，与 Tauri 行为一致） */
  static async load(path: string, options?: StoreOptions): Promise<Store> {
    const store = new Store(path);
    await store.reload();

    if (options?.defaults) {
      let changed = false;
      for (const [key, value] of Object.entries(options.defaults)) {
        if (!(key in store.data)) {
          store.data[key] = value;
          changed = true;
        }
      }
      if (changed) await store.save();
    }

    return store;
  }

  /** `Store.load` 的别名，Tauri 里两者都存在 */
  static async getStore(path: string, options?: StoreOptions): Promise<Store> {
    return Store.load(path, options);
  }

  private async absolutePath(): Promise<string> {
    if (/^([A-Za-z]:[\\/]|\/)/.test(this.path)) return this.path;
    const base = await appDataDir();
    const separator = base.includes('\\') ? '\\' : '/';
    return base ? `${base}${separator}${this.path}` : this.path;
  }

  /** 从磁盘重新读取 */
  async reload(): Promise<void> {
    try {
      const filePath = await this.absolutePath();
      if (!(await exists(filePath))) {
        this.data = {};
        return;
      }
      const raw = await readTextFile(filePath);
      const parsed: unknown = raw.trim() ? JSON.parse(raw) : {};
      this.data = parsed && typeof parsed === 'object' ? (parsed as StoreData) : {};
    } catch {
      // 文件损坏或不可读时按空 store 处理，避免整个应用起不来
      this.data = {};
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value = this.data[key];
    return (value === undefined ? null : value) as T | null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
  }

  async delete(key: string): Promise<boolean> {
    if (!(key in this.data)) return false;
    delete this.data[key];
    return true;
  }

  async keys(): Promise<string[]> {
    return Object.keys(this.data);
  }

  async values<T>(): Promise<T[]> {
    return Object.values(this.data) as T[];
  }

  async entries<T>(): Promise<[string, T][]> {
    return Object.entries(this.data) as [string, T][];
  }

  async has(key: string): Promise<boolean> {
    return key in this.data;
  }

  async clear(): Promise<void> {
    this.data = {};
  }

  async length(): Promise<number> {
    return Object.keys(this.data).length;
  }

  async save(): Promise<void> {
    await writeTextFile(await this.absolutePath(), JSON.stringify(this.data, null, 2));
  }
}

export default Store;
