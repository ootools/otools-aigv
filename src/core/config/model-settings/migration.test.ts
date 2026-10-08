/**
 * P1 单元测试：老配置迁移 + 存储读写
 */

import {
  LocalStorageBackend,
  emptyModelSettings,
  loadModelSettings,
  loadOrMigrateModelSettings,
  migrateLegacyModelConfig,
  resetModelSettingsBackend,
  saveModelSettings,
  setModelSettingsBackend,
} from './index';

const STORAGE_KEY = 'aigv.modelSettings';

beforeEach(() => {
  localStorage.clear();
  setModelSettingsBackend(new LocalStorageBackend(STORAGE_KEY));
});

afterEach(() => {
  resetModelSettingsBackend();
});

describe('migrateLegacyModelConfig', () => {
  it('无任何老配置时返回空 providers', () => {
    const settings = migrateLegacyModelConfig(1000);
    expect(settings.providers).toEqual([]);
    expect(settings.schemaVersion).toBe(2);
  });

  it('从 api_${p}_key 裸串迁移出文本实例并套默认 baseUrl', () => {
    localStorage.setItem('api_deepseek_key', 'sk-ds-migrated-1234567890');

    const settings = migrateLegacyModelConfig(1000);

    expect(settings.providers).toHaveLength(1);
    const inst = settings.providers[0];
    expect(inst.id).toBe('legacy:deepseek');
    expect(inst.label).toBe('DeepSeek 深度求索');
    expect(inst.capability).toBe('text');
    expect(inst.protocol).toBe('openai-chat');
    expect(inst.apiKey).toBe('sk-ds-migrated-1234567890');
    expect(inst.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(inst.enabled).toBe(true);
    expect(inst.createdAt).toBe(1000);
  });

  it('从 ai_model_settings_${p} JSON 保留 apiKey 与自定义 baseUrl', () => {
    localStorage.setItem(
      'ai_model_settings_openai',
      JSON.stringify({ apiKey: 'sk-proj-migrated', baseUrl: 'https://my-proxy.example/v1' })
    );

    const settings = migrateLegacyModelConfig(2000);
    const inst = settings.providers[0];
    expect(inst.apiKey).toBe('sk-proj-migrated');
    expect(inst.baseUrl).toBe('https://my-proxy.example/v1');
  });

  it('多套命名去重合并为同一 provider 的单个实例', () => {
    localStorage.setItem('api_openai_key', 'sk-raw-1234567890');
    localStorage.setItem('novella_api_key_openai', 'sk-novella-1234567890');
    localStorage.setItem('openai_api_key', 'sk-other-1234567890');

    const settings = migrateLegacyModelConfig(3000);
    expect(settings.providers).toHaveLength(1);
    // 优先级：api_${p}_key 最先命中
    expect(settings.providers[0].apiKey).toBe('sk-raw-1234567890');
  });

  it('同时迁移多个 provider 时，文本默认指向目录顺序中的第一家', () => {
    localStorage.setItem('api_deepseek_key', 'sk-ds-1234567890');
    localStorage.setItem('api_openai_key', 'sk-openai-1234567890');

    const settings = migrateLegacyModelConfig(4000);
    expect(settings.providers).toHaveLength(2);
    // MODEL_PROVIDERS 声明顺序 openai 先于 deepseek，故第一家实例是 legacy:openai
    expect(settings.capabilityDefaults.text).toEqual({
      providerId: 'legacy:openai',
      modelId: '',
    });
  });

  it('未配置 key 的 provider 不产生实例', () => {
    // 只写一个非法占位，不应迁移
    localStorage.setItem('api_openai_key', '********');
    const settings = migrateLegacyModelConfig(5000);
    expect(settings.providers).toHaveLength(0);
  });
});

describe('store load/save', () => {
  it('无数据时 loadModelSettings 返回空配置', async () => {
    const settings = await loadModelSettings();
    expect(settings).toEqual(emptyModelSettings());
  });

  it('save 后 load 能还原 providers', async () => {
    const original = migrateLegacyModelConfig(6000);
    await saveModelSettings(original);
    const loaded = await loadModelSettings();
    expect(loaded.providers).toEqual(original.providers);
    expect(loaded.capabilityDefaults).toEqual(original.capabilityDefaults);
  });

  it('损坏的 JSON 不抛错，回退空配置', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const settings = await loadModelSettings();
    expect(settings).toEqual(emptyModelSettings());
  });
});

describe('loadOrMigrateModelSettings', () => {
  it('无新结构但有老配置时自动迁移并落盘', async () => {
    localStorage.setItem('api_openai_key', 'sk-auto-migrate-1234567890');
    const settings = await loadOrMigrateModelSettings();
    expect(settings.providers).toHaveLength(1);

    // 再次读取应直接命中已落盘的新结构，不再依赖老命名
    // （只删老 key，不动已落盘的新结构 aigv.modelSettings）
    localStorage.removeItem('api_openai_key');
    const reloaded = await loadModelSettings();
    expect(reloaded.providers).toHaveLength(1);
    expect(reloaded.providers[0].apiKey).toBe('sk-auto-migrate-1234567890');
  });

  it('既无新结构也无老配置时返回空', async () => {
    const settings = await loadOrMigrateModelSettings();
    expect(settings.providers).toEqual([]);
  });
});
