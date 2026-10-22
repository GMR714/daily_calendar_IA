const { test } = require("node:test");
const assert = require("node:assert/strict");
const Planner = require("../planner-core");
const Overlay = require("../overlay-core");

function todayAt(time) {
  const date = Planner.dateKey(new Date());
  return new Date(date + "T" + time + ":00");
}

test("overlay checklist completes only the exact routine occurrence of today", () => {
  const now = todayAt("09:00");
  const weekday = (now.getDay() + 6) % 7;
  const data = {
    preferences: { weekdayStart: "08:00", weekdayEnd: "21:00" },
    entries: [{ id: "gym", text: "Academia", type: "routine", preferredDays: [weekday], time: "18:00", duration: 60, timeLocked: true }]
  };
  const block = Overlay.checklist(data, now).blocks[0];
  const result = Overlay.complete(data, { entryId: block.entryId, occurrenceDate: block.occurrenceDate, start: block.start }, now);
  assert.equal(result.data.entries[0].completionDates[0], Planner.dateKey(now));
  assert.equal(result.data.entries[0].status, "pending");
  assert.equal(Overlay.checklist(result.data, now).blocks[0].completed, true);
});

test("overlay task completion records one scheduled session and rejects a different date", () => {
  const now = todayAt("09:00");
  const data = {
    preferences: { weekdayStart: "08:00", weekdayEnd: "21:00" },
    entries: [{ id: "study", text: "Resolver exercicios", type: "task", date: Planner.dateKey(now), time: "10:00", duration: 120, timeLocked: true }]
  };
  const block = Overlay.checklist(data, now).blocks[0];
  const result = Overlay.complete(data, { entryId: block.entryId, occurrenceDate: block.occurrenceDate, start: block.start }, now);
  assert.equal(result.data.entries[0].completedMinutes, 120);
  assert.equal(result.data.entries[0].status, "completed");
  assert.equal(result.data.entries[0].sessionLogs.length, 1);
  assert.throws(() => Overlay.complete(data, { entryId: block.entryId, occurrenceDate: "2000-01-01", start: block.start }, now), /hoje/);
});

test("overlay checklist includes goal labels and stable color indexes", () => {
  const now = todayAt("09:00");
  const data = {
    preferences: { weekdayStart: "08:00", weekdayEnd: "21:00" },
    goals: [{ id: "first", title: "Saude" }, { id: "second", title: "Trabalho" }],
    entries: [{ id: "study", text: "Praticar", type: "task", goalId: "second", date: Planner.dateKey(now), time: "10:00", duration: 60, timeLocked: true }]
  };
  const block = Overlay.checklist(data, now).blocks[0];
  assert.equal(block.goalTitle, "Trabalho");
  assert.equal(block.goalColorIndex, 1);
});
