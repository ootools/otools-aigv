/**
 * ModelProviderSettings 网关优先（P9）冒烟测试
 * 验证：网关实例显示「网关」徽标；添加提供方 Dialog 出现「从模板开始」。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import SettingsPage from '@/pages/settings/SettingsPage';

describe('ModelProviderSettings 网关优先（P9）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('网关实例显示「网关」徽标；添加 Dialog 出现「从模板开始」', async () => {
    localStorage.setItem(
      MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        providers: [
          {
            id: 'gw1',
            label: 'AI Switch 网关',
            capability: 'text',
            protocol: 'openai-chat',
            baseUrl: 'http://127.0.0.1:1234/v1',
            apiKey: 'k',
            authStyle: 'bearer',
            modelSource: 'auto',
            enabled: true,
            createdAt: 1,
            isGateway: true,
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

    await waitFor(() => expect(screen.getByText('AI Switch 网关')).toBeInTheDocument());
    // 网关徽标
    expect(screen.getByText('网关')).toBeInTheDocument();

    // 打开「添加提供方」Dialog → 出现「从模板开始」
    fireEvent.click(screen.getByText('添加提供方'));
    await waitFor(() => expect(screen.getByText('从模板开始')).toBeInTheDocument());
  });
});
