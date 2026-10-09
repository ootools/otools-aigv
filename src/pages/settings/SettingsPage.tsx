import { FolderOpen, Settings as SettingsIcon } from 'lucide-react';
import React, { useState } from 'react';

import ModelProviderSettings from './ModelProviderSettings';

import { Button } from '@/common/components/ui/button';
import { Input } from '@/common/components/ui/input';
import { toast } from '@/common/components/ui/toast';
import { tauriService } from '@/infrastructure/tauri-bridge/commands';


const SettingsPage = () => {
  const [workingDir, setWorkingDir] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const savedDir = localStorage.getItem('novella_working_dir');
      if (savedDir && savedDir.trim().length > 0) return savedDir;
    }
    return '/Users/Novella/NovellaWorkingDirectory';
  });

  const handleSaveWorkingDir = (dirPath: string) => {
    const trimmed = dirPath.trim();
    if (!trimmed) return;
    setWorkingDir(trimmed);
    if (typeof window !== 'undefined') {
      localStorage.setItem('novella_working_dir', trimmed);
    }
    toast.success(`🎉 已应用新的工作目录路径: ${trimmed}`);
  };

  const handleSelectWorkingDir = async () => {
    try {
      const selected = await tauriService.openFile({
        directory: true,
        title: '选择本地工程工作目录',
      });
      if (selected && typeof selected === 'string') {
        handleSaveWorkingDir(selected);
      } else if (Array.isArray(selected) && selected.length > 0) {
        handleSaveWorkingDir(selected[0]);
      }
    } catch (_e) {
      toast.info('可通过文本框直接编辑工作目录路径');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      {/* 头部标题区 */}
      <div className="studio-card p-6 space-y-1">
        <h2 className="text-xl font-bold text-[var(--foreground)] flex items-center gap-2">
          <SettingsIcon className="w-5 h-5 text-indigo-400" />
          系统偏好设置
        </h2>
        <p className="text-xs text-[var(--muted-foreground)]">
          配置文字、图像、视频与语音大模型的提供方（支持真实连通性探测与模型拉取）
        </p>
      </div>

      {/* 第一区: AI 模型提供方配置（新架构：按能力管理 + 真实探测） */}
      <ModelProviderSettings />

      {/* 第二区: 本地工程工作目录 */}
      <div className="studio-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-indigo-400" />
              本地工程工作目录
            </h3>
            <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
              漫剧工程文件、4K 视频压制缓存与 TTS 音轨数据的本地绝对存储路径
            </p>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono font-bold">
            SSD 高速盘
          </span>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 flex items-center">
              <FolderOpen className="w-4 h-4 text-[var(--muted-foreground)] absolute left-3 pointer-events-none" />
              <Input
                value={workingDir}
                onChange={(e) => handleSaveWorkingDir(e.target.value)}
                className="pl-9 bg-transparent border border-[var(--border)] text-xs rounded-xl flex-1 font-mono text-[var(--foreground)] outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 focus:border-[var(--border)] focus:shadow-none shadow-none py-2.5"
              />
            </div>
            <Button
              onClick={handleSelectWorkingDir}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2.5 rounded-xl cursor-pointer border-0 font-bold"
            >
              更改路径
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
