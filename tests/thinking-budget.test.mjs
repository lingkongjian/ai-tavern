import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requestAiJson, requestAiJsonStream, getAiProviderConfig, AiConfigurationError, AiOutputTruncatedError } from "../lib/ai/模型供应商.ts";
import { saveAiProfile, listAiProfiles, activateAiProfile } from "../lib/ai/模型配置文件.ts";
import { generateWithProfileFailover } from "../lib/story/回合服务.ts";
import { getActiveAiProfileSync } from "../lib/ai/活动配置.ts";

const config = { provider: "local_openai_compatible", baseUrl: "http://127.0.0.1:1234/v1", model: "thinking-model", apiKey: "", jsonMode: "json_schema" };
const messages = [{ role: "user", content: '返回 {"status":"ok"}' }];
const keys = ["AI_PROVIDER", "AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_JSON_MODE", "AI_TAVERN_DATA_DIR", "AI_TAVERN_CONFIG_FILE"];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let directory;
test.beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "tavern-thinking-"));
  for (const key of keys) delete process.env[key];
  process.env.AI_TAVERN_DATA_DIR = directory;
  process.env.AI_TAVERN_CONFIG_FILE = path.join(directory, "test.env");
});
test.afterEach(async () => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  await rm(directory, { recursive: true, force: true });
});
function response(stream, reason = "stop") {
  const content = '{"status":"ok"}';
  if (!stream) return Response.json({ choices: [{ finish_reason: reason, message: { reasoning_content: "private reasoning", content } }] });
  const frames = [
    { choices: [{ delta: { reasoning_content: "private reasoning" } }] },
    { choices: [{ delta: { content }, finish_reason: reason }] },
    { choices: [], usage: { prompt_tokens: 14735, completion_tokens: 16384, total_tokens: 31119 } },
  ];
  return new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n");
}

for (const stream of [false, true]) {
  const request = stream ? requestAiJsonStream : requestAiJson;
  test(`${stream ? "stream" : "normal"}: profile budget reaches request and explicit overrides win`, async t => {
    const durations = [], bodies = [], deltas = [];
    t.mock.method(AbortSignal, "timeout", ms => { durations.push(ms); return new AbortController().signal; });
    await saveAiProfile({ ...config, maxOutputTokens: 16384, requestTimeoutSeconds: 3600 });
    const options = { onDelta: text => deltas.push(text), fetchImplementation: async (_url, init) => { bodies.push(JSON.parse(init.body)); return response(stream); } };
    const result = await request(messages, options);
    await request(messages, { ...options, maxTokens: 64, timeoutMs: 30000 });
    assert.deepEqual(bodies.map(body => body.max_tokens), [16384, 64]);
    assert.deepEqual(durations, [3600000, 30000]);
    assert.deepEqual(result.content, { status: "ok" });
    assert.equal(JSON.stringify(result).includes("private reasoning"), false);
    if (stream) {
      assert.deepEqual(deltas, ['{"status":"ok"}', '{"status":"ok"}']);
      assert.equal(result.usage.completionTokens, 16384);
    }
  });
  test(`${stream ? "stream" : "normal"}: length finish rejects even complete JSON and preserves active profile`, async () => {
    const active = await saveAiProfile({ ...config, maxOutputTokens: 16384, requestTimeoutSeconds: 3600 });
    await saveAiProfile({ ...config, model: "backup" });
    await activateAiProfile(active.id);
    let calls = 0;
    await assert.rejects(generateWithProfileFailover(messages, {
      ...(stream ? { onStreamDelta: () => {} } : {}),
      fetchImplementation: async () => { calls++; return response(stream, "length"); },
    }), error => error instanceof AiOutputTruncatedError && /16384.*含思考/.test(error.message));
    assert.equal(calls, 1);
    assert.equal(getActiveAiProfileSync().id, active.id);
  });
}

test("profile edits retain budgets, new/explicit profiles use defaults, switching restores budgets", async () => {
  const first = await saveAiProfile({ ...config, maxOutputTokens: 16384, requestTimeoutSeconds: 3600 });
  await saveAiProfile({ ...config, id: first.id, name: "renamed" });
  assert.equal(getAiProviderConfig().maxOutputTokens, 16384);
  assert.equal(getAiProviderConfig(config).maxOutputTokens, 6000);
  const second = await saveAiProfile({ ...config, model: "second" });
  assert.equal(second.maxOutputTokens, 6000);
  assert.equal(second.requestTimeoutSeconds, 1800);
  await activateAiProfile(first.id);
  assert.equal(getAiProviderConfig().requestTimeoutSeconds, 3600);
  const view = await listAiProfiles();
  assert.equal(view.profiles.find(p => p.id === first.id).maxOutputTokens, 16384);
  assert.equal("apiKey" in view.profiles[0], false);
});

test("invalid budget values are rejected before contacting model or saving", async () => {
  for (const [key, values] of [["maxOutputTokens", [0, -1, 1.5, 131073, NaN, Infinity, "16000"]], ["requestTimeoutSeconds", [0, -1, 0.5, 14401, NaN, Infinity, "3600"]]]) {
    for (const value of values) {
      assert.throws(() => getAiProviderConfig({ ...config, [key]: value }), AiConfigurationError);
      await assert.rejects(saveAiProfile({ ...config, [key]: value }), AiConfigurationError);
    }
  }
});
