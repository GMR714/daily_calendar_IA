const { test } = require("node:test");
const assert = require("node:assert/strict");
const { guardProposal } = require("../ollama");
const context = { context: { goals: [{ id: "g", title: "Emprego" }], entries: [{ id: "e", text: "Estudar" }] } };
test("guard rejects unsafe model edits and vague goal steps", () => {
  assert.throws(() => guardProposal({ summary: "x", goals: [{ title: "Emprego" }], entries: [], reports: [], updates: [] }, context), /recriar/);
  assert.throws(() => guardProposal({ summary: "x", goals: [], entries: [], reports: [], updates: [{ entryId: "fora", action: "edit", reason: "x" }] }, context), /fora do contexto/);
  assert.throws(() => guardProposal({ summary: "x", goals: [], entries: [{ type: "task", text: "Estudar", goalRef: "g", instructions: [], completionCriteria: "" }], reports: [], updates: [] }, context), /instrucoes/);
});
test("guard caps a valid proposal before it reaches the planner", () => {
  const output = guardProposal({ summary: "x", goals: [], entries: Array.from({ length: 20 }, (_, index) => ({ type: "task", text: `T${index}` })), reports: [{ text: "a" }, { text: "b" }], updates: Array.from({ length: 12 }, () => ({ entryId: "e", action: "edit", reason: "ok" })) }, context);
  assert.equal(output.entries.length, 12); assert.equal(output.reports.length, 1); assert.equal(output.updates.length, 8);
});
