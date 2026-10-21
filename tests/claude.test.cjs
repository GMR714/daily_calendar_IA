const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClaudeInterpreter } = require("../claude");

const payload = {
  message: "Tenho uma prova dificil em 22/10/2026 e preciso estudar antes.",
  mode: "auto",
  context: { goals: [], entries: [], preferences: {} }
};

test("Claude adapter requests a forced structured proposal and keeps the result guarded", async () => {
  let request;
  const interpret = createClaudeInterpreter({
    apiKey: "test-key",
    model: "claude-test",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({
          content: [{
            type: "tool_use",
            name: "propose_agenda",
            input: {
              summary: "Vou separar preparacao e prova.",
              goals: [],
              entries: [{ type: "task", text: "Resolver exercicios de logica", duration: 240 }],
              reports: [],
              updates: []
            }
          }],
          usage: { input_tokens: 321, output_tokens: 123 }
        })
      };
    }
  });
  const result = await interpret(payload);
  const sent = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.options.headers["x-api-key"], "test-key");
  assert.equal(sent.model, "claude-test");
  assert.equal(sent.tool_choice.name, "propose_agenda");
  assert.equal(sent.tools[0].name, "propose_agenda");
  assert.match(sent.system, /nao crie blocos sobrepostos/i);
  assert.equal(result.mode, "ai");
  assert.equal(result.provider, "claude");
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.usage, { inputTokens: 321, outputTokens: 123 });
});

test("Claude adapter reports configuration and API failures without changing data", async () => {
  const unavailable = await createClaudeInterpreter({ apiKey: "" })(payload);
  assert.equal(unavailable.mode, "local");
  assert.match(unavailable.message, /ANTHROPIC_API_KEY/);
  const rejected = await createClaudeInterpreter({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "invalid key" } }) })
  })(payload);
  assert.equal(rejected.mode, "local");
  assert.match(rejected.message, /HTTP 401/);
});
