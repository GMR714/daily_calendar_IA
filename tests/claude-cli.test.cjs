const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cliArguments, resultFromStream } = require("../claude-cli");

const payload = { message: "Preparar uma prova", mode: "auto", context: { goals: [], entries: [], preferences: {} } };

test("Claude Code command runs without tools and with a structured result contract", () => {
  const args = cliArguments(payload, { model: "sonnet", effort: "high" });
  const valueAfter = flag => args[args.indexOf(flag) + 1];
  assert.equal(valueAfter("--output-format"), "stream-json");
  assert.equal(valueAfter("--permission-mode"), "dontAsk");
  assert.equal(valueAfter("--permission-prompts"), "none");
  assert.equal(valueAfter("--tools"), "StructuredOutput");
  assert.equal(valueAfter("--allowedTools"), "StructuredOutput");
  assert.ok(args.includes("--restricted"));
  assert.ok(args.includes("--safe-mode"));
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.deepEqual(JSON.parse(valueAfter("--settings")).permissions.allow, ["StructuredOutput"]);
  assert.ok(JSON.parse(valueAfter("--settings")).permissions.deny.includes("Bash"));
});

test("Claude Code stream parser accepts only the final structured result", () => {
  const proposal = { summary: "Plano", goals: [], entries: [], reports: [], updates: [] };
  const output = JSON.stringify({ type: "system", subtype: "init" }) + "\n" + JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(proposal) });
  assert.deepEqual(resultFromStream(output), proposal);
  assert.throws(() => resultFromStream(JSON.stringify({ type: "result", is_error: true, result: "limite" })), /limite/);
});
