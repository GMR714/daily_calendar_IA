const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");

test("API proposes without writing, confirms once and rejects stale proposals", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-api-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", summary: "Plano", entries: [{ type: "task", text: "Construir API com testes", duration: 480 }] }) });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (url, body) => { const response = await fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const proposal = await post("/api/interpret", { message: "Preciso construir uma API" });
  assert.equal(proposal.status, 200); assert.equal(app.store.read().entries.length, 0);
  const saved = await post(`/api/proposals/${proposal.body.proposalId}/apply`, {});
  assert.equal(saved.status, 200); assert.equal(saved.body.data.entries.length, 1);
  const retry = await post(`/api/proposals/${proposal.body.proposalId}/apply`, {});
  assert.equal(retry.body.alreadyApplied, true); assert.equal(app.store.read().revision, 1);
  const stale = await post("/api/interpret", { message: "Revise" });
  app.store.write(app.store.read());
  assert.equal((await post(`/api/proposals/${stale.body.proposalId}/apply`, {})).status, 409);
  assert.equal((await post("/api/state/merge", { authoritative: true, entries: [] })).status, 409);
  assert.equal(app.store.read().entries.length, 1);
  const malformed = await fetch(base + "/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  const hostile = await fetch(base + "/api/state/merge", { method: "POST", headers: { Origin: "https://example.com" }, body: "{}" });
  assert.equal(hostile.status, 403);
});

test("failed model response leaves all data untouched", async () => {
  const app = createApp({ file: path.join(os.tmpdir(), `agenda-absent-${Date.now()}.json`), interpret: async () => ({ mode: "local", message: "Ollama indisponivel" }) });
  await assert.rejects(app.propose({ message: "Texto longo" }), /Ollama/);
  assert.equal(app.store.read().revision, 0);
});
