/**
 * ModelAllocationSettings (P4-2) 冒烟测试
 * 验证模型分配表：8 个已知 Agent 槽位 + 4 个能力默认都渲染；
 * 已配置的槽位绑定 / 能力默认能从共享状态正确读出并显示在 Select 上。
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import ModelAllocationSettings from '@/pages/settings/ModelAllocationSettings';
import { ModelSettingsProvider } from '@/pages/settings/useModelSettings';

const SEED_KEY = MODEL_SETTINGS_STORAGE_KEY;

function seed(settings: unknown) {
  localStorage.setItem(SEED_KEY, JSON.stringify(settings));
}

function renderAlloc() {
  return render(
    <ThemeProvider>
      <ModelSettingsProvider>
        <ModelAllocationSettings />
      </ModelSettingsProvider>
    </ThemeProvider>
  );
}

const KNOWN_SLOTS = [
  'script.ingest',
  'script.rewrite',
  'character.design',
  'storyboard.plan',
  'storyboard.image',
  'video.generate',
  'audio.tts',
  'util.fast',
];

describe('ModelAllocationSettings (P4-2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('渲染 8 个 Agent 槽位 + 4 个能力默认 + 表头', async () => {
    seed({ schemaVersion: 2, providers: [], capabilityDefaults: {}, slotBindings: {} });
    renderAlloc();

    await waitFor(() => expect(screen.getByText('script.ingest')).toBeInTheDocument());

    for (const slot of KNOWN_SLOTS) {
      expect(screen.getByText(slot)).toBeInTheDocument();
    }
    for (const cap of ['文本', '图像', '视频', '语音']) {
      expect(screen.getByText(cap)).toBeInTheDocument();
    }
    expect(screen.getByText('流程环节 / 智能体槽位')).toBeInTheDocument();
    expect(screen.getByText('绑定模型')).toBeInTheDocument();
  });

  it('读出已配置的槽位绑定（回显「提供方（默认模型）」）', async () => {
    seed({
      schemaVersion: 2,
      providers: [
        {
          id: 'vid1',
          label: '可灵官方',
          capability: 'video',
          protocol: 'vendor-task',
          vendorDescriptorId: 'kling-official',
          baseUrl: 'https://api.kling.com',
          apiKey: 'k',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 1,
          defaultModel: 'kling-v2-6',
        },
      ],
      capabilityDefaults: {},
      slotBindings: {
        'video.generate': { slot: 'video.generate', capability: 'video', ref: { providerId: 'vid1' } },
      },
    });
    renderAlloc();

    await waitFor(() => expect(screen.getByText('video.generate')).toBeInTheDocument());
    // 槽位绑定回显：提供方（默认模型）
    expect(screen.getByText('可灵官方（默认模型）')).toBeInTheDocument();
  });

  it('读出已配置的能力默认', async () => {
    seed({
      schemaVersion: 2,
      providers: [
        {
          id: 'txt1',
          label: 'DeepSeek 官方',
          capability: 'text',
          protocol: 'openai-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'k',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 1,
          defaultModel: 'deepseek-chat',
        },
      ],
      capabilityDefaults: { text: { providerId: 'txt1' } },
      slotBindings: {},
    });
    renderAlloc();

    await waitFor(() => expect(screen.getByText('script.ingest')).toBeInTheDocument());
    expect(screen.getByText('DeepSeek 官方（默认模型）')).toBeInTheDocument();
  });
});
