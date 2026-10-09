/**
 * ModelProviderSettings 试跑入口（P4-2）集成测试
 * 验证：vendor-task 提供方卡片显示「试跑描述符」按钮，非 vendor-task 不显示；
 * 点击按钮打开回显 Dialog（标题出现，证明 handler → dialog 接线正确）。
 * 网络结果依赖运行环境（jsdom 无 fetch 或请求失败），故只断言 Dialog 打开与标题。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import SettingsPage from '@/pages/settings/SettingsPage';

function seed(settings: unknown) {
  localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

describe('ModelProviderSettings 试跑描述符入口 (P4-2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('文本提供方（openai-chat）不显示试跑入口；视频 vendor-task 提供方显示且可打开回显 Dialog', async () => {
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
        },
        {
          id: 'vid1',
          label: '可灵官方',
          capability: 'video',
          protocol: 'vendor-task',
          vendorDescriptorId: 'kling-official',
          baseUrl: 'https://api.kling.com',
          apiKey: 'k',
          accessKey: 'ak',
          secretKey: 'sk',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 2,
          defaultModel: 'kling-v2-6',
        },
      ],
      capabilityDefaults: {},
      slotBindings: {},
    });

    render(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    );

    // 默认在「文本」Tab：文本提供方卡片已挂载，且不带试跑入口
    await waitFor(() => expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument());
    expect(screen.queryByText('试跑描述符')).toBeNull();

    // 切到「视频」Tab：vendor-task 提供方卡片挂载，带试跑入口
    // Radix Tabs 在 automatic 模式下靠 mouseDown 激活（click 在 jsdom 不生效）
    fireEvent.mouseDown(screen.getByRole('tab', { name: '视频' }));
    await waitFor(() => expect(screen.getByText('可灵官方')).toBeInTheDocument());
    const dryRunBtn = screen.getByText('试跑描述符');
    expect(dryRunBtn).toBeInTheDocument();

    // 点击试跑 → 打开回显 Dialog
    fireEvent.click(dryRunBtn);
    await waitFor(() => expect(screen.getByText('试跑描述符：可灵官方')).toBeInTheDocument());
  });
});
