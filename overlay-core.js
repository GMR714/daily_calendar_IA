const Planner = require("./planner-core");

function checklist(data, now = new Date()) {
  const date = Planner.dateKey(now);
  const plan = Planner.schedule(data, { from: date, to: Planner.addDays(date, 1), now });
  const goals = new Map((data.goals || []).map((goal, index) => [goal.id, { title: goal.title, colorIndex: index }]));
  return {
    date,
    blocks: plan.blocks
      .filter(block => Planner.dateKey(block.start) === date)
      .sort((left, right) => left.start.localeCompare(right.start))
      .map(block => ({ id: block.id, entryId: block.entryId, occurrenceDate: block.occurrenceDate, title: block.title, type: block.type, goalTitle: goals.get(block.goalId)?.title || null, goalColorIndex: goals.get(block.goalId)?.colorIndex ?? null, start: block.start, end: block.end, duration: block.duration, completed: block.completed }))
  };
}

function complete(data, request, now = new Date()) {
  const current = Planner.normalize(data);
  const entry = current.entries.find(item => item.id === request.entryId);
  if (!entry) throw new Error("Item da checklist nao encontrado.");
  const today = Planner.dateKey(now);
  if (request.occurrenceDate !== today) throw new Error("A checklist so conclui sessoes de hoje.");
  const block = checklist(current, now).blocks.find(item => item.entryId === entry.id && item.occurrenceDate === request.occurrenceDate && item.start === request.start);
  if (!block) throw new Error("Esta sessao nao esta mais no plano atual.");
  if (block.completed) return { data: current, title: entry.text, alreadyCompleted: true };
  if (entry.type === "routine") {
    entry.completionDates = [...new Set([...(entry.completionDates || []), block.occurrenceDate])];
  } else if (entry.type === "event") {
    entry.status = "completed";
    entry.completedAt = new Date(now).toISOString();
  } else {
    const minutes = Math.min(block.duration, Math.max(0, entry.duration - Number(entry.completedMinutes || 0)));
    entry.sessionLogs ||= [];
    entry.sessionLogs.push({ id: globalThis.crypto.randomUUID(), start: block.start, duration: block.duration, minutes, note: "Concluido pelo painel flutuante", recordedAt: new Date(now).toISOString() });
    entry.completedMinutes = Math.min(entry.duration, Number(entry.completedMinutes || 0) + minutes);
    if (entry.completedMinutes >= entry.duration) entry.status = "completed";
  }
  current.history ||= [];
  current.history.push({ id: globalThis.crypto.randomUUID(), at: new Date(now).toISOString(), summary: "Painel flutuante", changes: [{ action: "complete", title: entry.text, reason: "Sessao de " + block.duration + " min concluida" }] });
  current.history = current.history.slice(-100);
  return { data: current, title: entry.text, alreadyCompleted: false };
}

module.exports = { checklist, complete };
