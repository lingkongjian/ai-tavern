import { readFileSync } from "node:fs";
import path from "node:path";
import { getLocalDataDirectory } from "../../db/index.ts";
import type { AiJsonMode, AiProviderId } from "./模型供应商.ts";

export interface ActiveAiProfile {
  id: string;
  name: string;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  maxOutputTokens?: number;
  requestTimeoutSeconds?: number;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

interface AiProfilesFile {
  schemaVersion: 1;
  activeId: string | null;
  profiles: ActiveAiProfile[];
}

export const LEGACY_PROFILE_ID = "legacy-env";

export function getProfilesFilePath() {
  return path.join(getLocalDataDirectory(), "api-configs.json");
}

export function legacyProfileFromEnvironment(): ActiveAiProfile | null {
  const provider = (process.env.AI_PROVIDER?.trim() ||
    "deepseek") as AiProviderId;
  const baseUrl = process.env.AI_API_BASE_URL?.trim() || "";
  const model = process.env.AI_MODEL?.trim() || "";
  const apiKey = process.env.AI_API_KEY?.trim() || "";
  const jsonMode = (process.env.AI_JSON_MODE?.trim() ||
    "response_format") as AiJsonMode;
  if (!baseUrl || !model) return null;
  const now = new Date().toISOString();
  return {
    id: LEGACY_PROFILE_ID,
    name: "当前配置（环境变量）",
    provider,
    baseUrl,
    model,
    jsonMode,
    apiKey,
    createdAt: now,
    updatedAt: now,
  };
}

export function getActiveAiProfileSync(): ActiveAiProfile | null {
  const filePath = getProfilesFilePath();
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return legacyProfileFromEnvironment();
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return legacyProfileFromEnvironment();
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as AiProfilesFile).profiles)
  ) {
    return legacyProfileFromEnvironment();
  }
  const file = parsed as AiProfilesFile;
  if (!file.activeId) return null;
  const active = file.profiles.find((profile) => profile.id === file.activeId);
  return active ?? null;
}
