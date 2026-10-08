/**
 * 存储后端抽象（P1）
 *
 * 设计见 §3.7：凭据落到「单一状态键 aigv.modelSettings」，走 OTools 插件本地状态。
 * 但插件在 Web / jsdom（测试）环境下没有 native 后端，需要回退到 localStorage。
 * 这里用单一 key 的后端接口把两种介质统一起来。
 */

/** 单键存储后端：load/save 以字符串（JSON）为单位 */
export interface SettingsBackend {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

/** localStorage 后端：Web / 测试回退，直接读写 localStorage */
export class LocalStorageBackend implements SettingsBackend {
  constructor(private readonly key: string) {}

  async load(): Promise<string | null> {
    try {
      return localStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  async save(value: string): Promise<void> {
    try {
      localStorage.setItem(this.key, value);
    } catch {
      /* 配额 / 隐私模式：静默 */
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* 静默 */
    }
  }
}

/**
 * OTools 插件本地状态后端：用 Store shim 落盘到 ~/.otools/local/aigv/<file>。
 * Store 以 JSON 对象为存储单元，这里把 ModelSettings 的 JSON 字符串作为该 key 的值存进去。
 */
export class OtoolsStoreBackend implements SettingsBackend {
  private storePromise: Promise<import('@/infrastructure/otools-shims/store-shim').Store> | null = null;

  constructor(
    private readonly file: string,
    private readonly key: string
  ) {}

  private async resolveStore(): Promise<import('@/infrastructure/otools-shims/store-shim').Store> {
    if (!this.storePromise) {
      const storeModule = await import('@/infrastructure/otools-shims/store-shim');
      this.storePromise = storeModule.Store.load(this.file);
    }
    return this.storePromise;
  }

  async load(): Promise<string | null> {
    const store = await this.resolveStore();
    const value = await store.get<string>(this.key);
    return value == null ? null : String(value);
  }

  async save(value: string): Promise<void> {
    const store = await this.resolveStore();
    await store.set(this.key, value);
    await store.save();
  }

  async clear(): Promise<void> {
    const store = await this.resolveStore();
    await store.delete(this.key);
    await store.save();
  }
}
