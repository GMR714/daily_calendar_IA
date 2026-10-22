const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const P = require("../planner-core");
const { createApp } = require("../server-runtime");

// Tarefas que a rodada diaria tira das sessoes: vivem no checklist, nao na semana.
const suggested = { id: "s1", type: "task", source: "sync", status: "sugerida", text: "Sugerida pela rodada", duration: 30, date: "2026-10-21", projectId: "pessoais/x" };
const confirmed = { id: "s2", type: "task", source: "sync", status: "confirmada", text: "Confirmada no checklist", duration: 30, date: "2026-10-21", projectId: "pessoais/x" };
const manual = { id: "t1", type: "task", text: "Estudar para a prova", duration: 60, status: "pending", deadline: "2026-10-23" };

test("planejamento ignora as tarefas da rodada", () => {
  const plan = P.schedule({ entries: [manual, suggested, confirmed] }, { from: "2026-10-21", to: "2026-10-24", now: "2026-10-21T09:00:00" });
  assert.ok(plan.blocks.some(block => block.entryId === "t1"));
  assert.deepEqual(plan.blocks.filter(block => block.entryId !== "t1"), []);
  assert.ok(!plan.warnings.some(warning => ["s1", "s2"].includes(warning.entryId)));
});

test("normaliza projetos por id e aberturas sem repetir", () => {
  const data = P.normalize({ projects: [{ id: "p/a", priority: 2 }, { id: "p/a", priority: 3 }, { id: "p/b" }], opens: ["2026-10-21", "2026-10-20", "2026-10-21"] });
  assert.deepEqual(data.projects.map(project => project.id), ["p/a", "p/b"]);
  assert.deepEqual(data.opens, ["2026-10-20", "2026-10-21"]);
  assert.deepEqual(P.normalize({}).projects, []);
  assert.deepEqual(P.normalize({}).opens, []);
});

test("mescla guarda a prioridade mudada no navegador e o projeto criado pela rodada", () => {
  const base = { projects: [{ id: "p/a", priority: 2 }], opens: ["2026-10-20"] };
  const incoming = { projects: [{ id: "p/a", priority: 3, reviewed: true }], opens: ["2026-10-20", "2026-10-21"] };
  const current = { projects: [{ id: "p/a", priority: 2 }, { id: "p/novo", priority: 2 }], opens: ["2026-10-20", "2026-10-19"] };
  const { data, conflicts } = P.merge(current, base, incoming);
  assert.deepEqual(conflicts, []);
  assert.equal(data.projects.find(project => project.id === "p/a").priority, 3);
  assert.ok(data.projects.some(project => project.id === "p/novo"));
  assert.deepEqual(data.opens, ["2026-10-19", "2026-10-20", "2026-10-21"]);
});

test("mescla junta o fechamento da rodada e a confirmacao no navegador", () => {
  const base = { entries: [suggested, { ...confirmed, status: "sugerida" }] };
  const incoming = { entries: [{ ...suggested, status: "confirmada", decision: "confirmada" }, { ...confirmed, status: "sugerida" }] };
  const current = { entries: [suggested, { ...confirmed, status: "feita", doneAuto: true }] };
  const { data, conflicts } = P.merge(current, base, incoming);
  assert.deepEqual(conflicts, []);
  assert.equal(data.entries.find(entry => entry.id === "s1").status, "confirmada");
  assert.equal(data.entries.find(entry => entry.id === "s2").status, "feita");
});

test("servidor entrega o checklist.js e nao manda as tarefas da rodada para a IA", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-sync-"));
  const file = path.join(directory, "agenda.json");
  fs.writeFileSync(file, JSON.stringify({ entries: [manual, suggested, confirmed] }));
  let context = null;
  const app = createApp({ file, interpret: async payload => { context = payload.context; return { mode: "ai", summary: "Nada", entries: [] }; } });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/checklist.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.match(await response.text(), /buildChecklist/);
  await app.propose({ message: "Organiza minha semana" });
  assert.deepEqual(context.entries.map(entry => entry.id), ["t1"]);
});

test("decidir tarefa da rodada nao replaneja o dia; mudar tarefa normal replaneja", async () => {
  const { createStore } = require("../agenda-store");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-store-sync-"));
  const store = createStore(path.join(directory, "agenda.json"));
  const pause = () => new Promise(resolve => setTimeout(resolve, 5));
  const first = store.write({ entries: [manual, suggested] });
  await pause();
  const decided = store.write({ ...store.read(), entries: [manual, { ...suggested, status: "confirmada" }] });
  assert.equal(decided.planningAt, first.planningAt);
  await pause();
  const edited = store.write({ ...store.read(), entries: [{ ...manual, duration: 90 }, { ...suggested, status: "confirmada" }] });
  assert.equal(edited.planningAt, edited.updatedAt);
  assert.notEqual(edited.planningAt, first.planningAt);
  fs.rmSync(directory, { recursive: true, force: true });
});
