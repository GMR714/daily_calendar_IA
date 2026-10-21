const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeById } = require("../agenda-merge");

test("vence a versão com updatedAt mais novo, venha de onde vier", () => {
  const closed = { id: "t1", status: "feita", updatedAt: "2026-10-22T09:00:00.000Z" };
  const stale = { id: "t1", status: "sugerida", updatedAt: "2026-10-21T09:00:00.000Z" };
  assert.equal(mergeById([closed], [stale])[0].status, "feita");
  assert.equal(mergeById([stale], [closed])[0].status, "feita");
});

test("sem data dos dois lados, vale a que chegou (comportamento antigo)", () => {
  assert.equal(mergeById([{ id: "a", text: "velho" }], [{ id: "a", text: "novo" }])[0].text, "novo");
});

test("cópia sem data não desfaz versão datada", () => {
  const dated = { id: "t1", status: "descartada", updatedAt: "2026-10-22T09:00:00.000Z" };
  assert.equal(mergeById([dated], [{ id: "t1", status: "sugerida" }])[0].status, "descartada");
});

test("junta ids novos dos dois lados e ignora itens sem id", () => {
  const ids = mergeById([{ id: "a" }, { text: "sem id" }], [{ id: "b" }]).map(item => item.id).sort();
  assert.deepEqual(ids, ["a", "b"]);
});
