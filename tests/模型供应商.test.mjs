import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AiConfigurationError,
  getAiProviderStatus,
  requestAiJson,
} from "../lib/ai/模型供应商.ts";
import {
  auditAiProvider,
  discoverAiModels,
} from "../lib/ai/模型可用性.ts";
import {
  deleteAiProviderConfig,
  saveAiProviderConfig,
} from "../lib/ai/模型配置文件.ts";

const originalEnvironment = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_API_BASE_URL: process.env.AI_API_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_JSON_MODE: process.env.AI_JSON_MODE,
  AI_TAVERN_CONFIG_FILE: process.env.AI_TAVERN_CONFIG_FILE,
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.after(restoreEnvironment);

test("generic compatible providers omit DeepSeek-only request fields", async () => {
  let capturedRequest;
  const result = await requestAiJson(
    [{ role: "user", content: "返回 JSON" }],
    {
      config: {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1/chat/completions",
        model: "story-model",
        apiKey: "cloud-secret",
        jsonMode: "response_format",
      },
      fetchImplementation: async (url, init) => {
        capturedRequest = { url, init, body: JSON.parse(init.body) };
        return Response.json({
          model: "story-model",
          choices: [
            { finish_reason: "stop", message: { content: '{"status":"ok"}' } },
          ],
        });
      },
    },
  );

  assert.equal(capturedRequest.url, "https://models.example/v1/chat/completions");
  assert.equal(capturedRequest.init.headers.Authorization, "Bearer cloud-secret");
  assert.deepEqual(capturedRequest.body.response_format, { type: "json_object" });
  assert.equal("thinking" in capturedRequest.body, false);
  assert.equal(result.content.status, "ok");
});

test("local compatible providers can run without a key or response_format", async () => {
  let capturedRequest;
  await requestAiJson([{ role: "user", content: "返回 JSON" }], {
    config: {
      provider: "local_openai_compatible",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-story-model",
      apiKey: "",
      jsonMode: "prompt_only",
    },
    fetchImplementation: async (url, init) => {
      capturedRequest = { url, init, body: JSON.parse(init.body) };
      return Response.json({
        choices: [
          { finish_reason: "stop", message: { content: '{"status":"ok"}' } },
        ],
      });
    },
  });

  assert.equal(capturedRequest.url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal("Authorization" in capturedRequest.init.headers, false);
  assert.equal("response_format" in capturedRequest.body, false);
  assert.equal("thinking" in capturedRequest.body, false);
});

test("remote plaintext endpoints remain blocked", async () => {
  await assert.rejects(
    () =>
      requestAiJson([{ role: "user", content: "测试" }], {
        config: {
          provider: "openai_compatible",
          baseUrl: "http://models.example/v1",
          model: "story-model",
          apiKey: "secret",
        },
      }),
    (error) =>
      error instanceof AiConfigurationError && error.message.includes("HTTPS"),
  );
});

test("credentials in Base URL query parameters remain blocked", async () => {
  await assert.rejects(
    () =>
      discoverAiModels({
        config: {
          provider: "openai_compatible",
          baseUrl: "https://models.example/v1?api_key=do-not-export",
          model: "story-model",
          apiKey: "cloud-secret",
        },
      }),
    (error) =>
      error instanceof AiConfigurationError && error.message.includes("查询参数"),
  );
});

test("OpenCode Go automatically reads and classifies the plan model catalog", async () => {
  let capturedRequest;
  const catalog = await discoverAiModels({
    config: {
      provider: "opencode_go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-flash",
      apiKey: "go-secret",
    },
    fetchImplementation: async (url, init) => {
      capturedRequest = { url, init };
      return Response.json({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", owned_by: "opencode" },
          { id: "minimax-m3", owned_by: "opencode" },
          { id: "future-model", owned_by: "opencode" },
        ],
      });
    },
  });

  assert.equal(capturedRequest.url, "https://opencode.ai/zen/go/v1/models");
  assert.equal(capturedRequest.init.method, "GET");
  assert.equal(capturedRequest.init.headers.Authorization, "Bearer go-secret");
  assert.deepEqual(
    Object.fromEntries(catalog.models.map((model) => [model.id, model.compatibility])),
    {
      "deepseek-v4-flash": "chat_completions",
      "future-model": "unknown",
      "minimax-m3": "unsupported_protocol",
    },
  );
});

test("model discovery derives /models from a complete chat endpoint", async () => {
  let capturedUrl;
  await discoverAiModels({
    config: {
      provider: "openai_compatible",
      baseUrl: "https://models.example/v1/chat/completions",
      model: "story-model",
      apiKey: "cloud-secret",
    },
    fetchImplementation: async (url) => {
      capturedUrl = url;
      return Response.json({ data: ["story-model"] });
    },
  });

  assert.equal(capturedUrl, "https://models.example/v1/models");
});

test("availability audit checks catalog permission and one minimal JSON generation", async () => {
  const requests = [];
  const audit = await auditAiProvider({
    config: {
      provider: "opencode_go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "deepseek-v4-flash",
      apiKey: "go-secret",
    },
    fetchImplementation: async (url, init) => {
      requests.push({ url, method: init.method, body: init.body });
      if (init.method === "GET") {
        return Response.json({ data: [{ id: "deepseek-v4-flash" }] });
      }
      return Response.json({
        model: "deepseek-v4-flash",
        choices: [
          { finish_reason: "stop", message: { content: '{"status":"ok"}' } },
        ],
      });
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.returnedModel, "deepseek-v4-flash");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST"]);
  assert.equal(requests[1].url, "https://opencode.ai/zen/go/v1/chat/completions");
  assert.equal(JSON.parse(requests[1].body).max_tokens, 64);
  assert.equal(
    audit.checks.find((check) => check.id === "completion_json")?.status,
    "passed",
  );
});

test("availability audit skips known incompatible protocols to avoid invalid billing", async () => {
  let generationRequests = 0;
  const audit = await auditAiProvider({
    config: {
      provider: "opencode_go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      model: "minimax-m3",
      apiKey: "go-secret",
    },
    fetchImplementation: async (_url, init) => {
      if (init.method === "POST") generationRequests += 1;
      return Response.json({ data: [{ id: "minimax-m3" }] });
    },
  });

  assert.equal(audit.ok, false);
  assert.equal(generationRequests, 0);
  assert.equal(
    audit.checks.find((check) => check.id === "model_selection")?.status,
    "failed",
  );
  assert.equal(
    audit.checks.find((check) => check.id === "completion_json")?.status,
    "skipped",
  );
});

test("provider errors cannot echo the configured API key", async () => {
  await assert.rejects(
    () =>
      requestAiJson([{ role: "user", content: "测试" }], {
        config: {
          provider: "openai_compatible",
          baseUrl: "https://models.example/v1",
          model: "story-model",
          apiKey: "do-not-expose-this-key",
        },
        fetchImplementation: async () =>
          Response.json(
            { error: { message: "Rejected do-not-expose-this-key" } },
            { status: 401 },
          ),
      }),
    (error) =>
      !error.message.includes("do-not-expose-this-key") &&
      error.message.includes("密钥已隐藏"),
  );
});

test("switching cloud providers never reuses the previous provider key", async () => {
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_KEY = "deepseek-secret";
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-provider-switch-"));
  try {
    await assert.rejects(
      () =>
        saveAiProviderConfig(
          {
            provider: "openai_compatible",
            baseUrl: "https://models.example/v1",
            model: "new-story-model",
            jsonMode: "response_format",
          },
          { filePath: path.join(temporaryDirectory, ".env.local") },
        ),
      (error) =>
        error instanceof AiConfigurationError && error.message.includes("API Key"),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment();
  }
});

test("configuration save preserves unrelated dotenv entries and never exposes the key", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-provider-"));
  const filePath = path.join(temporaryDirectory, ".env.local");
  try {
    await writeFile(filePath, "UNRELATED_VALUE=keep\nAI_MODEL=old-model\n", "utf8");
    await saveAiProviderConfig(
      {
        provider: "openai_compatible",
        baseUrl: "https://models.example/v1",
        model: "new-story-model",
        apiKey: "new-secret",
        jsonMode: "prompt_only",
      },
      { filePath },
    );
    const source = await readFile(filePath, "utf8");
    assert.match(source, /^UNRELATED_VALUE=keep$/m);
    assert.match(source, /^AI_PROVIDER=openai_compatible$/m);
    assert.match(source, /^AI_MODEL=new-story-model$/m);
    assert.match(source, /^AI_API_KEY=new-secret$/m);
    const status = getAiProviderStatus();
    assert.equal(status.hasApiKey, true);
    assert.equal("apiKey" in status, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment();
  }
});

test("configuration deletion removes only API settings and clears the active runtime", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-provider-delete-"));
  const filePath = path.join(temporaryDirectory, ".env.local");
  try {
    await writeFile(
      filePath,
      [
        "UNRELATED_VALUE=keep",
        "AI_PROVIDER=openai_compatible",
        "AI_API_BASE_URL=https://models.example/v1",
        "AI_API_KEY=delete-this-secret",
        "AI_MODEL=story-model",
        "AI_JSON_MODE=prompt_only",
        "",
      ].join("\n"),
      "utf8",
    );
    process.env.AI_PROVIDER = "openai_compatible";
    process.env.AI_API_BASE_URL = "https://models.example/v1";
    process.env.AI_API_KEY = "delete-this-secret";
    process.env.AI_MODEL = "story-model";
    process.env.AI_JSON_MODE = "prompt_only";

    await deleteAiProviderConfig({ filePath });

    assert.equal(await readFile(filePath, "utf8"), "UNRELATED_VALUE=keep\n");
    assert.equal(process.env.AI_PROVIDER, undefined);
    assert.equal(process.env.AI_API_BASE_URL, undefined);
    assert.equal(process.env.AI_API_KEY, undefined);
    assert.equal(process.env.AI_MODEL, undefined);
    assert.equal(process.env.AI_JSON_MODE, undefined);
    const status = getAiProviderStatus();
    assert.equal(status.providerLabel, "DeepSeek");
    assert.equal(status.configured, false);
    assert.equal(status.hasApiKey, false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment();
  }
});

test("desktop configuration path stays inside the configured portable directory", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-desktop-config-"));
  const filePath = path.join(temporaryDirectory, "用户数据", "配置", "模型.env");
  try {
    process.env.AI_TAVERN_CONFIG_FILE = filePath;
    await saveAiProviderConfig({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "portable-secret",
      jsonMode: "response_format",
    });
    const source = await readFile(filePath, "utf8");
    assert.match(source, /^AI_PROVIDER=deepseek$/m);
    assert.match(source, /^AI_API_KEY=portable-secret$/m);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    restoreEnvironment();
  }
});
