const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { projectId, openTasksFor, applySummaries, loadAgenda, saveAgenda } = require("../agenda");

const NOW = "2026-10-22T06:00:00.000Z";

function summary(overrides = {}) {
  return { estadoAtual: "x", ondeEstaCadaCoisa: [], feitoNoDia: ["y"], mudancas: [], tarefasNovas: [], tarefasConcluidas: [], ...overrides };
}

function entry(day, project, overrides) {
  return { day, area: "Pessoais", project, summary: summary(overrides) };
}

const manual = { id: "manual-1", type: "routine", text: "Academia", duration: 60, priority: 2 };

test("id de projeto é estável e sem acento", () => {
  assert.equal(projectId("Pessoais", "Vídeo Editor"), "pessoais/video-editor");
});

test("tarefas novas vêm só do resumo mais recente de cada projeto", () => {
  const { data, added } = applySummaries({ entries: [manual] }, [
    entry("2026-10-19", "PokeSurvivors", { tarefasNovas: [{ titulo: "Tarefa velha", contexto: "c", prazo: null }] }),
    entry("2026-10-20", "PokeSurvivors", { tarefasNovas: [{ titulo: "Testar o menu no celular", contexto: "Abre com Esc.", prazo: "2026-10-25" }] })
  ], { now: NOW });
  assert.equal(added, 1);
  const task = data.entries.find(e => e.source === "sync");
  assert.equal(task.text, "Testar o menu no celular");
  assert.equal(task.context, "Abre com Esc.");
  assert.equal(task.status, "sugerida");
  assert.equal(task.type, "task");
  assert.equal(task.date, "2026-10-25");
  assert.equal(task.projectId, "pessoais/pokesurvivors");
  assert.equal(task.updatedAt, NOW);
  assert.deepEqual(data.entries.find(e => e.id === "manual-1"), manual);
});

test("rodar de novo não duplica", () => {
  const items = [entry("2026-10-20", "PokeSurvivors", { tarefasNovas: [{ titulo: "Testar o menu", contexto: "c", prazo: null }] })];
  const first = applySummaries({ entries: [] }, items, { now: NOW }).data;
  const second = applySummaries(first, items, { now: NOW });
  assert.equal(second.added, 0);
  assert.equal(second.data.entries.length, 1);
});

test("tarefa descartada ou feita não volta, mesmo escrita diferente", () => {
  const items = [entry("2026-10-21", "PokeSurvivors", { tarefasNovas: [{ titulo: "testar o MENU no celular!", contexto: "c", prazo: null }] })];
  const base = applySummaries({ entries: [] }, [entry("2026-10-20", "PokeSurvivors", { tarefasNovas: [{ titulo: "Testar o menu no celular", contexto: "c", prazo: null }] })], { now: NOW }).data;
  for (const status of ["descartada", "feita"]) {
    const data = { ...base, entries: base.entries.map(e => ({ ...e, status })) };
    assert.equal(applySummaries(data, items, { now: NOW }).added, 0, status);
  }
});

test("fecha tarefa aberta que a sessão mostrou feita, com evidência e como desfazer", () => {
  const start = applySummaries({ entries: [] }, [entry("2026-10-20", "PokeSurvivors", { tarefasNovas: [{ titulo: "Testar o menu", contexto: "c", prazo: null }] })], { now: NOW }).data;
  const id = start.entries[0].id;
  const confirmed = { ...start, entries: [{ ...start.entries[0], status: "confirmada" }] };
  const { data, closed } = applySummaries(confirmed, [entry("2026-10-21", "PokeSurvivors", { tarefasConcluidas: [{ id, evidencia: "Testou no celular e funcionou." }] })], { now: "2026-10-22T07:00:00.000Z" });
  assert.equal(closed, 1);
  const task = data.entries[0];
  assert.equal(task.status, "feita");
  assert.equal(task.doneAuto, true);
  assert.equal(task.previousStatus, "confirmada");
  assert.deepEqual(task.doneBy, { day: "2026-10-21", evidence: "Testou no celular e funcionou." });
  assert.equal(task.updatedAt, "2026-10-22T07:00:00.000Z");
});

test("não fecha tarefa de outro projeto nem já descartada", () => {
  const start = applySummaries({ entries: [] }, [entry("2026-10-20", "PokeSurvivors", { tarefasNovas: [{ titulo: "Testar o menu", contexto: "c", prazo: null }] })], { now: NOW }).data;
  const id = start.entries[0].id;
  assert.equal(applySummaries(start, [entry("2026-10-21", "RoboJus", { tarefasConcluidas: [{ id, evidencia: "e" }] })], { now: NOW }).closed, 0);
  const dismissed = { ...start, entries: [{ ...start.entries[0], status: "descartada" }] };
  assert.equal(applySummaries(dismissed, [entry("2026-10-21", "PokeSurvivors", { tarefasConcluidas: [{ id, evidencia: "e" }] })], { now: NOW }).closed, 0);
});

test("projeto nasce com prioridade média e mantém o que o Gabriel definiu", () => {
  const first = applySummaries({ entries: [] }, [entry("2026-10-20", "PokeSurvivors")], { now: NOW }).data;
  assert.deepEqual(
    (({ id, name, area, priority, goalId, deadline, lastActivity, note }) => ({ id, name, area, priority, goalId, deadline, lastActivity, note }))(first.projects[0]),
    { id: "pessoais/pokesurvivors", name: "PokeSurvivors", area: "Pessoais", priority: 2, goalId: null, deadline: null, lastActivity: "2026-10-20", note: "Projetos/Pessoais/PokeSurvivors" }
  );
  const tuned = { ...first, projects: [{ ...first.projects[0], priority: 3, goalId: "meta-1" }] };
  const next = applySummaries(tuned, [entry("2026-10-21", "PokeSurvivors")], { now: NOW }).data.projects[0];
  assert.equal(next.priority, 3);
  assert.equal(next.goalId, "meta-1");
  assert.equal(next.lastActivity, "2026-10-21");
  const older = applySummaries(tuned, [entry("2026-10-01", "PokeSurvivors")], { now: NOW }).data.projects[0];
  assert.equal(older.lastActivity, "2026-10-20");
});

test("tarefas abertas do projeto para mandar à IA", () => {
  const data = { entries: [
    { id: "a", source: "sync", projectId: "pessoais/x", status: "sugerida", text: "A" },
    { id: "b", source: "sync", projectId: "pessoais/x", status: "confirmada", text: "B" },
    { id: "c", source: "sync", projectId: "pessoais/x", status: "feita", text: "C" },
    { id: "d", source: "sync", projectId: "pessoais/y", status: "sugerida", text: "D" },
    { id: "e", projectId: "pessoais/x", text: "manual" }
  ] };
  assert.deepEqual(openTasksFor(data, "pessoais/x"), [{ id: "a", titulo: "A" }, { id: "b", titulo: "B" }]);
});

test("carrega com padrões e salva guardando a versão anterior do dia", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-"));
  const file = path.join(dir, "agenda-data.json");
  assert.deepEqual(loadAgenda(file), { entries: [], reports: [], projects: [], opens: [] });
  fs.writeFileSync(file, JSON.stringify({ entries: [manual], reports: [] }));
  const backupFile = path.join(dir, "backup", "2026-10-22.json");
  saveAgenda(file, { ...loadAgenda(file), opens: ["2026-10-22"] }, { backupFile });
  saveAgenda(file, { ...loadAgenda(file), opens: ["2026-10-23"] }, { backupFile });
  assert.deepEqual(JSON.parse(fs.readFileSync(backupFile, "utf8")).entries, [manual]);
  assert.deepEqual(loadAgenda(file).opens, ["2026-10-23"]);
});
