/**
 * ProjectModelOverrideSettings（P6）冒烟测试
 * 验证：未打开工程时给提示；打开工程后读出该项目已保存的覆盖（优先级高于全局）。
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import type { ProjectData } from '@/common/types';
import { resetProjectOverrideCache } from '@/core/config/model-settings/project-overrides';
import { MODEL_SETTINGS_STORAGE_KEY, PROJECT_OVERRIDES_STORAGE_KEY } from '@/core/config/model-settings/types';
import ProjectModelOverrideSettings from '@/pages/settings/ProjectModelOverrideSettings';
import { ModelSettingsProvider } from '@/pages/settings/useModelSettings';
import { useProjectStore } from '@/stores/project/project-store';

function renderPanel() {
  return render(
    <ThemeProvider>
      <ModelSettingsProvider>
        <ProjectModelOverrideSettings />
      </ModelSettingsProvider>
    </ThemeProvider>
  );
}

function fakeProject(id: string, name: string): ProjectData {
  return { id, name, createdAt: '2026-01-01', updatedAt: '2026-01-01' } as ProjectData;
}

describe('ProjectModelOverrideSettings (P6)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetProjectOverrideCache();
    useProjectStore.getState().setCurrentProject(null);
  });

  afterEach(() => {
    useProjectStore.getState().setCurrentProject(null);
    resetProjectOverrideCache();
  });

  it('未打开工程时给出提示', async () => {
    localStorage.setItem(
      MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, providers: [], capabilityDefaults: {}, slotBindings: {} })
    );
    renderPanel();

    await waitFor(() => expect(screen.getByText('项目级覆盖')).toBeInTheDocument());
    expect(screen.getByText(/未打开任何工程/)).toBeInTheDocument();
  });

  it('打开工程后读出该项目已保存的覆盖', async () => {
    localStorage.setItem(
      MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({
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
        capabilityDefaults: {},
        slotBindings: {},
      })
    );
    localStorage.setItem(
      PROJECT_OVERRIDES_STORAGE_KEY,
      JSON.stringify({ 'proj-1': { capabilityDefaults: { text: { providerId: 'txt1' } } } })
    );

    useProjectStore.getState().setCurrentProject(fakeProject('proj-1', '测试工程'));
    renderPanel();

    await waitFor(() => expect(screen.getByText(/测试工程/)).toBeInTheDocument());
    // 覆盖回显：文本能力 = DeepSeek 官方（默认模型）
    expect(screen.getByText('DeepSeek 官方（默认模型）')).toBeInTheDocument();
    expect(screen.getByText(/已覆盖 1 项/)).toBeInTheDocument();
  });
});
