/**
 * BaseAgent.ts — 多智能体 (Multi-Agent) 抽象基类与接口定义
 */

import type { ProjectBlackboard, BlackboardData } from './ProjectBlackboard';

import type { SlotId } from '@/core/config/model-settings/types';


export type AgentRoleType =
  | 'director'
  | 'script_ingestion'
  | 'character_designer'
  | 'storyboard_artist'
  | 'sound_engineer'
  | 'video_editor'
  | 'custom';

/**
 * 内置角色 → 默认槽位（P5：MasterDirector 按槽位解析提供方）。
 * 用户可在 AgentMetadata.slot 上覆盖；custom 默认归 util.fast（便宜小模型）。
 */
export const ROLE_TO_SLOT: Record<AgentRoleType, SlotId | undefined> = {
  director: undefined,
  script_ingestion: 'script.ingest',
  character_designer: 'character.design',
  storyboard_artist: 'storyboard.plan',
  sound_engineer: 'audio.tts',
  video_editor: 'video.generate',
  custom: 'util.fast',
};

export type TriggerPhase =
  | 'on_input_submitted'
  | 'on_script_parsed'
  | 'on_character_anchored'
  | 'on_storyboard_generated'
  | 'on_audio_synthesized'
  | 'on_custom_event';

export interface AgentMetadata {
  id: string;
  name: string;
  role: AgentRoleType;
  avatar?: string;
  description: string;
  systemPrompt?: string;
  triggerPhase: TriggerPhase;
  readKeys: Array<keyof BlackboardData>;
  writeKeys: Array<keyof BlackboardData>;
  isCustom?: boolean;
  enabled?: boolean;
  /** P5：该 Agent 负责的流程环节槽位；缺省按 ROLE_TO_SLOT 推断 */
  slot?: SlotId;
}

export abstract class BaseAgent {
  public metadata: AgentMetadata;

  constructor(metadata: AgentMetadata) {
    this.metadata = {
      enabled: true,
      isCustom: false,
      ...metadata,
    };
  }

  public abstract execute(blackboard: ProjectBlackboard): Promise<void>;

  protected log(blackboard: ProjectBlackboard, action: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') {
    blackboard.addLog({
      agentId: this.metadata.id,
      agentName: this.metadata.name,
      action,
      level,
    });
  }
}
