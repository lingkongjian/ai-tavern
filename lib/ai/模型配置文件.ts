import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  getProfilesFilePath,
  legacyProfileFromEnvironment,
  LEGACY_PROFILE_ID,
} from "./活动配置.ts";
import {
  AI_PROVIDER_PRESETS,
  getAiProviderConfig,
  type AiJsonMode,
  type AiProviderId,
} from "./模型供应商.ts";

export interface SaveAiProviderConfigInput {
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface SaveAiProfileInput {
  maxOutputTokens?: number;
  requestTimeoutSeconds?: number;
  id?: string;
  name?: string;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface AiProfileRecord {
  maxOutputTokens?: number;
  requestTimeoutSeconds?: number;
  id: string;
  name: string;
  provider: AiProviderId;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiProfileSummary {
  maxOutputTokens?: number;
  requestTimeoutSeconds?: number;
  id: string;
  name: string;
  provider: AiProviderId;
  providerLabel: string;
  baseUrl: string;
  model: string;
  jsonMode: AiJsonMode;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiProfilesView {
  activeId: string | null;
  profiles: AiProfileSummary[];
}

interface AiProfilesFile {
  schemaVersion: 1;
  activeId: string | null;
  profiles: AiProfileRecord[];
}

function profileSummary(record: AiProfileRecord): AiProfileSummary {
  const preset = AI_PROVIDER_PRESETS.find(
    (item) => item.id === record.provider,
  );
  return {
    id: record.id,
    name: record.name,
    provider: record.provider,
    providerLabel: preset?.label ?? record.provider,
    baseUrl: record.baseUrl,
    model: record.model,
    jsonMode: record.jsonMode,
    maxOutputTokens: record.maxOutputTokens ?? 6_000,
    requestTimeoutSeconds: record.requestTimeoutSeconds ?? (record.provider === "local_openai_compatible" ? 1_800 : 90),
    hasApiKey: Boolean(record.apiKey),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const CONFIGURATION_KEYS = [
  "AI_PROVIDER",
  "AI_API_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL",
  "AI_JSON_MODE",
] as const;

const CONFIGURATION_LINE_PATTERN =
  /^\s*(AI_PROVIDER|AI_API_BASE_URL|AI_API_KEY|AI_MODEL|AI_JSON_MODE)\s*=/;

function encodeDotEnvValue(value: string) {
  if (/^[A-Za-z0-9_./:@+\-=]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function replaceDotEnvValues(
  source: string,
  values: Record<(typeof CONFIGURATION_KEYS)[number], string>,
) {
  const pending = new Map(Object.entries(values));
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const match = line.match(CONFIGURATION_LINE_PATTERN);
    if (!match) {
      output.push(line);
      continue;
    }
    const key = match[1] as (typeof CONFIGURATION_KEYS)[number];
    if (seen.has(key)) continue;
    seen.add(key);
    const value = pending.get(key);
    pending.delete(key);
    output.push(`${key}=${encodeDotEnvValue(value ?? "")}`);
  }

  if (output.length > 0 && output.at(-1) !== "") output.push("");
  for (const key of CONFIGURATION_KEYS) {
    const value = pending.get(key);
    if (value !== undefined) output.push(`${key}=${encodeDotEnvValue(value)}`);
  }
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function configurationFilePath(options: { filePath?: string } = {}) {
  const configuredFilePath = process.env.AI_TAVERN_CONFIG_FILE?.trim();
  return (
    options.filePath ??
    (configuredFilePath
      ? path.isAbsolute(configuredFilePath)
        ? configuredFilePath
        : path.resolve(process.cwd(), configuredFilePath)
      : path.join(process.cwd(), ".env.local"))
  );
}

async function readConfigurationSource(filePath: string) {
  try {
    return { exists: true, source: await readFile(filePath, "utf8") };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { exists: false, source: "" };
    }
    throw error;
  }
}

async function writeConfigurationSource(filePath: string, source: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, source, { encoding: "utf8", mode: 0o600 });
  try {
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  await chmod(filePath, 0o600);
}

export async function saveAiProviderConfig(
  input: SaveAiProviderConfigInput,
  options: { filePath?: string } = {},
) {
  const existingApiKey = process.env.AI_API_KEY?.trim() ?? "";
  const existingProvider = process.env.AI_PROVIDER?.trim() || "deepseek";
  const apiKey = input.clearApiKey
    ? ""
    : input.apiKey?.trim() ||
      (existingProvider === input.provider ? existingApiKey : "");
  const config = getAiProviderConfig({
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    jsonMode: input.jsonMode,
    apiKey,
  });

  const filePath = configurationFilePath(options);
  const { source } = await readConfigurationSource(filePath);

  const nextSource = replaceDotEnvValues(source, {
    AI_PROVIDER: config.provider,
    AI_API_BASE_URL: config.baseUrl,
    AI_API_KEY: apiKey,
    AI_MODEL: config.model,
    AI_JSON_MODE: config.jsonMode,
  });
  await writeConfigurationSource(filePath, nextSource);

  process.env.AI_PROVIDER = config.provider;
  process.env.AI_API_BASE_URL = config.baseUrl;
  process.env.AI_MODEL = config.model;
  process.env.AI_JSON_MODE = config.jsonMode;
  if (apiKey) process.env.AI_API_KEY = apiKey;
  else delete process.env.AI_API_KEY;

  return config;
}

export async function deleteAiProviderConfig(
  options: { filePath?: string } = {},
) {
  const filePath = configurationFilePath(options);
  const { exists, source } = await readConfigurationSource(filePath);
  const remainingLines = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !CONFIGURATION_LINE_PATTERN.test(line));
  const remainingSource = remainingLines.join("\n").replace(/\n+$/, "");

  if (exists) {
    if (remainingSource.trim()) {
      await writeConfigurationSource(filePath, `${remainingSource}\n`);
    } else {
      await unlink(filePath).catch((error) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      });
    }
  }

  for (const key of CONFIGURATION_KEYS) delete process.env[key];

  return { deleted: exists || Boolean(source) };
}

function profilesFilePath() {
  return getProfilesFilePath();
}

async function readProfilesFile(filePath: string): Promise<AiProfilesFile | null> {
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("api-configs.json 不是有效 JSON，请检查该文件内容。");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AiProfilesFile).profiles)) {
    throw new Error("api-configs.json 结构无效，请检查该文件内容。");
  }
  return parsed as AiProfilesFile;
}

async function writeProfilesFile(
  filePath: string,
  file: AiProfilesFile,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(file, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  await chmod(filePath, 0o600);
}

function applyProfileToEnvironment(profile: AiProfileRecord | null) {
  if (profile) {
    process.env.AI_PROVIDER = profile.provider;
    process.env.AI_API_BASE_URL = profile.baseUrl;
    process.env.AI_MODEL = profile.model;
    process.env.AI_JSON_MODE = profile.jsonMode;
    if (profile.apiKey) process.env.AI_API_KEY = profile.apiKey;
    else delete process.env.AI_API_KEY;
  } else {
    for (const key of CONFIGURATION_KEYS) delete process.env[key];
  }
}

export async function listAiProfiles(
  options: { filePath?: string } = {},
): Promise<AiProfilesView> {
  const filePath = options.filePath ?? profilesFilePath();
  const file = await readProfilesFile(filePath);
  if (!file) {
    const legacy = legacyProfileFromEnvironment();
    return {
      activeId: legacy ? legacy.id : null,
      profiles: legacy ? [profileSummary(legacy)] : [],
    };
  }
  return {
    activeId: file.activeId,
    profiles: file.profiles.map(profileSummary),
  };
}

export async function listProfileRecords(
  options: { filePath?: string } = {},
): Promise<AiProfileRecord[]> {
  const filePath = options.filePath ?? profilesFilePath();
  const file = await readProfilesFile(filePath);
  if (!file) {
    const legacy = legacyProfileFromEnvironment();
    return legacy ? [{ ...legacy }] : [];
  }
  return file.profiles.map((profile) => ({ ...profile }));
}

export async function saveAiProfile(
  input: SaveAiProfileInput,
  options: { filePath?: string } = {},
): Promise<AiProfileRecord> {
  const filePath = options.filePath ?? profilesFilePath();
  const existingFile = await readProfilesFile(filePath);
  const now = new Date().toISOString();

  const existingApiKey = (() => {
    if (input.clearApiKey) return "";
    if (input.apiKey !== undefined && input.apiKey.trim()) return input.apiKey.trim();
    if (input.id) {
      const existing = existingFile?.profiles.find((item) => item.id === input.id);
      if (existing) return existing.apiKey;
    }
    const active = existingFile
      ? existingFile.profiles.find((item) => item.id === existingFile.activeId)
      : legacyProfileFromEnvironment();
    if (active && active.provider === input.provider) return active.apiKey;
    return "";
  })();

  const previous = existingFile?.profiles.find((item) => item.id === input.id);
  const config = getAiProviderConfig({
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    jsonMode: input.jsonMode,
    maxOutputTokens: input.maxOutputTokens ?? previous?.maxOutputTokens,
    requestTimeoutSeconds: input.requestTimeoutSeconds ?? previous?.requestTimeoutSeconds,
    apiKey: existingApiKey,
  });

  const profiles =
    existingFile?.profiles.map((item) => ({ ...item })) ??
    (() => {
      const legacy = legacyProfileFromEnvironment();
      return legacy ? [{ ...legacy }] : [];
    })();
  let record: AiProfileRecord;
  if (input.id && input.id !== LEGACY_PROFILE_ID) {
    const index = profiles.findIndex((item) => item.id === input.id);
    if (index === -1) {
      throw new Error("要更新的 API 配置不存在或已被删除。");
    }
    record = {
      ...profiles[index],
      name: input.name?.trim() || profiles[index].name,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      jsonMode: config.jsonMode,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      apiKey: config.apiKey,
      updatedAt: now,
    };
    profiles[index] = record;
  } else {
    record = {
      id: randomUUID(),
      name: input.name?.trim() || `${config.providerLabel} · ${config.model}`,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      jsonMode: config.jsonMode,
      maxOutputTokens: config.maxOutputTokens,
      requestTimeoutSeconds: config.requestTimeoutSeconds,
      apiKey: config.apiKey,
      createdAt: now,
      updatedAt: now,
    };
    profiles.push(record);
  }

  const nextFile: AiProfilesFile = {
    schemaVersion: 1,
    activeId: record.id,
    profiles,
  };
  await writeProfilesFile(filePath, nextFile);
  applyProfileToEnvironment(record);

  const configSourcePath = configurationFilePath();
  const { source } = await readConfigurationSource(configSourcePath);
  await writeConfigurationSource(configSourcePath, replaceDotEnvValues(source, {
    AI_PROVIDER: record.provider,
    AI_API_BASE_URL: record.baseUrl,
    AI_API_KEY: record.apiKey,
    AI_MODEL: record.model,
    AI_JSON_MODE: record.jsonMode,
  }));

  return record;
}

export async function deleteAiProfile(
  id: string,
  options: { filePath?: string } = {},
): Promise<AiProfileSummary | null> {
  const filePath = options.filePath ?? profilesFilePath();
  const existingFile = await readProfilesFile(filePath);
  if (!existingFile) {
    if (id === LEGACY_PROFILE_ID) {
      await deleteAiProviderConfig();
      return null;
    }
    return null;
  }
  const index = existingFile.profiles.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const [removed] = existingFile.profiles.splice(index, 1);
  let activeId = existingFile.activeId;
  if (activeId === id) {
    activeId = existingFile.profiles[0]?.id ?? null;
  }
  const nextFile: AiProfilesFile = {
    schemaVersion: 1,
    activeId,
    profiles: existingFile.profiles,
  };
  await writeProfilesFile(filePath, nextFile);
  const active = nextFile.profiles.find((item) => item.id === activeId) ?? null;
  applyProfileToEnvironment(active ? { ...active } : null);

  const configSourcePath = configurationFilePath();
  const { source } = await readConfigurationSource(configSourcePath);
  if (active) {
    await writeConfigurationSource(configSourcePath, replaceDotEnvValues(source, {
      AI_PROVIDER: active.provider,
      AI_API_BASE_URL: active.baseUrl,
      AI_API_KEY: active.apiKey,
      AI_MODEL: active.model,
      AI_JSON_MODE: active.jsonMode,
    }));
  } else {
    const remainingLines = source
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => !CONFIGURATION_LINE_PATTERN.test(line));
    const remainingSource = remainingLines.join("\n").replace(/\n+$/, "");
    if (remainingSource.trim()) {
      await writeConfigurationSource(configSourcePath, `${remainingSource}\n`);
    } else {
      await unlink(configSourcePath).catch((error) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      });
    }
  }

  return removed ? profileSummary(removed) : null;
}

export async function activateAiProfile(
  id: string,
  options: { filePath?: string } = {},
): Promise<AiProfileRecord | null> {
  const filePath = options.filePath ?? profilesFilePath();
  const existingFile = await readProfilesFile(filePath);
  if (!existingFile) {
    const legacy = legacyProfileFromEnvironment();
    if (!legacy || legacy.id !== id) {
      throw new Error("要启用的 API 配置不存在。");
    }
    return legacy;
  }
  const target = existingFile.profiles.find((item) => item.id === id);
  if (!target) throw new Error("要启用的 API 配置不存在。");
  const nextFile: AiProfilesFile = {
    schemaVersion: 1,
    activeId: id,
    profiles: existingFile.profiles,
  };
  await writeProfilesFile(filePath, nextFile);
  applyProfileToEnvironment({ ...target });
  return { ...target };
}
