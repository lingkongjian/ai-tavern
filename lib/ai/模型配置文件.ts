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

function configurationFilePath(options: { filePath?: string }) {
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
