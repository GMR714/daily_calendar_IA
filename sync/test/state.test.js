const test = require("node:test");
const assert = require("node:assert/strict");
const { filesToRead, isNewRecord, rememberFile } = require("../state");

test("lê só arquivo novo ou alterado", () => {
  const state = { files: { "a.jsonl": { size: 10, mtimeMs: 100, lastTs: "2026-10-20T10:00:00.000Z" } } };
  const files = [
    { path: "a.jsonl", size: 10, mtimeMs: 100 },
    { path: "b.jsonl", size: 5, mtimeMs: 50 },
    { path: "c.jsonl", size: 7, mtimeMs: 70 }
  ];
  state.files["c.jsonl"] = { size: 3, mtimeMs: 30, lastTs: "2026-10-19T10:00:00.000Z" };
  assert.deepEqual(filesToRead(files, state).map(f => f.path), ["b.jsonl", "c.jsonl"]);
});

test("registro só é novo se for depois do último processado", () => {
  assert.equal(isNewRecord("2026-10-20T10:00:01.000Z", "2026-10-20T10:00:00.000Z"), true);
  assert.equal(isNewRecord("2026-10-20T10:00:00.000Z", "2026-10-20T10:00:00.000Z"), false);
  assert.equal(isNewRecord("2026-10-20T10:00:00.000Z", undefined), true);
});

test("guarda o arquivo processado sem perder os outros", () => {
  const state = { files: { "a.jsonl": { size: 1, mtimeMs: 1, lastTs: "x" } } };
  const next = rememberFile(state, { path: "b.jsonl", size: 2, mtimeMs: 2 }, "2026-10-21T00:00:00.000Z");
  assert.deepEqual(Object.keys(next.files).sort(), ["a.jsonl", "b.jsonl"]);
  assert.equal(next.files["b.jsonl"].lastTs, "2026-10-21T00:00:00.000Z");
  assert.equal(state.files["b.jsonl"], undefined);
});
