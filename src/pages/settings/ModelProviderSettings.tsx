/**
 * 提供方 / 能力实例管理（P4 核心优先）
 * ===================================
 * - 按能力分 Tab（文本 / 图像 / 视频 / 语音）管理 `ProviderInstance`。
 * - 每个实例支持：启用开关、检测连通性（P3 probeProvider）、拉取模型
 *   （P3 fetchModels，结果回写 fetchedModels 并落盘）、刷新 / 清除缓存、编辑、删除。
 * - 描述符试跑入口与视觉回归留待 P4 第二轮。
 *
 * 注意：本组件只渲染卡片与按钮，所有可填写字段都在「添加 / 编辑」Dialog 内，
 * Dialog 关闭时不挂载，因此 SettingsPage 末尾的「工作目录」输入框仍是最后一个 textbox
 * （github-issues-resolution 测试依赖这一点）。
 */

import {
  CheckCircle2,
  Download,
  FlaskConical,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useModelSettings } from './useModelSettings';


import { Badge } from '@/common/components/ui/badge';
import { Button } from '@/common/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/common/components/ui/dialog';
import { Input } from '@/common/components/ui/input';
import { Label } from '@/common/components/ui/label';
import { AntDSelect as Select } from '@/common/components/ui/select';
import { Switch } from '@/common/components/ui/switch';
import { Tabs } from '@/common/components/ui/tabs';
import { TextArea } from '@/common/components/ui/textarea';
import { toast } from '@/common/components/ui/toast';
import { cn } from '@/common/utils/class-names';
import { clearModelCache, fetchModels, probeProvider } from '@/core/ai/discovery/discovery';
import { BUILTIN_VIDEO_DESCRIPTORS } from '@/core/ai/protocols/vendor-task-descriptors';
import { dryRunProvider, type ProviderDryRunResult } from '@/core/ai/protocols/vendor-task-dryrun';
import { extractCredentials } from '@/core/config/model-settings/credentials';
import type { AuthStyle, Capability, ProtocolId, ProviderInstance } from '@/core/config/model-settings/types';


const CAPABILITIES: { key: Capability; label: string }[] = [
  { key: 'text', label: '文本' },
  { key: 'image', label: '图像' },
  { key: 'video', label: '视频' },
  { key: 'tts', label: '语音' },
];

const PROTOCOL_OPTIONS: { value: ProtocolId; label: string }[] = [
  { value: 'openai-chat', label: 'OpenAI Chat（文本）' },
  { value: 'openai-images', label: 'OpenAI Images（图像）' },
  { value: 'openai-speech', label: 'OpenAI Speech（语音）' },
  { value: 'openai-videos', label: 'OpenAI Videos（视频，new-api 契约）' },
  { value: 'vendor-task', label: '声明式适配（视频：可灵 / MiniMax / 智谱）' },
];

const AUTH_OPTIONS: { value: AuthStyle; label: string }[] = [
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'x-api-key', label: 'X-API-Key 头' },
  { value: 'query', label: 'Query 参数 (api_key)' },
  { value: 'none', label: '无需鉴权' },
];

const VENDOR_DESCRIPTOR_OPTIONS = Object.keys(BUILTIN_VIDEO_DESCRIPTORS).map((id) => ({
  value: id,
  label: id,
}));

function defaultProtocolFor(cap: Capability): ProtocolId {
  switch (cap) {
    case 'text':
      return 'openai-chat';
    case 'image':
      return 'openai-images';
    case 'video':
      return 'openai-videos';
    case 'tts':
      return 'openai-speech';
    default:
      return 'openai-chat';
  }
}

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function emptyProvider(cap: Capability, genId: () => string): ProviderInstance {
  return {
    id: genId(),
    label: '',
    capability: cap,
    protocol: defaultProtocolFor(cap),
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    authStyle: 'bearer',
    modelSource: 'auto',
    enabled: true,
    createdAt: Date.now(),
  };
}

const SOURCE_LABEL: Record<string, string> = {
  auto: '自动拉取',
  candidate: '候选回退',
  manual: '手动填写',
};

/** 「不复制 / 不继承」的哨兵值（避免用空串作为 SelectItem value） */
const CRED_NONE = '__none__';

const providerOptionLabel = (p: ProviderInstance): string => `${p.label || p.id}（${p.capability}）`;

// ─────────────── 添加 / 编辑 Dialog ───────────────

interface ProviderDialogProps {
  open: boolean;
  initial: ProviderInstance | null;
  allProviders: ProviderInstance[];
  onClose: () => void;
  onSave: (provider: ProviderInstance) => void;
}

function ProviderDialog({ open, initial, allProviders, onClose, onSave }: ProviderDialogProps) {
  const [form, setForm] = useState<ProviderInstance>(() => initial ?? emptyProvider('text', () => 'new'));
  const [manualText, setManualText] = useState('');
  const [filterText, setFilterText] = useState('');

  // 打开 / 切换编辑对象时同步表单
  const [syncedKey, setSyncedKey] = useState<string>('');
  if (open && syncedKey !== (initial?.id ?? 'new')) {
    setSyncedKey(initial?.id ?? 'new');
    setForm(initial ?? emptyProvider('text', () => 'new'));
    setManualText((initial?.manualModels ?? []).join('\n'));
    setFilterText((initial?.modelFilter ?? []).join('\n'));
  }

  const isVendor = form.protocol === 'vendor-task';
  const isManual = form.modelSource === 'manual';

  // P6：凭据来源（复制 / 继承）——列出其它实例供选择
  const otherProviders = allProviders.filter((p) => p.id !== form.id);
  const copySourceOptions = [
    { value: CRED_NONE, label: '（选择要复制的实例）' },
    ...otherProviders.map((p) => ({ value: p.id, label: providerOptionLabel(p) })),
  ];
  const credentialSourceOptions = [
    { value: CRED_NONE, label: '（不继承，用自己的凭据）' },
    ...otherProviders.map((p) => ({ value: p.id, label: providerOptionLabel(p) })),
  ];

  const update = (patch: Partial<ProviderInstance>) =>
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // 切到 vendor-task 时默认带一个描述符，避免空引用
      if (patch.protocol === 'vendor-task' && !next.vendorDescriptorId) {
        next.vendorDescriptorId = VENDOR_DESCRIPTOR_OPTIONS[0]?.value;
      }
      return next;
    });

  const handleSave = () => {
    if (!form.label.trim()) {
      toast.error('请填写提供方名称');
      return;
    }
    onSave({
      ...form,
      label: form.label.trim(),
      manualModels: isManual ? parseLines(manualText) : undefined,
      modelFilter: parseLines(filterText),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑提供方' : '添加提供方'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>名称</Label>
            <Input
              value={form.label}
              onChange={(e) => update({ label: e.target.value })}
              placeholder="例如：公司中转站 / 可灵官方"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>协议</Label>
              <Select
                options={PROTOCOL_OPTIONS}
                value={form.protocol}
                onChange={(v) => update({ protocol: v as ProtocolId })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>鉴权方式</Label>
              <Select
                options={AUTH_OPTIONS}
                value={form.authStyle}
                onChange={(v) => update({ authStyle: v as AuthStyle })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              value={form.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>默认模型（可选）</Label>
              <Input
                value={form.defaultModel ?? ''}
                onChange={(e) => update({ defaultModel: e.target.value || undefined })}
                placeholder="留空 → 用首个可用模型"
              />
            </div>
          </div>

          {otherProviders.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>从已有实例复制凭据</Label>
                <Select
                  options={copySourceOptions}
                  value={CRED_NONE}
                  onChange={(v) => {
                    const id = Array.isArray(v) ? v[0] : v;
                    const src = otherProviders.find((p) => p.id === id);
                    if (src) {
                      update(extractCredentials(src));
                      toast.success(`已复制「${src.label || src.id}」的凭据`);
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>继承凭据自（可选）</Label>
                <Select
                  options={credentialSourceOptions}
                  value={form.credentialSourceId ?? CRED_NONE}
                  onChange={(v) => {
                    const id = Array.isArray(v) ? v[0] : v;
                    update({ credentialSourceId: id === CRED_NONE ? undefined : id });
                  }}
                />
              </div>
            </div>
          )}

          {isVendor && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Access Key</Label>
                  <Input
                    value={form.accessKey ?? ''}
                    onChange={(e) => update({ accessKey: e.target.value || undefined })}
                    placeholder="可灵等 JWT 签名用"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Secret Key</Label>
                  <Input
                    type="password"
                    value={form.secretKey ?? ''}
                    onChange={(e) => update({ secretKey: e.target.value || undefined })}
                    placeholder="JWT 签名用"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>内置描述符</Label>
                <Select
                  options={VENDOR_DESCRIPTOR_OPTIONS}
                  value={form.vendorDescriptorId ?? ''}
                  onChange={(v) => update({ vendorDescriptorId: (Array.isArray(v) ? v[0] : v) || undefined })}
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
            <div>
              <Label>自动拉取模型列表</Label>
              <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                关闭则手动填写模型名（不支持 /models 时更稳）
              </p>
            </div>
            <Switch
              checked={form.modelSource === 'auto'}
              onChange={(c) => update({ modelSource: c ? 'auto' : 'manual' })}
            />
          </div>

          {isManual && (
            <div className="space-y-1.5">
              <Label>手动模型名（每行一个）</Label>
              <TextArea
                rows={3}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={'gpt-4o\ngpt-4o-mini'}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>模型白名单（可选，每行一个；留空=全放行）</Label>
            <TextArea
              rows={2}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={'gpt-4o'}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2">
            <Label>启用该提供方</Label>
            <Switch checked={form.enabled} onChange={(c) => update({ enabled: c })} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
          </DialogClose>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────── 单个提供方卡片 ───────────────

interface ProviderCardProps {
  provider: ProviderInstance;
  probing: boolean;
  fetching: boolean;
  dryRunning: boolean;
  onProbe: (p: ProviderInstance) => void;
  onFetch: (p: ProviderInstance) => void;
  onClearCache: (p: ProviderInstance) => void;
  onEdit: (p: ProviderInstance) => void;
  onDelete: (p: ProviderInstance) => void;
  onToggleEnabled: (p: ProviderInstance, enabled: boolean) => void;
  onDryRun: (p: ProviderInstance) => void;
}

function ProviderCard({
  provider,
  probing,
  fetching,
  dryRunning,
  onProbe,
  onFetch,
  onClearCache,
  onEdit,
  onDelete,
  onToggleEnabled,
  onDryRun,
}: ProviderCardProps) {
  const probe = provider.lastProbe;
  const models = provider.fetchedModels;

  return (
    <div className="p-4 rounded-xl border border-[var(--border)] space-y-3 bg-transparent hover:border-indigo-500/40 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[var(--foreground)] truncate">{provider.label}</span>
            <Badge variant="outline" className="shrink-0">
              {provider.protocol}
            </Badge>
          </div>
          <span className="text-[11px] text-[var(--muted-foreground)] font-mono block truncate">
            {provider.baseUrl}
          </span>
        </div>
        <Switch checked={provider.enabled} onChange={(c) => onToggleEnabled(provider, c)} />
      </div>

      {/* 连通性探测结果 */}
      {probe && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[11px]',
            probe.ok ? 'text-emerald-400' : 'text-red-400'
          )}
        >
          {probe.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          <span>
            {probe.ok ? `连通正常${probe.latencyMs != null ? ` · ${probe.latencyMs}ms` : ''}` : probe.error}
          </span>
        </div>
      )}

      {/* 模型列表 */}
      {models && models.models.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant={models.source === 'auto' ? 'info' : models.source === 'candidate' ? 'warning' : 'secondary'}>
              {SOURCE_LABEL[models.source] ?? models.source}
            </Badge>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {models.models.length} 个 · {new Date(models.at).toLocaleTimeString()}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => onFetch(provider)} disabled={fetching}>
                <RefreshCw className={cn('w-3.5 h-3.5', fetching && 'animate-spin')} />
                刷新
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onClearCache(provider)}>
                清除缓存
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {models.models.map((m) => (
              <span
                key={m}
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => onProbe(provider)} disabled={probing}>
          <Plug className={cn('w-3.5 h-3.5', probing && 'animate-spin')} />
          检测连通性
        </Button>
        <Button size="sm" variant="outline" onClick={() => onFetch(provider)} disabled={fetching}>
          <Download className={cn('w-3.5 h-3.5', fetching && 'animate-spin')} />
          拉取模型
        </Button>
        {provider.protocol === 'vendor-task' && (
          <Button size="sm" variant="outline" onClick={() => onDryRun(provider)} disabled={dryRunning}>
            <FlaskConical className={cn('w-3.5 h-3.5', dryRunning && 'animate-spin')} />
            试跑描述符
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onEdit(provider)}>
          <Pencil className="w-3.5 h-3.5" />
          编辑
        </Button>
        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => onDelete(provider)}>
          <Trash2 className="w-3.5 h-3.5" />
          删除
        </Button>
      </div>
    </div>
  );
}

// ─────────────── 试跑结果展示 ───────────────

/** 试跑单步：状态码 + ok/fail + taskId + 原始响应（JSON 美化或原始文本） */
function DryRunStepView({ title, step }: { title: string; step: import('@/core/ai/protocols/vendor-task').VendorTaskDryRunStep }) {
  const display = typeof step.body === 'string' ? step.body : JSON.stringify(step.body, null, 2);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-[var(--foreground)]">{title}</span>
        <Badge variant={step.ok ? 'info' : 'destructive'}>{step.status || 'ERR'}</Badge>
        <span className={step.ok ? 'text-[11px] text-emerald-400' : 'text-[11px] text-red-400'}>
          {step.ok ? 'ok' : 'fail'}
        </span>
      </div>
      {step.taskId && (
        <div className="text-[11px] text-[var(--muted-foreground)] font-mono">taskId: {step.taskId}</div>
      )}
      {step.error && <div className="text-[11px] text-red-400 break-all">error: {step.error}</div>}
      <pre className="text-[10px] bg-[var(--muted)]/40 rounded-md p-3 overflow-auto max-h-52 whitespace-pre-wrap break-all font-mono text-[var(--foreground)]">
        {display}
      </pre>
    </div>
  );
}

// ─────────────── 主组件 ───────────────

export default function ModelProviderSettings() {
  const { settings, loading, upsertProvider, removeProvider, patchProvider, genId } = useModelSettings();
  const [activeCap, setActiveCap] = useState<Capability>('text');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderInstance | null>(null);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProviderInstance | null>(null);
  const [dryRunFor, setDryRunFor] = useState<ProviderInstance | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<ProviderDryRunResult | null>(null);

  const providers = settings?.providers ?? [];

  const handleProbe = async (p: ProviderInstance) => {
    setProbingId(p.id);
    try {
      const res = await probeProvider(p, p.capability);
      patchProvider(p.id, {
        lastProbe: { at: Date.now(), ok: res.ok, latencyMs: res.latencyMs, error: res.ok ? undefined : res.error },
      });
      if (res.ok) toast.success(`✅ ${p.label} 连通正常${res.latencyMs != null ? `（${res.latencyMs}ms）` : ''}`);
      else toast.error(`❌ ${p.label}：${res.error}`);
    } catch {
      toast.error(`❌ ${p.label}：探测异常`);
    } finally {
      setProbingId(null);
    }
  };

  const handleFetch = async (p: ProviderInstance, force = true) => {
    setFetchingId(p.id);
    try {
      const res = await fetchModels(p, p.capability, { forceRefresh: force });
      patchProvider(p.id, {
        fetchedModels: { at: Date.now(), models: res.models, source: res.source },
      });
      if (res.kind === 'ok') {
        toast.success(`✅ ${p.label} 拉取 ${res.models.length} 个模型（${SOURCE_LABEL[res.source]}）`);
      } else {
        toast.warning(`⚠️ ${p.label}：${res.error ?? '拉取未完成'}`);
      }
    } catch {
      toast.error(`❌ ${p.label}：拉取异常`);
    } finally {
      setFetchingId(null);
    }
  };

  const handleClearCache = (p: ProviderInstance) => {
    clearModelCache(p.id);
    patchProvider(p.id, { fetchedModels: undefined });
    toast.info(`已清除 ${p.label} 的模型缓存`);
  };

  const handleDryRun = async (p: ProviderInstance) => {
    setDryRunFor(p);
    setDryRunResult(null);
    setDryRunning(true);
    try {
      const res = await dryRunProvider(p, p.capability);
      setDryRunResult(res);
      if (!res.supported) {
        toast.warning(`「${p.label}」不是声明式适配，无法试跑`);
      } else if (res.result?.create.ok) {
        toast.success(`✅ 创建任务成功（HTTP ${res.result.create.status}）`);
      } else {
        toast.warning(
          `⚠️ 创建任务返回 HTTP ${res.result?.create.status ?? '—'}${
            res.result?.create.error ? `：${res.result.create.error}` : ''
          }`
        );
      }
    } catch {
      toast.error(`❌ ${p.label}：试跑异常`);
    } finally {
      setDryRunning(false);
    }
  };

  const handleSave = (p: ProviderInstance) => {
    upsertProvider(p);
    setDialogOpen(false);
    setEditing(null);
    toast.success(`已保存 ${p.label}`);
  };

  const openAdd = (cap: Capability) => {
    setEditing({ ...emptyProvider(cap, genId) });
    setDialogOpen(true);
  };

  const openEdit = (p: ProviderInstance) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const tabs = useMemo(
    () =>
      CAPABILITIES.map((cap) => {
        const list = providers.filter((p) => p.capability === cap.key);
        return {
          key: cap.key,
          label: cap.label,
          children: (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  共 {list.length} 个提供方
                </span>
                <Button size="sm" variant="outline" onClick={() => openAdd(cap.key)}>
                  <Plus className="w-3.5 h-3.5" />
                  添加提供方
                </Button>
              </div>
              {list.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--muted-foreground)]">
                  暂无该能力的提供方，点击「添加提供方」开始配置
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {list.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      probing={probingId === p.id}
                      fetching={fetchingId === p.id}
                      dryRunning={dryRunning && dryRunFor?.id === p.id}
                      onProbe={handleProbe}
                      onFetch={(prov) => handleFetch(prov, true)}
                      onClearCache={handleClearCache}
                      onEdit={openEdit}
                      onDelete={setConfirmDelete}
                      onToggleEnabled={(prov, enabled) => patchProvider(prov.id, { enabled })}
                      onDryRun={handleDryRun}
                    />
                  ))}
                </div>
              )}
            </div>
          ),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, probingId, fetchingId]
  );

  return (
    <div className="studio-card p-6 space-y-4">
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3 flex-wrap gap-2">
        <h3 className="text-sm font-bold text-[var(--foreground)] flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-indigo-400" />
          AI 模型提供方配置（按能力管理）
        </h3>
        <span className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
          单一配置键 · 真实连通性探测
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在加载模型配置…
        </div>
      ) : (
        <Tabs items={tabs} value={activeCap} onValueChange={(k) => setActiveCap(k as Capability)} />
      )}

      <ProviderDialog
        open={dialogOpen}
        initial={editing}
        allProviders={providers}
        onClose={() => {
          setDialogOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />

      {/* 删除确认 */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除提供方</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--muted-foreground)]">
            确定删除「{confirmDelete?.label}」？该操作不可撤销，引用它的槽位绑定会回退到默认实例。
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                取消
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete) {
                  removeProvider(confirmDelete.id);
                  toast.success(`已删除 ${confirmDelete.label}`);
                }
                setConfirmDelete(null);
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 描述符试跑结果回显 */}
      <Dialog open={!!dryRunFor} onOpenChange={(o) => !o && setDryRunFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>试跑描述符：{dryRunFor?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {dryRunning && !dryRunResult && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在提交最小任务并回显上游原始响应…
              </div>
            )}
            {dryRunResult && !dryRunResult.supported && (
              <p className="text-sm text-red-400">
                {dryRunResult.error ?? '该提供方不是声明式适配（vendor-task），无法试跑。'}
              </p>
            )}
            {dryRunResult?.result && (
              <>
                <DryRunStepView title="① 创建任务（create）" step={dryRunResult.result.create} />
                {dryRunResult.result.poll && (
                  <DryRunStepView title="② 首轮轮询（poll）" step={dryRunResult.result.poll} />
                )}
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  试跑只发一次最小任务 + 一轮轮询，不等待完成，用于校验描述符的鉴权 / create 路径 /
                  taskIdPath / poll 路径是否正确（路径写错只能运行时发现）。
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" onClick={() => setDryRunFor(null)}>
                关闭
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
