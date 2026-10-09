/**
 * ModelProviderSettings (P4) 冒烟测试
 * 验证新架构的设置页：按能力分 Tab、空状态、旧的硬编码 provider 列表已移除。
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { ThemeProvider } from '@/app/providers/ThemeContext';
import SettingsPage from '@/pages/settings/SettingsPage';

const renderWithProviders = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

describe('ModelProviderSettings (P4) smoke', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('加载后渲染按能力分 Tab 的新 UI，且旧的硬编码 provider 列表已移除', async () => {
    renderWithProviders(<SettingsPage />);

    await waitFor(() => {
      expect(screen.getByText('文本')).toBeInTheDocument();
    });

    // 四个能力 Tab 都出现
    expect(screen.getByText('图像')).toBeInTheDocument();
    expect(screen.getByText('视频')).toBeInTheDocument();
    expect(screen.getByText('语音')).toBeInTheDocument();

    // 空状态（每个能力 Tab 各一条，至少 1 条）
    expect(screen.getAllByText(/暂无该能力的提供方/).length).toBeGreaterThan(0);

    // 每个能力都有「添加提供方」入口
    expect(screen.getAllByText('添加提供方').length).toBeGreaterThan(0);

    // 旧的硬编码 provider（OpenAI 官方接口等）已从页面移除
    expect(screen.queryByText('OpenAI 官方接口')).toBeNull();
  });
});
