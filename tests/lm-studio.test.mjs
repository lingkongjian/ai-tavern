import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AiRequestError, AiResponseError, requestAiJson, requestAiJsonStream } from "../lib/ai/模型供应商.ts";
import { auditAiProvider } from "../lib/ai/模型可用性.ts";
import { saveAiProviderConfig } from "../lib/ai/模型配置文件.ts";

const config = {
  provider: "local_openai_compatible", baseUrl: "http://127.0.0.1:1234/v1",
  model: "test-local-model", apiKey: "", jsonMode: "json_schema",
};
const messages = [{ role: "user", content: '返回 {"status":"ok"}' }];
const success = { model: config.model, choices: [{ finish_reason: "stop", message: { content: '{"status":"ok"}' } }] };
const lmError = "'response_format.type' must be 'json_schema' or 'text'";

test("LM Studio schema mode works in the full availability audit", async () => {
  const requests = [];
  const audit = await auditAiProvider({ config, fetchImplementation: async (_url, init) => {
    if (init.method === "GET") return Response.json({ data: [{ id: config.model }] });
    requests.push(JSON.parse(init.body));
    return Response.json(success);
  } });
  assert.equal(audit.ok, true);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].response_format, { type: "json_schema", json_schema: { name: "ai_tavern_json", schema: { type: "object" } } });
  assert.equal(requests[0].max_tokens, 64);
});

test("streaming gameplay uses the same schema without discarding story fields", async () => {
  const story = { scene: "旅人来到小镇。", characters: [{ name: "守卫" }], flags: { arrived: true } };
  let request;
  const result = await requestAiJsonStream(messages, { config, fetchImplementation: async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(story) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  } });
  assert.equal(request.stream, true);
  assert.equal(request.response_format.type, "json_schema");
  assert.deepEqual(result.content, story);
});

test("LM Studio's string error survives audit and gives an actionable HTTP 400 explanation", async () => {
  const audit = await auditAiProvider({ config: { ...config, jsonMode: "response_format" }, fetchImplementation: async (_url, init) =>
    init.method === "GET" ? Response.json({ data: [{ id: config.model }] }) : Response.json({ error: lmError }, { status: 400 }),
  });
  assert.equal(audit.ok, false);
  const detail = audit.checks.find((check) => check.id === "completion_json").detail;
  assert.match(detail, /HTTP 400/);
  assert.ok(detail.includes(lmError));
  assert.match(detail, /JSON Schema（LM Studio）/);
});

for (const [name, request] of [["normal", requestAiJson], ["streaming", requestAiJsonStream]]) {
  test(`${name} errors redact string and nested errors before truncation`, async () => {
    const key = "test-secret-at-the-boundary";
    for (const message of [`Rejected ${key}`, `${"x".repeat(490)}${key}`]) {
      for (const error of [message, { message }]) {
        await assert.rejects(request(messages, { config: { ...config, apiKey: key }, fetchImplementation: async () => Response.json({ error }, { status: 400 }) }),
          (failure) => failure instanceof AiRequestError && failure.status === 400 && !failure.message.includes("test-secret") && failure.message.includes("密钥已隐藏"));
      }
    }
  });
  test(`${name} non-JSON HTTP errors retain the status without exposing raw HTML`, async () => {
    await assert.rejects(request(messages, { config, fetchImplementation: async () => new Response("<html>internal details</html>", { status: 502 }) }),
      (error) => error instanceof AiRequestError && error.status === 502 && /HTTP 502/.test(error.message) && !error.message.includes("internal details"));
  });
}

test("schema mode still rejects invalid or non-object model output", async () => {
  for (const content of ["not JSON", "[]"]) {
    await assert.rejects(requestAiJson(messages, { config, fetchImplementation: async () => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] }) }), AiResponseError);
  }
});

test("schema selection persists through the configuration file", async () => {
  const keys = ["AI_PROVIDER", "AI_API_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_JSON_MODE", "AI_TAVERN_CONFIG_FILE", "AI_TAVERN_DATA_DIR"];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-tavern-schema-"));
  try {
    process.env.AI_TAVERN_DATA_DIR = root;
    const filePath = path.join(root, "模型.env");
    await saveAiProviderConfig(config, { filePath });
    assert.match(await readFile(filePath, "utf8"), /AI_JSON_MODE=json_schema/);
    assert.equal(process.env.AI_JSON_MODE, "json_schema");
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    await rm(root, { recursive: true, force: true });
  }
});
