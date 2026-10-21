const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pendingRange, nextState, acquireLock, runDaily } = require("../daily");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-daily-"));
}

test("dias pendentes: da última rodada completa até ontem", () => {
  assert.deepEqual(pendingRange({ ultimoDiaCompleto: "2026-10-17" }, "2026-10-21"), { since: "2026-10-18", until: "2026-10-20" });
});

test("dias pendentes: sem rodada anterior, só ontem", () => {
  assert.deepEqual(pendingRange({}, "2026-10-21"), { since: "2026-10-20", until: "2026-10-20" });
});

test("dias pendentes: em dia não tem o que rodar", () => {
  assert.equal(pendingRange({ ultimoDiaCompleto: "2026-10-20" }, "2026-10-21"), null);
});

test("dias pendentes: --desde manda no começo, mesmo antes da última rodada", () => {
  assert.deepEqual(pendingRange({ ultimoDiaCompleto: "2026-10-20" }, "2026-10-21", { since: "2026-10-15" }), { since: "2026-10-15", until: "2026-10-20" });
});

test("dias pendentes: atravessa a virada do mês", () => {
  assert.deepEqual(pendingRange({ ultimoDiaCompleto: "2026-10-30" }, "2026-11-02"), { since: "2026-10-31", until: "2026-11-01" });
});

test("estado: rodada completa avança até o último dia", () => {
  const state = nextState({ ultimoDiaCompleto: "2026-10-17" }, { until: "2026-10-20", failedDays: [], pendingDays: [] });
  assert.equal(state.ultimoDiaCompleto, "2026-10-20");
  assert.equal(state.tentativas, 0);
});

test("estado: para no dia anterior ao primeiro pendente", () => {
  const state = nextState({ ultimoDiaCompleto: "2026-10-17" }, { until: "2026-10-20", failedDays: [], pendingDays: ["2026-10-19", "2026-10-20"] });
  assert.equal(state.ultimoDiaCompleto, "2026-10-18");
});

test("estado: falha segura o dia e conta tentativa; na terceira desiste e segue", () => {
  const run = { until: "2026-10-20", failedDays: ["2026-10-19"], pendingDays: [] };
  const first = nextState({ ultimoDiaCompleto: "2026-10-17" }, run);
  assert.equal(first.ultimoDiaCompleto, "2026-10-18");
  assert.equal(first.tentativas, 1);
  const second = nextState(first, run);
  assert.equal(second.ultimoDiaCompleto, "2026-10-18");
  const third = nextState(second, run);
  assert.equal(third.ultimoDiaCompleto, "2026-10-20");
  assert.deepEqual(third.desistiu, ["2026-10-19"]);
  assert.equal(third.tentativas, 0);
});

test("estado: pendente por limite não conta como tentativa falha", () => {
  const state = nextState({ ultimoDiaCompleto: "2026-10-17", tentativas: 2 }, { until: "2026-10-20", failedDays: [], pendingDays: ["2026-10-18"] });
  assert.equal(state.ultimoDiaCompleto, "2026-10-17");
  assert.equal(state.tentativas, 0);
});

test("estado: rodar dias antigos de novo não volta o estado para trás", () => {
  const state = nextState({ ultimoDiaCompleto: "2026-10-20" }, { until: "2026-10-16", failedDays: [], pendingDays: [] });
  assert.equal(state.ultimoDiaCompleto, "2026-10-20");
});

test("trava: segunda rodada não entra enquanto a primeira está viva", () => {
  const file = path.join(tempDir(), "rodada.lock");
  const release = acquireLock(file, { pid: 111, isAlive: () => true });
  assert.ok(release);
  assert.equal(acquireLock(file, { pid: 222, isAlive: () => true }), null);
  release();
  assert.equal(fs.existsSync(file), false);
  assert.ok(acquireLock(file, { pid: 222, isAlive: () => true }));
});

test("trava: rodada que morreu não segura as próximas", () => {
  const file = path.join(tempDir(), "rodada.lock");
  acquireLock(file, { pid: 111, isAlive: () => true });
  assert.ok(acquireLock(file, { pid: 222, isAlive: pid => pid !== 111 }));
});

test("trava: rodada viva há tempo demais é considerada travada", () => {
  const file = path.join(tempDir(), "rodada.lock");
  acquireLock(file, { pid: 111, now: Date.parse("2026-10-21T06:00:00Z"), isAlive: () => true });
  assert.ok(acquireLock(file, { pid: 222, now: Date.parse("2026-10-21T13:00:00Z"), isAlive: () => true }));
});

function fakeVault(result = {}) {
  const calls = [];
  const run = async options => {
    calls.push(options);
    return { summarized: 1, cached: 0, failed: 0, pending: 0, limitHit: false, tasksAdded: 0, tasksClosed: 0, projectDays: 1, days: 1, failedDays: [], pendingDays: [], target: "vault", ...result };
  };
  return { calls, run };
}

test("rodada diária: roda os dias pendentes, guarda o estado e escreve o log", async () => {
  const dataDir = tempDir();
  const logsDir = tempDir();
  fs.writeFileSync(path.join(dataDir, "rodada.json"), JSON.stringify({ ultimoDiaCompleto: "2026-10-18" }));
  const vault = fakeVault();
  const out = await runDaily({ dataDir, logsDir, today: "2026-10-21", runVault: vault.run, maxSummaries: 7 });

  assert.equal(out.status, "ok");
  assert.equal(vault.calls.length, 1);
  assert.equal(vault.calls[0].since, "2026-10-19");
  assert.equal(vault.calls[0].until, "2026-10-20");
  assert.equal(vault.calls[0].maxSummaries, 7);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "rodada.json"), "utf8")).ultimoDiaCompleto, "2026-10-20");
  assert.match(fs.readFileSync(path.join(logsDir, "2026-10-21.log"), "utf8"), /2026-10-19 a 2026-10-20/);
  assert.equal(fs.existsSync(path.join(dataDir, "rodada.lock")), false);
});

test("rodada diária: em dia, não chama a IA", async () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, "rodada.json"), JSON.stringify({ ultimoDiaCompleto: "2026-10-20" }));
  const vault = fakeVault();
  const out = await runDaily({ dataDir, logsDir: tempDir(), today: "2026-10-21", runVault: vault.run });
  assert.equal(out.status, "em-dia");
  assert.equal(vault.calls.length, 0);
});

test("rodada diária: com outra rodada em andamento, sai sem rodar", async () => {
  const dataDir = tempDir();
  acquireLock(path.join(dataDir, "rodada.lock"), { pid: process.pid });
  const vault = fakeVault();
  const out = await runDaily({ dataDir, logsDir: tempDir(), today: "2026-10-21", runVault: vault.run });
  assert.equal(out.status, "ocupada");
  assert.equal(vault.calls.length, 0);
});

test("rodada diária: incompleta guarda o progresso e libera a trava", async () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, "rodada.json"), JSON.stringify({ ultimoDiaCompleto: "2026-10-17" }));
  const vault = fakeVault({ pending: 2, limitHit: true, pendingDays: ["2026-10-19", "2026-10-20"] });
  const out = await runDaily({ dataDir, logsDir: tempDir(), today: "2026-10-21", runVault: vault.run });
  assert.equal(out.status, "incompleta");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "rodada.json"), "utf8")).ultimoDiaCompleto, "2026-10-18");
  assert.equal(fs.existsSync(path.join(dataDir, "rodada.lock")), false);
});

test("rodada diária: erro no meio libera a trava e não avança o estado", async () => {
  const dataDir = tempDir();
  const logsDir = tempDir();
  fs.writeFileSync(path.join(dataDir, "rodada.json"), JSON.stringify({ ultimoDiaCompleto: "2026-10-17" }));
  const run = async () => { throw new Error("vault sumiu"); };
  await assert.rejects(runDaily({ dataDir, logsDir, today: "2026-10-21", runVault: run }), /vault sumiu/);
  assert.equal(fs.existsSync(path.join(dataDir, "rodada.lock")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "rodada.json"), "utf8")).ultimoDiaCompleto, "2026-10-17");
  assert.match(fs.readFileSync(path.join(logsDir, "2026-10-21.log"), "utf8"), /vault sumiu/);
});

test("rodada diária: dry-run não mexe no estado", async () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, "rodada.json"), JSON.stringify({ ultimoDiaCompleto: "2026-10-18" }));
  await runDaily({ dataDir, logsDir: tempDir(), today: "2026-10-21", runVault: fakeVault().run, dryRun: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "rodada.json"), "utf8")).ultimoDiaCompleto, "2026-10-18");
});
