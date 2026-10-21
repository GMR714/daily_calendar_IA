(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const defaults = { weekdayStart: "08:00", weekdayEnd: "21:00", dailyFocusLimit: 240, pomodoroFocus: 25, pomodoroBreak: 5 };
  const clone = value => JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const dateKey = value => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const day = value => new Date(`${value}T00:00:00`);
  const addDays = (value, count) => { const date = day(value); date.setDate(date.getDate() + count); return dateKey(date); };
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(+day(value)) && dateKey(day(value)) === value;
  const validTime = value => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const at = (date, minute) => { const value = day(date); value.setMinutes(minute); return value; };
  const weekday = date => (day(date).getDay() + 6) % 7;
  const monday = date => addDays(date, -weekday(date));
  const active = entry => !["completed", "paused"].includes(entry.status);
  const uuid = () => globalThis.crypto.randomUUID();

  function normalize(input = {}) {
    const data = clone(input || {});
    for (const field of ["goals", "entries", "reports"]) {
      data[field] = [...new Map(list(data[field]).filter(item => item && typeof item.id === "string").map(item => [item.id, item])).values()];
    }
    data.preferences = { ...defaults, ...data.preferences };
    data.preferences.dailyFocusLimit = number(data.preferences.dailyFocusLimit, 240, 15, 1440);
    for (const entry of data.entries) {
      entry.duration = number(entry.duration, 60, 15, 10080);
      entry.completedMinutes = number(entry.completedMinutes, 0, 0, entry.duration);
      entry.priority = number(entry.priority, 2, 1, 3);
      entry.preferredDays = [...new Set(list(entry.preferredDays).filter(value => Number.isInteger(value) && value >= 0 && value <= 6))];
      entry.overrides = entry.overrides && typeof entry.overrides === "object" && !Array.isArray(entry.overrides) ? entry.overrides : {};
      entry.completionDates = list(entry.completionDates);
      entry.status ||= "pending";
      entry.instructions = list(entry.instructions);
    }
    data.revision = number(data.revision, 0, 0, Number.MAX_SAFE_INTEGER);
    data.history = list(data.history).slice(-100);
    return data;
  }

  function focusSegments(start, duration, entry, preferences) {
    const text = norm(entry.text);
    const focusTask = entry.type === "task" || /estud|projet|program|escrev|pesquis/.test(text);
    let cursor = +start;
    let remaining = duration;
    const segments = [];
    while (remaining > 0) {
      const focus = Math.min(remaining, focusTask ? number(preferences.pomodoroFocus, 25, 15, 90) : remaining);
      segments.push({ kind: "focus", start: new Date(cursor).toISOString(), end: new Date(cursor + focus * 60000).toISOString() });
      cursor += focus * 60000; remaining -= focus;
      const pause = number(preferences.pomodoroBreak, 5, 1, 30);
      if (focusTask && remaining > pause) {
        segments.push({ kind: "break", start: new Date(cursor).toISOString(), end: new Date(cursor + pause * 60000).toISOString() });
        cursor += pause * 60000; remaining -= pause;
      }
    }
    return segments;
  }

  // Plan from today, never from the visible week: browsing must not reschedule tasks.
  function schedule(input, options = {}) {
    const data = normalize(input);
    const clock = options.now ? new Date(options.now) : new Date();
    const now = options.now ? clock : input.planningAt && dateKey(input.planningAt) === dateKey(clock) ? new Date(input.planningAt) : day(dateKey(clock));
    const today = dateKey(now);
    const from = options.from || today;
    const to = options.to || addDays(today, 7);
    const first = from < today ? from : today;
    const horizon = to > addDays(today, 90) ? to : addDays(today, 90);
    const days = [];
    for (let cursor = first; cursor < horizon && days.length < 1100; cursor = addDays(cursor, 1)) days.push(cursor);
    const occupied = new Map(days.map(date => [date, []]));
    const load = new Map();
    const weekly = new Map();
    const blocks = [];
    const warnings = [];
    const warned = new Set();
    const goalById = new Map(data.goals.map(goal => [goal.id, goal]));
    const warn = (entry, date, reason) => {
      const key = `${entry.id}|${date}|${reason}`;
      if (!warned.has(key)) { warnings.push({ entryId: entry.id, text: entry.text, date, reason }); warned.add(key); }
    };
    const available = entry => active(entry) && !["paused", "completed"].includes(goalById.get(entry.goalId)?.status);
    let begin = validTime(data.preferences.weekdayStart) ? minutes(data.preferences.weekdayStart) : 480;
    let end = validTime(data.preferences.weekdayEnd) ? minutes(data.preferences.weekdayEnd) : 1260;
    if (end <= begin) { begin = 480; end = 1260; }

    function reserve(entry, date, startMinute, duration, occurrenceDate, session = 0, completed = false) {
      const busy = occupied.get(date);
      if (!busy) return false;
      const finish = startMinute + duration;
      if (finish > 1440 || busy.some(slot => startMinute < slot.end && finish > slot.start)) return false;
      busy.push({ start: startMinute, end: finish });
      busy.sort((a, b) => a.start - b.start);
      const start = at(date, startMinute);
      const block = { id: `${entry.id}:${occurrenceDate || date}:${session}:${startMinute}`, entryId: entry.id, goalId: entry.goalId || null,
        occurrenceDate: occurrenceDate || date, type: entry.type, title: entry.text, calendarCategory: entry.calendarCategory,
        start: start.toISOString(), end: at(date, finish).toISOString(), duration, session, completed,
        pomodoros: focusSegments(start, duration, entry, data.preferences) };
      blocks.push(block);
      if (entry.type === "task") load.set(date, (load.get(date) || 0) + duration);
      if (entry.goalId && entry.type !== "event") {
        const key = `${entry.goalId}|${monday(date)}`;
        weekly.set(key, (weekly.get(key) || 0) + duration);
      }
      return true;
    }

    function windowFor(entry, date) {
      let lower = begin; let upper = end;
      const text = norm(entry.text);
      if (/\bmanha\b/.test(text)) upper = Math.min(upper, 720);
      else if (/\btarde\b/.test(text)) { lower = Math.max(lower, 720); upper = Math.min(upper, 1080); }
      else if (/\bnoite\b/.test(text)) lower = Math.max(lower, 1080);
      if (date === today) lower = Math.max(lower, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 15) * 15);
      return [lower, upper];
    }

    function findSlot(entry, date, desired, split = false) {
      let [lower, upper] = windowFor(entry, date);
      const busy = occupied.get(date) || [];
      const starts = [];
      if (validTime(entry.time)) starts.push(minutes(entry.time));
      for (let minute = lower; minute < upper; minute += 15) starts.push(minute);
      for (const minute of [...new Set(starts)]) {
        if (minute < lower || minute >= upper || busy.some(slot => minute >= slot.start && minute < slot.end)) continue;
        const next = busy.find(slot => slot.start >= minute);
        const space = Math.min(upper, next?.start ?? upper) - minute;
        const duration = split ? Math.min(desired, Math.floor(space / 15) * 15) : desired;
        if (duration >= Math.min(15, desired) && duration <= space) return { minute, duration };
      }
      return null;
    }

    for (const entry of data.entries) {
      for (const session of list(entry.sessionLogs)) {
        const date = dateKey(session.start);
        if (!occupied.has(date)) continue;
        const start = new Date(session.start);
        reserve(entry, date, start.getHours() * 60 + start.getMinutes(), session.duration, date, session.id, true);
      }
    }
    const fixed = []; const routines = [];
    for (const entry of data.entries.filter(available)) {
      if (entry.type === "routine") {
        if (!entry.preferredDays.length) { warn(entry, today, "Escolha os dias da rotina para agendar."); continue; }
        const sources = new Set([...days.filter(date => entry.preferredDays.includes(weekday(date))), ...Object.keys(entry.overrides).filter(validDate)]);
        for (const source of sources) {
          if ((validDate(entry.startDate) && source < entry.startDate) || (validDate(entry.endDate) && source > entry.endDate)) continue;
          const override = entry.overrides[source] || {};
          if (override.cancelled) continue;
          const effective = { ...entry, ...override };
          const date = validDate(override.date) ? override.date : source;
          if (!occupied.has(date)) continue;
          const candidate = { entry: effective, date, source, completed: entry.completionDates.includes(source) };
          if (validTime(effective.time) && effective.timeLocked !== false) fixed.push(candidate);
          else routines.push(candidate);
        }
      } else if (entry.type === "event" || (entry.timeLocked && validTime(entry.time))) {
        if (!validDate(entry.date) || !validTime(entry.time)) { warn(entry, entry.date || today, "Confirme data e horario deste compromisso."); continue; }
        if (occupied.has(entry.date)) fixed.push({ entry, date: entry.date, source: entry.date });
      }
    }
    fixed.sort((a, b) => a.date.localeCompare(b.date) || minutes(a.entry.time) - minutes(b.entry.time) || String(a.entry.id).localeCompare(String(b.entry.id)));
    for (const item of fixed) {
      if (!reserve(item.entry, item.date, minutes(item.entry.time), item.entry.duration, item.source, 0, item.completed)) warn(item.entry, item.date, "Conflito entre horarios fixos. Edite um dos compromissos.");
    }
    routines.sort((a, b) => a.date.localeCompare(b.date) || b.entry.priority - a.entry.priority || a.entry.id.localeCompare(b.entry.id));
    for (const item of routines) {
      const slot = findSlot(item.entry, item.date, item.entry.duration);
      if (slot) reserve(item.entry, item.date, slot.minute, slot.duration, item.source, 0, item.completed);
      else if (item.date >= today && !item.completed) warn(item.entry, item.date, "Rotina sem intervalo livre suficiente neste dia.");
    }

    const finishById = new Map(data.entries.filter(entry => entry.status === "completed").map(entry => [entry.id, today]));
    const goalCursor = new Map();
    const tasks = data.entries.filter(entry => available(entry) && entry.type === "task" && !(entry.timeLocked && validTime(entry.time)))
      .sort((a, b) => (a.deadline || goalById.get(a.goalId)?.targetDate || "9999").localeCompare(b.deadline || goalById.get(b.goalId)?.targetDate || "9999") ||
        (a.goalId && a.goalId === b.goalId ? number(a.planOrder, 999, 0, 9999) - number(b.planOrder, 999, 0, 9999) : b.priority - a.priority) || a.id.localeCompare(b.id));
    let remainingTasks = tasks.slice();
    for (let pass = 0; pass <= tasks.length && remainingTasks.length; pass++) {
      const deferred = [];
      for (const entry of remainingTasks) {
        const dependencies = list(entry.dependsOn);
        if (dependencies.some(id => !finishById.has(id))) { deferred.push(entry); continue; }
        const goal = goalById.get(entry.goalId);
        const deadline = validDate(entry.deadline) ? entry.deadline : validDate(goal?.targetDate) ? goal.targetDate : addDays(horizon, -1);
        let earliest = today;
        if (validDate(entry.date) && !entry.autoScheduled) earliest = entry.date > today ? entry.date : today;
        for (const dependency of dependencies) {
          const completed = data.entries.find(item => item.id === dependency)?.status === "completed";
          const after = completed ? today : addDays(finishById.get(dependency), 1);
          if (after > earliest) earliest = after;
        }
        if (entry.goalId && Number(entry.planOrder) > 0 && goalCursor.get(entry.goalId) > earliest) earliest = goalCursor.get(entry.goalId);
        let remaining = Math.max(0, entry.duration - entry.completedMinutes); let session = 0; let lastDate = null;
        for (const date of days) {
          if (date < earliest || date > deadline || date < today || remaining <= 0) continue;
          if (entry.preferredDays.length && !entry.preferredDays.includes(weekday(date))) continue;
          const dailyLeft = data.preferences.dailyFocusLimit - (load.get(date) || 0);
          const weeklyLeft = goal ? number(goal.weeklyMinutes, 240, 15, 10080) - (weekly.get(`${goal.id}|${monday(date)}`) || 0) : Infinity;
          const capacity = Math.min(120, dailyLeft, weeklyLeft);
          const desired = remaining < 15 ? Math.min(remaining, capacity) : Math.floor(Math.min(remaining, capacity) / 15) * 15;
          if (desired <= 0 || (desired < 15 && remaining >= 15)) continue;
          const slot = findSlot(entry, date, desired, true);
          if (slot && reserve(entry, date, slot.minute, slot.duration, date, ++session)) { remaining -= slot.duration; lastDate = date; }
        }
        if (remaining > 0) warn(entry, deadline, `${remaining} min pendentes: prazo, disponibilidade ou carga insuficiente.`);
        if (remaining === 0) finishById.set(entry.id, lastDate || today);
        if (entry.goalId && Number(entry.planOrder) > 0) goalCursor.set(entry.goalId, remaining > 0 ? horizon : addDays(lastDate || today, 1));
      }
      if (deferred.length === remainingTasks.length) { deferred.forEach(entry => warn(entry, today, "Etapa bloqueada por dependencia pendente ou circular.")); break; }
      remainingTasks = deferred;
    }
    return { blocks: blocks.filter(block => dateKey(block.start) >= from && dateKey(block.start) < to).sort((a, b) => a.start.localeCompare(b.start)),
      warnings: warnings.filter(warning => warning.date >= from && warning.date < to || data.entries.find(entry => entry.id === warning.entryId)?.type === "task"),
      allBlocks: blocks };
  }

  function applyInterpretation(input, proposal, options = {}) {
    const data = normalize(input); const changes = []; const refs = new Map(); const now = options.now || new Date().toISOString();
    const makeId = options.makeId || uuid;
    for (const raw of list(proposal.goals)) {
      if (!raw || !String(raw.title || "").trim()) throw new Error("A IA retornou uma meta sem titulo.");
      const existing = data.goals.find(goal => goal.id === raw.ref || goal.id === raw.id || norm(goal.title) === norm(raw.title));
      const id = existing?.id || makeId(); refs.set(raw.ref, id);
      const values = { ...raw, id, status: existing?.status || "active", createdAt: existing?.createdAt || now, updatedAt: now };
      if (existing) Object.assign(existing, values);
      else data.goals.push({ ...values, status: "active", progress: 0 });
      changes.push({ action: existing ? "edit" : "create", entity: "goal", id, title: raw.title });
    }
    for (const update of list(proposal.updates)) {
      if (!["edit", "delete", "complete", "pause", "resume", "reschedule", "adjust_duration"].includes(update.action)) throw new Error("Acao de alteracao desconhecida.");
      if (update.occurrenceDate && !validDate(update.occurrenceDate)) throw new Error("Data da ocorrencia invalida.");
      const entry = data.entries.find(item => item.id === update.entryId);
      if (!entry) throw new Error("A IA tentou alterar uma tarefa que nao existe. Atualize a proposta.");
      if (update.action === "delete") {
        if (!options.allowDelete) throw new Error("A exclusao nao foi solicitada na mensagem.");
        if (entry.type === "routine" && update.occurrenceDate) entry.overrides[update.occurrenceDate] = { cancelled: true };
        else data.entries = data.entries.filter(item => item.id !== entry.id);
      } else if (update.action === "complete") {
        if (entry.type === "routine") entry.completionDates = [...new Set([...entry.completionDates, update.occurrenceDate || dateKey(now)])];
        else { entry.status = "completed"; entry.completedMinutes = entry.duration; entry.completedAt = now; }
      } else {
        const mappings = { newText: "text", newType: "type", newDate: "date", newTime: "time", newDeadline: "deadline", duration: "duration", newPriority: "priority", newPreferredDays: "preferredDays", newInstructions: "instructions", newMilestone: "milestone", newCompletionCriteria: "completionCriteria", newPlanOrder: "planOrder" };
        const target = entry.type === "routine" && update.scope === "occurrence" && update.occurrenceDate ? (entry.overrides[update.occurrenceDate] ||= {}) : entry;
        for (const [key, field] of Object.entries(mappings)) if (update[key] !== null && update[key] !== undefined) target[field] = clone(update[key]);
        if (update.newTime) { target.timeLocked = true; target.autoScheduled = false; }
        if (update.action === "pause") entry.status = "paused";
        if (update.action === "resume" || update.action === "reschedule") entry.status = "pending";
        if (update.action === "reschedule" && !update.newDate && entry.type === "task") { entry.date = null; entry.time = null; entry.timeLocked = false; }
        entry.lastAdjustmentReason = update.reason || "";
      }
      entry.updatedAt = now;
      changes.push({ action: update.action, entity: "entry", id: entry.id, title: entry.text, reason: update.reason || "" });
    }
    for (const raw of list(proposal.entries)) {
      if (!raw || !String(raw.text || "").trim()) throw new Error("A IA retornou uma tarefa sem titulo.");
      if (!["task", "event", "routine"].includes(raw.type)) throw new Error("Tipo de tarefa invalido.");
      for (const field of ["date", "deadline"]) if (raw[field] && !validDate(raw[field])) throw new Error(`Data invalida: ${raw[field]}`);
      if (raw.time && !validTime(raw.time)) throw new Error("Horario invalido na proposta.");
      const goalId = refs.get(raw.goalRef) || (data.goals.some(goal => goal.id === raw.goalRef) ? raw.goalRef : null);
      if (raw.goalRef && !goalId) throw new Error("Etapa sem uma meta correspondente.");
      const duplicate = data.entries.find(entry => norm(entry.text) === norm(raw.text) && entry.type === raw.type && (entry.goalId || null) === goalId && (entry.date || null) === (raw.date || null) && (entry.time || null) === (raw.time || null) && JSON.stringify(entry.preferredDays) === JSON.stringify(list(raw.preferredDays)));
      if (duplicate) continue;
      const entry = { ...raw, id: makeId(), goalId, status: "pending", createdAt: now, updatedAt: now, completionDates: [], overrides: {}, completedMinutes: 0 };
      data.entries.push(entry); changes.push({ action: "create", entity: "entry", id: entry.id, title: entry.text });
    }
    for (const report of list(proposal.reports)) {
      if (!report.text) continue;
      const id = makeId(); data.reports.push({ ...report, id, createdAt: now });
      changes.push({ action: "create", entity: "report", id, title: report.text });
    }
    const normalized = normalize(data);
    validate(normalized);
    normalized.history.push({ id: makeId(), at: now, summary: proposal.summary || "Alteracoes na agenda", changes });
    normalized.history = normalized.history.slice(-100);
    return { data: normalized, changes };
  }

  function validate(data) {
    const prefs = data.preferences;
    if (!validTime(prefs.weekdayStart) || !validTime(prefs.weekdayEnd) || minutes(prefs.weekdayStart) >= minutes(prefs.weekdayEnd)) throw new Error("O fim do dia precisa ser depois do inicio.");
    for (const entry of data.entries) {
      if (!["task", "event", "routine"].includes(entry.type)) throw new Error("Tipo de tarefa invalido.");
      for (const field of ["date", "deadline"]) if (entry[field] && !validDate(entry[field])) throw new Error(`Data invalida em ${entry.text}.`);
      if (entry.time && !validTime(entry.time)) throw new Error(`Horario invalido em ${entry.text}.`);
      if (!String(entry.text || "").trim()) throw new Error("Toda tarefa precisa de um titulo.");
    }
    return data;
  }

  // Three-way merge preserves concurrent edits to different records; conflicts are explicit.
  function merge(currentInput, baseInput, incomingInput) {
    const current = normalize(currentInput), base = normalize(baseInput), incoming = normalize(incomingInput);
    const conflicts = [];
    for (const field of ["goals", "entries", "reports"]) {
      const result = new Map(current[field].map(item => [item.id, item]));
      const before = new Map(base[field].map(item => [item.id, item]));
      const after = new Map(incoming[field].map(item => [item.id, item]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const old = before.get(id), next = after.get(id), live = result.get(id);
        if (JSON.stringify(old) === JSON.stringify(next)) continue;
        if (JSON.stringify(live) !== JSON.stringify(old) && JSON.stringify(live) !== JSON.stringify(next)) { conflicts.push({ field, id, title: live?.text || live?.title || next?.text || next?.title || id }); continue; }
        if (next) result.set(id, next); else result.delete(id);
      }
      current[field] = [...result.values()];
    }
    for (const key of Object.keys(incoming.preferences)) {
      if (incoming.preferences[key] === base.preferences[key]) continue;
      if (current.preferences[key] !== base.preferences[key] && current.preferences[key] !== incoming.preferences[key]) conflicts.push({ field: "preferences", id: key, title: key });
      else current.preferences[key] = incoming.preferences[key];
    }
    current.history = [...new Map([...current.history, ...incoming.history].map(item => [item.id, item])).values()].slice(-100);
    if (incoming.planningAt && incoming.planningAt !== base.planningAt && (!current.planningAt || incoming.planningAt > current.planningAt)) current.planningAt = incoming.planningAt;
    return { data: current, conflicts };
  }

  return { defaults, normalize, validate, schedule, applyInterpretation, merge, dateKey, addDays, validDate, validTime };
});
