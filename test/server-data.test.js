const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadAgendaData, mergeAgendaData } = require("../server");

test("carregar a agenda mantém projetos e aberturas do app", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agenda-")), "agenda-data.json");
  fs.writeFileSync(file, JSON.stringify({ entries: [{ id: "a" }], reports: [], projects: [{ id: "pessoais/x" }], opens: ["2026-10-21"] }));
  const data = loadAgendaData(file);
  assert.deepEqual(data.projects, [{ id: "pessoais/x" }]);
  assert.deepEqual(data.opens, ["2026-10-21"]);
  assert.deepEqual(loadAgendaData(path.join(path.dirname(file), "nao-existe.json")), { entries: [], reports: [], projects: [], opens: [] });
});

test("mesclar o que o navegador manda não apaga projetos nem aberturas", () => {
  const current = { entries: [{ id: "t1", status: "feita", updatedAt: "2026-10-22T09:00:00.000Z" }], reports: [], projects: [{ id: "p", priority: 3 }], opens: ["2026-10-20"] };
  const fromBrowser = { entries: [{ id: "t1", status: "sugerida", updatedAt: "2026-10-21T09:00:00.000Z" }], reports: [], opens: ["2026-10-21", "2026-10-20"] };
  const merged = mergeAgendaData(current, fromBrowser);
  assert.equal(merged.entries[0].status, "feita");
  assert.deepEqual(merged.projects, [{ id: "p", priority: 3 }]);
  assert.deepEqual(merged.opens, ["2026-10-20", "2026-10-21"]);
});
