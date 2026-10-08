/**
 * `@tauri-apps/api/window` 的 OTools 替代实现
 * ---------------------------------------------------------------
 * OTools 插件运行在宿主（Tauri 宿主）的 webview 里，插件 dylib 无权操作宿主窗口，
 * 窗口管理只能经宿主 runtime 的 `plugin:window|*` 命令。这里：
 *  - 宿主暴露了 `__TAURI_INTERNALS__.invoke` 时，转发到宿主的窗口命令；
 *  - 否则退化为无副作用实现（读操作给出浏览器可用值），保证插件不崩。
 *
 * 相比 OTools SDK 自带的 window shim，这里补齐了上游 Novella 实际用到的
 * `setTitle` / `setFullscreen` / `isFullscreen` / `maximize` / `unmaximize`，
 * 以及 `LogicalSize` / `LogicalPosition` 这两个位置尺寸类。
 */

type TauriInternalsLike = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  metadata?: { currentWindow?: { label?: string } };
};

const getInternals = (): TauriInternalsLike | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriInternalsLike }).__TAURI_INTERNALS__;
};

const resolveWindowLabel = (): string => getInternals()?.metadata?.currentWindow?.label ?? '';

const hasWindowBridge = (): boolean => typeof getInternals()?.invoke === 'function';

const invokeWindow = <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
  const internals = getInternals();
  if (!internals?.invoke) {
    return Promise.reject(new Error('宿主窗口运行时不可用'));
  }
  return internals.invoke(`plugin:window|${command}`, {
    label: resolveWindowLabel(),
    ...args,
  }) as Promise<T>;
};

/** 逻辑尺寸（Tauri 语义：与缩放比无关） */
export class LogicalSize {
  readonly type = 'Logical';
  constructor(
    public width: number,
    public height: number,
  ) {}
}

/** 逻辑位置 */
export class LogicalPosition {
  readonly type = 'Logical';
  constructor(
    public x: number,
    public y: number,
  ) {}
}

/** 物理尺寸 */
export class PhysicalSize {
  readonly type = 'Physical';
  constructor(
    public width: number,
    public height: number,
  ) {}
}

/** 物理位置 */
export class PhysicalPosition {
  readonly type = 'Physical';
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export interface SizeLike {
  type?: string;
  width: number;
  height: number;
}

export interface PositionLike {
  type?: string;
  x: number;
  y: number;
}

/** 把逻辑/物理尺寸实例规约成宿主命令能接受的普通对象 */
const toSizePayload = (size: SizeLike | PhysicalSize): Record<string, number> => ({
  width: size.width,
  height: size.height,
});

const toPositionPayload = (position: PositionLike | PhysicalPosition): Record<string, number> => ({
  x: position.x,
  y: position.y,
});

export interface WindowShim {
  label: string;
  close(): Promise<void>;
  destroy(): Promise<void>;
  show(): Promise<void>;
  hide(): Promise<void>;
  setFocus(): Promise<void>;
  setTitle(title: string): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  unmaximize(): Promise<void>;
  isMaximized(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  isAlwaysOnTop(): Promise<boolean>;
  setSize(size: SizeLike): Promise<void>;
  setPosition(position: PositionLike): Promise<void>;
  center(): Promise<void>;
  innerSize(): Promise<{ width: number; height: number }>;
  outerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  onResized(handler: () => void): Promise<() => void>;
  onDragDropEvent(handler: (event: unknown) => void): Promise<() => void>;
}

/** 取当前窗口（OTools 宿主里即插件所在的 webview 窗口/标签页） */
export function getCurrentWindow(): WindowShim {
  const label = resolveWindowLabel();

  if (!hasWindowBridge()) {
    // 无宿主窗口桥：所有写操作无副作用，读操作给出浏览器可用的近似值。
    return {
      label,
      async close() {},
      async destroy() {},
      async show() {},
      async hide() {},
      async setFocus() {},
      async setTitle(_title: string) {},
      async minimize() {},
      async maximize() {},
      async unmaximize() {},
      async isMaximized() {
        return false;
      },
      async setFullscreen(_fullscreen: boolean) {},
      async isFullscreen() {
        return Boolean(typeof document !== 'undefined' && document.fullscreenElement);
      },
      async setAlwaysOnTop(_alwaysOnTop: boolean) {},
      async isAlwaysOnTop() {
        return false;
      },
      async setSize(_size: SizeLike) {},
      async setPosition(_position: PositionLike) {},
      async center() {},
      async innerSize() {
        return {
          width: typeof window !== 'undefined' ? window.innerWidth : 0,
          height: typeof window !== 'undefined' ? window.innerHeight : 0,
        };
      },
      async outerPosition() {
        return {
          x: typeof window !== 'undefined' ? window.screenX : 0,
          y: typeof window !== 'undefined' ? window.screenY : 0,
        };
      },
      async scaleFactor() {
        return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      },
      async onResized(_handler: () => void) {
        return () => {};
      },
      async onDragDropEvent(_handler: (event: unknown) => void) {
        return () => {};
      },
    };
  }

  return {
    label,
    close: () => invokeWindow<void>('close'),
    destroy: () => invokeWindow<void>('destroy'),
    show: () => invokeWindow<void>('show'),
    hide: () => invokeWindow<void>('hide'),
    setFocus: () => invokeWindow<void>('set_focus'),
    setTitle: (title: string) => invokeWindow<void>('set_title', { title }),
    async minimize() {
      await invokeWindow<void>('minimize');
    },
    async maximize() {
      await invokeWindow<void>('maximize');
    },
    async unmaximize() {
      await invokeWindow<void>('unmaximize');
    },
    isMaximized: () => invokeWindow<boolean>('is_maximized'),
    setFullscreen: (fullscreen: boolean) => invokeWindow<void>('set_fullscreen', { fullscreen }),
    isFullscreen: () => invokeWindow<boolean>('is_fullscreen'),
    setAlwaysOnTop: (alwaysOnTop: boolean) =>
      invokeWindow<void>('set_always_on_top', { alwaysOnTop }),
    isAlwaysOnTop: () => invokeWindow<boolean>('is_always_on_top'),
    setSize: (size: SizeLike) => invokeWindow<void>('set_size', { size: toSizePayload(size) }),
    setPosition: (position: PositionLike) =>
      invokeWindow<void>('set_position', { position: toPositionPayload(position) }),
    async center() {
      await invokeWindow<void>('center');
    },
    innerSize: () => invokeWindow<{ width: number; height: number }>('inner_size'),
    outerPosition: () => invokeWindow<{ x: number; y: number }>('outer_position'),
    scaleFactor: () => invokeWindow<number>('scale_factor'),
    // 窗口事件需要宿主的 event 桥；插件里由宿主统一处理，这里不订阅。
    async onResized(_handler: () => void) {
      return () => {};
    },
    async onDragDropEvent(_handler: (event: unknown) => void) {
      return () => {};
    },
  };
}

/** 兼容 Tauri 里的默认导出用法 */
export default { getCurrentWindow };
