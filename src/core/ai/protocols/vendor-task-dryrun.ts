/**
 * 描述符试跑封装（P4 调试入口）
 * 把 ProviderInstance 映射成 VendorTaskRequest 并调用 dryRunVendorTask，
 * 供设置页「试跑描述符」按钮使用——回显上游原始响应，校验描述符的鉴权 / 路径 / taskIdPath。
 */

import type { Capability, ProviderInstance } from '../../config/model-settings/types';
import { getBuiltinVideoDescriptor } from './vendor-task-descriptors';
import {
  dryRunVendorTask,
  type VendorTaskDryRunResult,
  type VendorTaskOptions,
  type VendorTaskRequest,
} from './vendor-task';

export interface ProviderDryRunResult {
  supported: boolean;
  descriptorId?: string;
  error?: string;
  result?: VendorTaskDryRunResult;
}

export async function dryRunProvider(
  provider: ProviderInstance,
  _capability: Capability,
  options?: VendorTaskOptions
): Promise<ProviderDryRunResult> {
  if (provider.protocol !== 'vendor-task' || !provider.vendorDescriptorId) {
    return { supported: false };
  }
  const desc = getBuiltinVideoDescriptor(provider.vendorDescriptorId);
  if (!desc) {
    return { supported: false, descriptorId: provider.vendorDescriptorId, error: '未知的内置描述符' };
  }

  const req: VendorTaskRequest = {
    baseUrl: provider.baseUrl,
    credentials: {
      apiKey: provider.apiKey,
      accessKey: provider.accessKey ?? '',
      secretKey: provider.secretKey ?? '',
    },
    prompt: '试跑测试：一只猫在月光下散步',
    model: provider.defaultModel ?? desc.defaultModel,
    durationSec: provider.defaults?.durationSec,
    aspectRatio: provider.defaults?.aspectRatio,
    resolution: provider.defaults?.resolution,
    fps: provider.defaults?.fps,
  };

  const result = await dryRunVendorTask(desc, req, options);
  return { supported: true, descriptorId: provider.vendorDescriptorId, result };
}
