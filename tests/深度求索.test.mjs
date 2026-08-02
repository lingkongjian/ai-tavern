import assert from "node:assert/strict";
import test from "node:test";
import {
  DeepSeekRequestError,
  getDeepSeekStatus,
  requestDeepSeekJson,
  testDeepSeekConnection,
} from "../lib/ai/深度求索.ts";

const originalEnvironment = {
  AI_PROVIDER: process.env.AI_PROVIDER,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_API_BASE_URL: process.env.AI_API_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
  AI_JSON_MODE: process.env.AI_JSON_MODE,
};

function configureTestEnvironment() {
  process.env.AI_PROVIDER = "deepseek";
  process.env.AI_API_KEY = "test-secret-key";
  process.env.AI_API_BASE_URL = "https://api.deepseek.example/v1";
  process.env.AI_MODEL = "deepseek-v4-flash";
  process.env.AI_JSON_MODE = "response_format";
}

test.after(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("sends server-only JSON requests with the configured DeepSeek model", async () => {
  configureTestEnvironment();
  let capturedRequest;
  const fetchImplementation = async (url, init) => {
    capturedRequest = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      model: "deepseek-v4-flash",
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"status":"ok","scene":"测试完成"}' },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  };

  const result = await requestDeepSeekJson(
    [{ role: "user", content: "只返回 JSON" }],
    { fetchImplementation },
  );

  assert.equal(capturedRequest.url, "https://api.deepseek.example/v1/chat/completions");
  assert.equal(capturedRequest.init.headers.Authorization, "Bearer test-secret-key");
  assert.equal(capturedRequest.body.model, "deepseek-v4-flash");
  assert.deepEqual(capturedRequest.body.response_format, { type: "json_object" });
  assert.deepEqual(capturedRequest.body.thinking, { type: "disabled" });
  assert.equal(result.content.scene, "测试完成");
  assert.equal(result.usage.totalTokens, 15);
  assert.deepEqual(getDeepSeekStatus(), {
    configured: true,
    baseUrl: "https://api.deepseek.example/v1",
    model: "deepseek-v4-flash",
  });
});

test("reports authentication failures without exposing the configured key", async () => {
  configureTestEnvironment();
  await assert.rejects(
    () =>
      requestDeepSeekJson([{ role: "user", content: "测试" }], {
        fetchImplementation: async () =>
          Response.json(
            { error: { message: "Authentication failed" } },
            { status: 401 },
          ),
      }),
    (error) =>
      error instanceof DeepSeekRequestError &&
      error.status === 401 &&
      !error.message.includes("test-secret-key"),
  );
});

test("performs a minimal connection handshake", async () => {
  configureTestEnvironment();
  const result = await testDeepSeekConnection({
    fetchImplementation: async () =>
      Response.json({
        model: "deepseek-v4-flash",
        choices: [
          { finish_reason: "stop", message: { content: '{"status":"ok"}' } },
        ],
      }),
  });
  assert.equal(result.model, "deepseek-v4-flash");
});
