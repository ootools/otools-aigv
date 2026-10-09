/**
 * 模型 / 提供方配置 —— 新架构数据模型（P1）
 *
 * 设计见 docs/模型提供方配置架构设计.md 第三章「目标架构」。
 * 本文件只定义类型，不涉及存储与读取（见同目录 backend.ts / store.ts / migration.ts）。
 *
 * 核心认知：建模单位是「协议 + 能力」，不是「服务商」。服务商只是「协议 + 默认 baseUrl」的预设。
 */

/** 能力类型（用户提的四类 + 预留两类） */
export type Capability =
  | 'text' // 剧本、分镜规划、人设、杂活
  | 'image' // 分镜出图、锁脸参考图
  | 'video' // 分镜转视频
  | 'tts' // 配音
  | 'stt' // 预留：字幕/对轴
  | 'embedding'; // 预留：素材检索

/**
 * 协议（L1，代码实现，用户不可改）。
 * 区分「入口协议」（网关/插件认）与「上游协议」（各家官方，网关认）。
 */
export type ProtocolId =
  | 'openai-chat' // 文本事实标准
  | 'openai-images' // 图像事实标准
  | 'openai-speech' // 语音事实标准
  | 'openai-videos' // 视频 Sora 格式（标准化趋势，对齐 new-api）
  | 'vendor-task'; // 声明式适配器（可灵/方舟/MiniMax/智谱…见 §3.2）

/** 认证风格 */
export type AuthStyle = 'bearer' | 'x-api-key' | 'query' | 'none';

/** 流程环节 / 智能体槽位（L3 绑定层的目标） */
export type SlotId =
  | 'script.ingest' // 剧本/小说识别拆解
  | 'script.rewrite' // 剧本精修
  | 'character.design' // 角色人设 + 锁脸 prompt
  | 'storyboard.plan' // 分镜运镜规划
  | 'storyboard.image' // 分镜出图
  | 'video.generate' // 分镜转视频
  | 'audio.tts' // 配音
  | 'util.fast' // 标题/摘要/打标等杂活 → 便宜小模型
  | `custom.${string}`; // 用户自定义 Agent

/**
 * 槽位 → 能力（P5：解析时决定走哪个适配器 / 哪类模型）。
 * 已知槽位里只有 storyboard.image / video.generate / audio.tts 是非文本能力，
 * 其余（含 custom.*）都归文本。新增槽位时在此补充。
 */
export function capabilityForSlot(slot: SlotId): Capability {
  switch (slot) {
    case 'storyboard.image':
      return 'image';
    case 'video.generate':
      return 'video';
    case 'audio.tts':
      return 'tts';
    default:
      return 'text';
  }
}

/** 能力级默认参数（不同能力参数差别很大，不强行统一） */
export interface ProviderDefaults {
  // text
  temperature?: number;
  maxTokens?: number;
  // image
  size?: string;
  n?: number;
  negativePrompt?: string;
  // video
  durationSec?: number;
  resolution?: string;
  fps?: number;
  aspectRatio?: string;
  // tts
  voice?: string;
  speed?: number;
  pitch?: number;
  format?: string;
}

/** L2 提供方实例：配置的最小单位，用户可建任意多个 */
export interface ProviderInstance {
  id: string; // uuid / 稳定标识（不是 provider 名！改名不影响绑定）
  label: string; // 用户命名：「DeepSeek 官方」「公司中转站」
  capability: Capability; // 决定它出现在哪个选择器
  protocol: ProtocolId; // 决定用哪个适配器
  baseUrl: string; // 用户可填任意兼容端点
  apiKey: string;
  authStyle: AuthStyle;
  extraHeaders?: Record<string, string>; // 中转站常要的自定义头
  queryParams?: Record<string, string>; // 少数服务商走 query 传参

  // 鉴权扩展（vendor-task 的 jwt-hs256 等需要 ak/sk）
  accessKey?: string; // jwt-hs256 的 access key（如可灵）
  secretKey?: string; // jwt-hs256 的 secret key

  /**
   * 凭据继承（P6）：指向另一个 ProviderInstance 的 id，运行时用它的
   * baseUrl / apiKey / authStyle / extraHeaders / queryParams / ak / sk 发请求
   * （「图像 / 视频 / 语音实例继承文本实例的凭据」——多数中转站同一 key 全通）。
   * 留空 = 用自己的凭据。
   */
  credentialSourceId?: string;

  // 声明式适配器（protocol === 'vendor-task' 时引用内置描述符）
  vendorDescriptorId?: string; // 内置描述符注册表 key（如 'kling-official'）

  // 模型
  modelSource: 'auto' | 'manual'; // auto = 调 /models 拉取
  manualModels?: string[];
  modelFilter?: string[]; // auto 拉取后的白名单（留空=全放行）
  prefix?: string; // 跨实例同名模型去重
  defaultModel?: string;

  // 能力级默认参数
  defaults?: ProviderDefaults;

  enabled: boolean;
  lastProbe?: { at: number; ok: boolean; latencyMs?: number; error?: string };
  /** /models 拉取结果缓存（不每次打开都请求；P3 写入，P4 设置页读 + 刷新） */
  fetchedModels?: { at: number; models: string[]; source: 'auto' | 'candidate' | 'manual' };
  createdAt: number;
}

/** L3 模型引用：不落库为独立实体，只是引用。modelId 可空（空 → 回退 provider.defaultModel） */
export interface ModelRef {
  providerId: string;
  modelId?: string;
}

/** 绑定层：槽位 → 模型分配 */
export interface SlotBinding {
  slot: SlotId;
  capability: Capability; // 该槽位需要什么能力
  ref?: ModelRef; // 不填 = 回退该能力的默认实例
  overrides?: Record<string, unknown>; // 槽位专属参数覆盖
}

/** 全局配置根 */
export interface ModelSettings {
  schemaVersion: number;
  providers: ProviderInstance[];
  capabilityDefaults: Partial<Record<Capability, ModelRef | undefined>>; // Dify 的 Default Models
  slotBindings: Partial<Record<SlotId, SlotBinding | undefined>>;
}

/** 项目级覆盖（P6，类型先行） */
export interface ProjectModelOverride {
  slotBindings?: Partial<Record<SlotId, ModelRef | undefined>>;
  capabilityDefaults?: Partial<Record<Capability, ModelRef | undefined>>;
}

/** 当前 schema 版本（迁移用） */
export const MODEL_SETTINGS_SCHEMA_VERSION = 2;

/** 单一状态键（走 OTools 插件本地状态 / localStorage 回退） */
export const MODEL_SETTINGS_STORAGE_KEY = 'aigv.modelSettings';

/** 项目级覆盖的状态键（P6：按 projectId 存 ProjectModelOverride） */
export const PROJECT_OVERRIDES_STORAGE_KEY = 'aigv.projectModelOverrides';
