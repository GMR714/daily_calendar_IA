const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../planner-core");
const options = { now: "2026-07-13T07:00:00", from: "2026-07-13", to: "2026-07-20" };
const routine = (id, time, duration) => ({ id, text: id, type: "routine", time, duration, preferredDays: [0, 1, 2, 3, 4], timeLocked: true });
test("fixed routines reserve space and pomodoros never extend blocks", () => {
  const state = { entries: [routine("trabalho", "10:00", 270), routine("academia", "18:00", 60), { id: "estudo", type: "task", text: "Estudar", duration: 900 }] };
  const result = P.schedule(state, options);
  for (let i = 0; i < result.blocks.length; i++) {
    const block = result.blocks[i];
    assert.ok(block.pomodoros.every(segment => segment.start >= block.start && segment.end <= block.end));
    if (i) assert.ok(result.blocks[i - 1].end <= block.start);
  }
  assert.ok(result.blocks.filter(block => block.entryId === "estudo").length > 1);
  assert.equal(state.entries[2].date, undefined);
});
test("browsing another week does not change the plan", () => {
  const state = { entries: [{ id: "a", type: "task", text: "Projeto", duration: 1800 }] };
  const week = P.schedule(state, options);
  const later = P.schedule(state, { ...options, from: "2026-08-01", to: "2026-08-08" });
  assert.deepEqual(week.allBlocks, later.allBlocks);
});
test("future appointment stays in its month and collisions become warnings", () => {
  const entries = [routine("a", "18:00", 60), routine("b", "18:30", 60), { id: "consulta", type: "event", text: "Medico", duration: 60, date: "2026-11-13", time: "14:00" }];
  const week = P.schedule({ entries }, options);
  assert.ok(week.warnings.some(w => w.entryId === "b"));
  assert.ok(!week.blocks.some(b => b.entryId === "consulta"));
  const future = P.schedule({ entries }, { ...options, from: "2026-11-01", to: "2026-12-01" });
  assert.equal(P.dateKey(future.blocks.find(b => b.entryId === "consulta").start), "2026-11-13");
});
test("occurrence override moves just one day and cancellation preserves the series", () => {
  const entry = { ...routine("gym", "18:00", 60), overrides: { "2026-07-13": { date: "2026-07-14", time: "17:00" }, "2026-07-15": { cancelled: true } } };
  const blocks = P.schedule({ entries: [entry] }, options).blocks;
  assert.equal(blocks.length, 4);
  assert.ok(blocks.some(b => b.occurrenceDate === "2026-07-13" && P.dateKey(b.start) === "2026-07-14"));
});
test("AI updates are transactional, ID based, and deletion requires consent", () => {
  const state = { entries: [routine("gym", "08:00", 60), routine("cardio", "09:00", 60)] };
  const result = P.applyInterpretation(state, { updates: [{ entryId: "gym", action: "edit", newTime: "18:00" }] });
  assert.equal(result.data.entries.length, 2);
  assert.equal(result.data.entries[0].time, "18:00");
  assert.equal(state.entries[0].time, "08:00");
  assert.throws(() => P.applyInterpretation(state, { updates: [{ entryId: "missing", action: "edit" }] }));
  assert.throws(() => P.applyInterpretation(state, { updates: [{ entryId: "gym", action: "delete" }] }));
});
test("three way sync retains independent edits, detects conflicts and never resurrects deletions", () => {
  const base = P.normalize({ entries: [{ id: "a", text: "A", type: "task" }, { id: "b", text: "B", type: "task" }] });
  const current = structuredClone(base); current.entries = current.entries.filter(e => e.id !== "a");
  const incoming = structuredClone(base); incoming.entries[1].text = "B alterado";
  const result = P.merge(current, base, incoming);
  assert.equal(result.data.entries.length, 1); assert.equal(result.data.entries[0].text, "B alterado");
  incoming.entries[0].text = "A alterado";
  assert.equal(P.merge(current, base, incoming).conflicts.length, 1);
});
test("goal capacity and deadlines produce explicit pending work", () => {
  const result = P.schedule({ goals: [{ id: "g", weeklyMinutes: 60 }], entries: [{ id: "t", type: "task", text: "Projeto", goalId: "g", duration: 360, deadline: "2026-07-19" }] }, options);
  assert.equal(result.blocks.reduce((sum, b) => sum + b.duration, 0), 60);
  assert.ok(result.warnings.some(w => w.reason.includes("300 min")));
});
test("partial session remains on the calendar and remaining effort stays separate", () => {
  const entry = { id: "task", type: "task", text: "Projeto", duration: 300, completedMinutes: 60,
    sessionLogs: [{ id: "log", start: "2026-07-13T08:00:00", duration: 120, minutes: 60 }] };
  const plan = P.schedule({ entries: [entry] }, options);
  assert.equal(plan.blocks.filter(block => block.completed).length, 1);
  assert.equal(plan.blocks.filter(block => !block.completed).reduce((sum, block) => sum + block.duration, 0), 240);
  for (let i = 1; i < plan.blocks.length; i++) assert.ok(plan.blocks[i - 1].end <= plan.blocks[i].start);
});
test("dependencies precede later steps and sub-grid remainder is not lost", () => {
  const entries = [{ id: "a", type: "task", text: "Base", duration: 45, completedMinutes: 7 }, { id: "b", type: "task", text: "Avancado", duration: 60, dependsOn: ["a"] }];
  const plan = P.schedule({ entries }, options);
  const first = plan.blocks.filter(block => block.entryId === "a");
  const second = plan.blocks.find(block => block.entryId === "b");
  assert.equal(first.reduce((sum, block) => sum + block.duration, 0), 38);
  assert.ok(first.at(-1).end <= second.start);
});
test("AI cannot mark an entire long-term goal complete while adjusting its plan", () => {
  const data = P.applyInterpretation({ goals: [{ id: "g", title: "Conseguir emprego", status: "active" }] }, { goals: [{ ref: "g", title: "Conseguir emprego", status: "completed" }] }).data;
  assert.equal(data.goals[0].status, "active");
});
test("generated schedules never overlap across a dense deterministic workload", () => {
  const entries = [routine("job", "10:00", 270), routine("gym", "18:00", 60)];
  for (let i = 0; i < 40; i++) entries.push({ id: `task-${i}`, text: `Etapa ${i}`, type: "task", duration: (i % 9 + 1) * 45, priority: i % 3 + 1, deadline: `2026-07-${String(14 + i % 15).padStart(2, "0")}` });
  const plan = P.schedule({ entries }, { ...options, to: "2026-08-01" });
  for (let i = 1; i < plan.blocks.length; i++) assert.ok(plan.blocks[i - 1].end <= plan.blocks[i].start);
  assert.ok(plan.warnings.length > 0);
});
