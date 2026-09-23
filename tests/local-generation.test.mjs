import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestAiJson, requestAiJsonStream, AiRequestError } from "../lib/ai/模型供应商.ts";
import { auditAiProvider } from "../lib/ai/模型可用性.ts";
import { generateWithProfileFailover, TurnCancelledError } from "../lib/story/回合服务.ts";
import { getActiveAiProfileSync } from "../lib/ai/活动配置.ts";

const config = { provider: "local_openai_compatible", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model", apiKey: "", jsonMode: "json_schema" };
const messages = [{ role: "user", content: '返回 {"status":"ok"}' }];
const success = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"status":"ok"}' } }] });
const streamSuccess = () => new Response('data: {"choices":[{"delta":{"content":"{\\"status\\":\\"ok\\"}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
const envKeys = ["AI_PROVIDER", "AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_JSON_MODE", "AI_TAVERN_DATA_DIR", "AI_TAVERN_CONFIG_FILE"];
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
let directory;
test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-timeout-"));
  for (const key of envKeys) delete process.env[key];
  process.env.AI_TAVERN_DATA_DIR = directory;
  process.env.AI_TAVERN_CONFIG_FILE = path.join(directory, "模型.env");
});
test.afterEach(async () => {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  await rm(directory, { recursive: true, force: true });
});
const active = { ...config, id: "local", name: "本地模型" };
const invalidBackup = { ...config, id: "legacy-env", name: "旧 DeepSeek", provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", jsonMode: "response_format" };
async function profiles(alternates = [invalidBackup]) {
  await writeFile(path.join(directory, "api-configs.json"), JSON.stringify({ schemaVersion: 1, activeId: active.id, profiles: [active, ...alternates] }));
}

for (const [label, request, response] of [["normal", requestAiJson, success], ["streaming", requestAiJsonStream, streamSuccess]]) {
  test(`${label}: local generation gets 30 minutes, cloud keeps 90 seconds, explicit limits win`, async (t) => {
    const durations = [];
    t.mock.method(AbortSignal, "timeout", (duration) => { durations.push(duration); return new AbortController().signal; });
    for (const provider of ["local_openai_compatible", "openai_compatible"]) {
      await request(messages, { config: { ...config, provider, apiKey: "test-key" }, fetchImplementation: async () => response() });
    }
    await request(messages, { config, timeoutMs: 1234, fetchImplementation: async () => response() });
    assert.deepEqual(durations, [1_800_000, 90_000, 1234]);
  });
}

test("minimal availability audit retains its explicit 30-second generation budget", async (t) => {
  const durations = [];
  t.mock.method(AbortSignal, "timeout", (duration) => { durations.push(duration); return new AbortController().signal; });
  const audit = await auditAiProvider({ config, fetchImplementation: async (_url, init) => init.method === "GET" ? Response.json({ data: [{ id: config.model }] }) : success() });
  assert.equal(audit.ok, true);
  assert.deepEqual(durations, [15_000, 30_000]);
});

test("a local timeout is not replaced by a missing DeepSeek key from a legacy backup", async () => {
  await profiles();
  let calls = 0;
  // Native AbortSignal.timeout timers do not keep Node's event loop alive.
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(generateWithProfileFailover(messages, {
      timeoutMs: 15,
      onStreamDelta: () => {},
      fetchImplementation: async (_url, { signal }) => {
        calls++;
        return new Response(new ReadableStream({ start(controller) {
          signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
        } }));
      },
    }), (error) => error instanceof AiRequestError && /本地.*超时/.test(error.message) && !error.message.includes("DeepSeek"));
    assert.equal(calls, 1);
    assert.equal(getActiveAiProfileSync().id, active.id);
  } finally { clearInterval(keepAlive); }
});

test("invalid backups are skipped while a later valid backup can still succeed", async () => {
  await profiles([invalidBackup, { ...active, id: "backup", name: "有效备用", model: "backup-model" }]);
  const models = [];
  const result = await generateWithProfileFailover(messages, { fetchImplementation: async (_url, init) => {
    const model = JSON.parse(init.body).model;
    models.push(model);
    return model === config.model ? Response.json({ error: "unavailable" }, { status: 503 }) : success();
  } });
  assert.deepEqual(models, [config.model, "backup-model"]);
  assert.equal(result.content.status, "ok");
  assert.equal(getActiveAiProfileSync().id, "backup");
});

for (const phase of ["headers", "stream"]) {
  test(`cancelling during ${phase} aborts the provider without fallback or activation`, async () => {
    await profiles([{ ...active, id: "backup", model: "backup-model" }]);
    const controller = new AbortController();
    let calls = 0;
    let providerAborted = false;
    const pending = generateWithProfileFailover(messages, { signal: controller.signal, onStreamDelta: () => {}, fetchImplementation: async (_url, { signal }) => {
      calls++;
      const listen = (reject) => signal.addEventListener("abort", () => { providerAborted = true; reject(signal.reason); }, { once: true });
      if (phase === "headers") return new Promise((_resolve, reject) => { listen(reject); setImmediate(() => controller.abort()); });
      return new Response(new ReadableStream({ start(stream) { listen((error) => stream.error(error)); setImmediate(() => controller.abort()); } }));
    } });
    await assert.rejects(pending, TurnCancelledError);
    assert.equal(providerAborted, true);
    assert.equal(calls, 1);
    assert.equal(getActiveAiProfileSync().id, active.id);
  });
}

test("an already cancelled turn never sends a model request", async () => {
  await profiles();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generateWithProfileFailover(messages, { signal: controller.signal, fetchImplementation: async () => assert.fail("unexpected request") }), TurnCancelledError);
});
