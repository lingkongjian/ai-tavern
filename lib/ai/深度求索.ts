// 兼容旧导入路径。新代码应使用“模型供应商.ts”中的通用名称。
import {
  getAiProviderConfig,
  getAiProviderStatus,
  requestAiJson,
  testAiConnection,
} from "./模型供应商.ts";

export {
  AiConfigurationError as DeepSeekConfigurationError,
  AiRequestError as DeepSeekRequestError,
  AiResponseError as DeepSeekResponseError,
} from "./模型供应商.ts";

export type {
  AiJsonResult as DeepSeekJsonResult,
  AiMessage as DeepSeekMessage,
  AiRequestOptions as DeepSeekRequestOptions,
  AiUsage as DeepSeekUsage,
} from "./模型供应商.ts";

export function getDeepSeekConfig() {
  return getAiProviderConfig();
}

export function getDeepSeekStatus() {
  const status = getAiProviderStatus();
  return {
    configured: status.configured,
    baseUrl: status.baseUrl,
    model: status.model,
  };
}

export const requestDeepSeekJson = requestAiJson;
export const testDeepSeekConnection = testAiConnection;
