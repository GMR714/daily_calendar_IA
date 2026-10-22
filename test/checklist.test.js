const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChecklist, applyTaskAction, applyProjectChange, checklistMetrics, recordOpen } = require("../checklist");
const Planner = require("../planner-core");

const TODAY = "2026-10-22";
const NOW = "2026-10-22T15:00:00.000Z";

function project(id, overrides = {}) {
  return { id, name: id.split("/")[1], area: "Pessoais", priority: 2, goalId: null, deadline: null, lastActivity: "2026-10-20", ...overrides };
}

function task(id, projectId, overrides = {}) {
  return { id, source: "sync", type: "task", status: "sugerida", text: id, projectId, date: null, createdAt: "2026-10-20T09:00:00.000Z", updatedAt: "2026-10-20T09:00:00.000Z", ...overrides };
}

const order = result => result.groups.map(g => g.project.id);

test("projeto com prazo mais perto vem antes de prioridade alta sem prazo", () => {
  const result = buildChecklist({
    entries: [task("a", "p/alta"), task("b", "p/prazo", { date: "2026-10-25" }), task("c", "p/prazo-longe", { date: "2026-11-30" })],
    projects: [project("p/alta", { priority: 3 }), project("p/prazo"), project("p/prazo-longe")],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/prazo", "p/prazo-longe", "p/alta"]);
  assert.equal(result.groups[0].deadline, "2026-10-25");
});

test("prazo do próprio projeto também conta", () => {
  const result = buildChecklist({
    entries: [task("a", "p/a"), task("b", "p/b")],
    projects: [project("p/a"), project("p/b", { deadline: "2026-10-30" })],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/b", "p/a"]);
});

test("prioridade vem da meta ligada ao projeto, senão do projeto", () => {
  const result = buildChecklist({
    entries: [task("a", "p/com-meta"), task("b", "p/media")],
    goals: [{ id: "meta-1", title: "Lançar o editor", priority: 3 }],
    projects: [project("p/media", { priority: 2 }), project("p/com-meta", { priority: 1, goalId: "meta-1" })],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/com-meta", "p/media"]);
  assert.equal(result.groups[0].priority, 3);
});

test("empate: o projeto parado há mais tempo sobe", () => {
  const result = buildChecklist({
    entries: [task("a", "p/recente"), task("b", "p/parado")],
    projects: [project("p/recente", { lastActivity: "2026-10-21" }), project("p/parado", { lastActivity: "2026-09-30" })],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/parado", "p/recente"]);
  assert.equal(result.groups[0].idleDays, 22);
});

test("dentro do projeto: prazo, depois confirmadas, depois as mais antigas", () => {
  const result = buildChecklist({
    entries: [
      task("nova-sugerida", "p/a", { createdAt: "2026-10-21T09:00:00.000Z" }),
      task("velha-sugerida", "p/a", { createdAt: "2026-10-19T09:00:00.000Z" }),
      task("confirmada", "p/a", { status: "confirmada", createdAt: "2026-10-21T10:00:00.000Z" }),
      task("com-prazo", "p/a", { date: "2026-10-28" })
    ],
    projects: [project("p/a")],
    today: TODAY
  });
  assert.deepEqual(result.groups[0].tasks.map(t => t.id), ["com-prazo", "confirmada", "velha-sugerida", "nova-sugerida"]);
});

test("fora da lista: descartadas, feitas, entradas manuais e projetos sem tarefa", () => {
  const result = buildChecklist({
    entries: [
      task("descartada", "p/a", { status: "descartada" }),
      task("feita", "p/a", { status: "feita" }),
      { id: "manual", type: "task", text: "manual", priority: 2 },
      task("aberta", "p/a")
    ],
    projects: [project("p/a"), project("p/vazio")],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/a"]);
  assert.deepEqual(result.groups[0].tasks.map(t => t.id), ["aberta"]);
});

test("fechada pela rodada hoje aparece para desfazer; de ontem, não", () => {
  const result = buildChecklist({
    entries: [
      task("hoje", "p/a", { status: "feita", doneAuto: true, doneBy: { day: "2026-10-21", evidence: "Testou." }, updatedAt: "2026-10-22T09:00:00.000Z" }),
      task("ontem", "p/a", { status: "feita", doneAuto: true, updatedAt: "2026-10-21T09:00:00.000Z" })
    ],
    projects: [project("p/a")],
    today: TODAY
  });
  assert.deepEqual(result.groups[0].doneToday.map(t => t.id), ["hoje"]);
  assert.deepEqual(result.groups[0].tasks, []);
});

test("projeto pausado sai da lista principal e projeto não revisado é marcado como novo", () => {
  const result = buildChecklist({
    entries: [task("a", "p/pausado"), task("b", "p/novo")],
    projects: [project("p/pausado", { paused: true, reviewed: true }), project("p/novo")],
    today: TODAY
  });
  assert.deepEqual(order(result), ["p/novo"]);
  assert.equal(result.groups[0].isNew, true);
  assert.deepEqual(result.paused.map(g => g.project.id), ["p/pausado"]);
});

test("ações na tarefa registram a decisão e a hora", () => {
  const base = task("a", "p/a");
  const confirmed = applyTaskAction(base, "confirm", NOW);
  assert.equal(confirmed.status, "confirmada");
  assert.equal(confirmed.decision, "confirmada");
  assert.equal(confirmed.updatedAt, NOW);

  const dismissed = applyTaskAction(confirmed, "dismiss", NOW);
  assert.equal(dismissed.status, "descartada");
  assert.equal(dismissed.decision, "descartada");

  const done = applyTaskAction(base, "done", NOW);
  assert.equal(done.status, "feita");
  assert.equal(done.doneAuto, false);
  assert.equal(done.decision, "confirmada");
});

test("desfazer o fechamento automático devolve o status anterior", () => {
  const closed = task("a", "p/a", { status: "feita", previousStatus: "confirmada", doneAuto: true, doneBy: { day: "2026-10-21", evidence: "x" } });
  const undone = applyTaskAction(closed, "undo", NOW);
  assert.equal(undone.status, "confirmada");
  assert.equal(undone.doneAuto, false);
  assert.equal(undone.doneBy, null);
  assert.equal(undone.updatedAt, NOW);
  assert.equal(applyTaskAction(task("b", "p/a", { status: "feita", doneAuto: true }), "undo", NOW).status, "sugerida");
});

test("desfazer sobrevive à mescla com a cópia do servidor", () => {
  const server = task("a", "p/a", { status: "feita", previousStatus: "sugerida", doneAuto: true, doneBy: { day: "2026-10-21", evidence: "x" } });
  const { data } = Planner.merge({ entries: [server] }, { entries: [server] }, { entries: [applyTaskAction(server, "undo", NOW)] });
  const [merged] = data.entries;
  assert.equal(merged.status, "sugerida");
  assert.equal(merged.doneAuto, false);
  assert.equal(merged.doneBy, null);
  assert.equal(merged.previousStatus, null);
});

test("mudar o projeto marca como revisado e guarda a hora", () => {
  const changed = applyProjectChange(project("p/a"), { priority: 3, paused: true }, NOW);
  assert.equal(changed.priority, 3);
  assert.equal(changed.paused, true);
  assert.equal(changed.reviewed, true);
  assert.equal(changed.updatedAt, NOW);
});

test("métricas: decisões, dias com o checklist aberto e tarefas manuais da semana", () => {
  const metrics = checklistMetrics({
    entries: [
      task("a", "p/a", { decision: "confirmada" }),
      task("b", "p/a", { decision: "confirmada" }),
      task("c", "p/a", { decision: "descartada" }),
      task("d", "p/a"),
      { id: "m1", type: "task", text: "manual", createdAt: "2026-10-21T12:00:00.000Z" },
      { id: "m2", type: "task", text: "manual antiga", createdAt: "2026-10-01T12:00:00.000Z" },
      { id: "r1", type: "routine", text: "academia", createdAt: "2026-10-21T12:00:00.000Z" }
    ],
    opens: ["2026-10-10", "2026-10-16", "2026-10-20", "2026-10-22"],
    today: TODAY
  });
  assert.deepEqual(metrics, { confirmed: 2, dismissed: 1, acceptance: 2 / 3, openDays: 3, manualTasks: 1 });
  assert.equal(checklistMetrics({ entries: [], opens: [], today: TODAY }).acceptance, null);
});

test("registra a abertura do dia uma vez só", () => {
  assert.deepEqual(recordOpen(["2026-10-21"], TODAY), ["2026-10-21", "2026-10-22"]);
  assert.deepEqual(recordOpen(["2026-10-22", "2026-10-21"], TODAY), ["2026-10-21", "2026-10-22"]);
});
