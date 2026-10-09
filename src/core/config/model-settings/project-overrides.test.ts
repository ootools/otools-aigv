/**
 * P6 单元测试：项目级覆盖存储（按 projectId）
 */

import type { SettingsBackend } from './backend';
import {
  clearProjectOverride,
  getAllProjectOverrides,
  getCurrentProjectId,
  getCurrentProjectOverride,
  getProjectOverride,
  isEmptyOverride,
  loadProjectOverrides,
  resetProjectOverrideCache,
  saveProjectOverrides,
  setCurrentProjectId,
  setProjectOverride,
  setProjectOverridesBackend,
} from './project-overrides';

type MemoryBackend = SettingsBackend & { value: string | null };

function memoryBackend(): MemoryBackend {
  const box: MemoryBackend = {
    value: null,
    async load() {
      return box.value;
    },
    async save(v: string) {
      box.value = v;
    },
    async clear() {
      box.value = null;
    },
  };
  return box;
}

describe('project-overrides — 项目级覆盖存储（P6）', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = memoryBackend();
    setProjectOverridesBackend(backend);
    resetProjectOverrideCache();
  });

  afterEach(() => {
    resetProjectOverrideCache();
  });

  it('setProjectOverride 写入并按 projectId 隔离', async () => {
    await setProjectOverride('proj-1', { slotBindings: { 'script.ingest': { providerId: 'p1' } } });
    await setProjectOverride('proj-2', { capabilityDefaults: { text: { providerId: 'p2' } } });

    expect(getProjectOverride('proj-1')?.slotBindings?.['script.ingest']?.providerId).toBe('p1');
    expect(getProjectOverride('proj-2')?.capabilityDefaults?.text?.providerId).toBe('p2');
    expect(getProjectOverride('proj-3')).toBeUndefined();
  });

  it('空覆盖视为清除该项', async () => {
    await setProjectOverride('proj-1', { slotBindings: { 'script.ingest': { providerId: 'p1' } } });
    await setProjectOverride('proj-1', { slotBindings: {} });
    expect(getProjectOverride('proj-1')).toBeUndefined();
  });

  it('clearProjectOverride 删除单项目，不影响其他项目', async () => {
    await setProjectOverride('proj-1', { capabilityDefaults: { text: { providerId: 'p1' } } });
    await setProjectOverride('proj-2', { capabilityDefaults: { text: { providerId: 'p2' } } });
    await clearProjectOverride('proj-1');

    expect(getProjectOverride('proj-1')).toBeUndefined();
    expect(getProjectOverride('proj-2')?.capabilityDefaults?.text?.providerId).toBe('p2');
  });

  it('saveProjectOverrides / loadProjectOverrides 往返', async () => {
    await saveProjectOverrides({ 'proj-1': { capabilityDefaults: { image: { providerId: 'img' } } } });
    resetProjectOverrideCache();
    expect(getAllProjectOverrides()).toEqual({});

    const loaded = await loadProjectOverrides();
    expect(loaded['proj-1']?.capabilityDefaults?.image?.providerId).toBe('img');
  });

  it('损坏 JSON → 回退 {}', async () => {
    await backend.save('{ not json');
    const loaded = await loadProjectOverrides();
    expect(loaded).toEqual({});
  });

  it('当前工程 id 与当前覆盖联动', async () => {
    await setProjectOverride('proj-9', { capabilityDefaults: { text: { providerId: 'x' } } });
    setCurrentProjectId('proj-9');
    expect(getCurrentProjectId()).toBe('proj-9');
    expect(getCurrentProjectOverride()?.capabilityDefaults?.text?.providerId).toBe('x');

    setCurrentProjectId(null);
    expect(getCurrentProjectOverride()).toBeUndefined();
  });

  it('isEmptyOverride 判定（undefined 值不算配置）', () => {
    expect(isEmptyOverride({})).toBe(true);
    expect(isEmptyOverride({ slotBindings: {} })).toBe(true);
    expect(isEmptyOverride({ slotBindings: { 'util.fast': undefined } })).toBe(true);
    expect(isEmptyOverride({ capabilityDefaults: { text: { providerId: 'p' } } })).toBe(false);
  });
});
