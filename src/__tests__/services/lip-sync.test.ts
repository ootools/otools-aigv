/**
 * 唇同步服务（新架构）
 * 凭据从 `model-settings` 的 `video.lipsync` 槽位解析；不再从 secureStorage 取 key。
 */

import axios from 'axios';

import { MODEL_SETTINGS_STORAGE_KEY } from '@/core/config/model-settings/types';
import {
  generateTalkingHead,
  getLipSyncStatus,
  syncLip,
} from '@/core/services/audio/lip-sync-service';

jest.mock('axios');

const mockedAxios = axios as unknown as jest.Mock;

function seedLipSyncProvider(baseUrl = 'https://api.sync.so') {
  localStorage.setItem(
    MODEL_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      providers: [
        {
          id: 'lip1',
          label: '唇同步提供方',
          capability: 'video',
          protocol: 'vendor-task',
          vendorDescriptorId: 'sync-so',
          baseUrl,
          apiKey: 'sk-lip',
          authStyle: 'bearer',
          modelSource: 'auto',
          enabled: true,
          createdAt: 1,
        },
      ],
      capabilityDefaults: {},
      slotBindings: {
        'video.lipsync': { slot: 'video.lipsync', capability: 'video', ref: { providerId: 'lip1' } },
      },
    })
  );
}

describe('lip-sync 服务（新架构）', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('syncLip → 用新配置的 baseUrl/apiKey 调 sync.so', async () => {
    seedLipSyncProvider();
    mockedAxios.mockResolvedValue({ data: { task_id: 't1', status: 'processing' } });

    const res = await syncLip('https://v/1.mp4', 'https://a/1.mp3');

    expect(mockedAxios).toHaveBeenCalledTimes(1);
    const arg = mockedAxios.mock.calls[0][0];
    expect(arg.url).toBe('https://api.sync.so/v2/lipsync');
    expect(arg.headers.Authorization).toBe('Bearer sk-lip');
    expect(arg.data.input).toEqual([
      { type: 'video', url: 'https://v/1.mp4' },
      { type: 'audio', url: 'https://a/1.mp3' },
    ]);
    expect(res.taskId).toBe('t1');
  });

  it('generateTalkingHead → 走 sadtalker 路径与字段（baseUrl 来自配置）', async () => {
    seedLipSyncProvider('https://api.sadtalker.io');
    mockedAxios.mockResolvedValue({ data: { task_id: 't2', status: 'processing' } });

    await generateTalkingHead('https://img/1.png', 'https://a/1.mp3');

    const arg = mockedAxios.mock.calls[0][0];
    expect(arg.url).toBe('https://api.sadtalker.io/v1/generate');
    expect(arg.data.source_image).toBe('https://img/1.png');
    expect(arg.data.driven_audio).toBe('https://a/1.mp3');
  });

  it('getLipSyncStatus → 用 taskId 拼路径', async () => {
    seedLipSyncProvider();
    mockedAxios.mockResolvedValue({ data: { status: 'completed', url: 'https://out/1.mp4' } });

    const res = await getLipSyncStatus('task-9');

    expect(mockedAxios.mock.calls[0][0].url).toBe('https://api.sync.so/v2/lipsync/task-9');
    expect(res.status).toBe('completed');
    expect(res.url).toBe('https://out/1.mp4');
  });

  it('未配置 video.lipsync 提供方 → 抛具名错误且不发请求', async () => {
    localStorage.setItem(
      MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, providers: [], capabilityDefaults: {}, slotBindings: {} })
    );

    await expect(syncLip('v', 'a')).rejects.toThrow(/未为「video\.lipsync」配置/);
    expect(mockedAxios).not.toHaveBeenCalled();
  });
});
