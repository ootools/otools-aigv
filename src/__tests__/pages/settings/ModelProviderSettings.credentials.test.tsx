/**
 * ModelProviderSettings 凭据复制 / 继承入口（P6）集成测试
 * 验证：已有其它实例时，「添加提供方」Dialog 出现「从已有实例复制凭据」与「继承凭据自」入口。
 * （Radix Select 选项在 portal 内、需交互展开，故只断言入口渲染，证明接线正确。）
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import SettingsPage from '@/pages/settings/SettingsPage';

describe('ModelProviderSettings 凭据复制 / 继承入口 (P6)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('已有实例时，添加提供方 Dialog 出现复制 / 继承凭据入口', async () => {
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
          },
        ],
        capabilityDefaults: {},
        slotBindings: {},
      })
    );

    render(
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    );

    await waitFor(() => expect(screen.getByText('DeepSeek 官方')).toBeInTheDocument());

    // 打开「添加提供方」Dialog（默认「文本」Tab）
    fireEvent.click(screen.getByText('添加提供方'));

    await waitFor(() => expect(screen.getByText('从已有实例复制凭据')).toBeInTheDocument());
    expect(screen.getByText('继承凭据自（可选）')).toBeInTheDocument();
  });
});
