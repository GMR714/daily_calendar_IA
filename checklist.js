// Checklist dirigido: ordem, ações e métricas. Usado pelo navegador (window.Checklist)
// e pelos testes (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Checklist = api;
})(typeof self !== "undefined" ? self : this, function () {
  const OPEN = ["sugerida", "confirmada"];

  function isSyncTask(entry) {
    return entry && entry.source === "sync";
  }

  // Dia local (AAAA-MM-DD) de um instante ISO.
  function localDay(iso) {
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDays(day, amount) {
    return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400e3).toISOString().slice(0, 10);
  }

  function daysBetween(from, to) {
    return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400e3);
  }

  function earliest(dates) {
    return dates.filter(Boolean).sort()[0] || null;
  }

  function byDateThen(a, b, next) {
    if (a && b && a !== b) return a < b ? -1 : 1;
    if (a && !b) return -1;
    if (!a && b) return 1;
    return next();
  }

  function compareTasks(a, b) {
    return byDateThen(a.date, b.date, () =>
      (a.status === "confirmada" ? 0 : 1) - (b.status === "confirmada" ? 0 : 1)
      || String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
      || String(a.text).localeCompare(String(b.text)));
  }

  // Prazo mais perto → prioridade (da meta, se houver) → parado há mais tempo.
  function compareGroups(a, b) {
    return byDateThen(a.deadline, b.deadline, () =>
      b.priority - a.priority
      || String(a.project.lastActivity || "").localeCompare(String(b.project.lastActivity || ""))
      || String(a.project.name).localeCompare(String(b.project.name)));
  }

  function projectPriority(project, goals) {
    const goal = project.goalId ? goals.find(item => item.id === project.goalId) : null;
    return Number((goal ? goal.priority : project.priority) || 2);
  }

  function buildChecklist({ entries = [], projects = [], today }) {
    const goals = entries.filter(entry => entry.type === "goal");
    const tasks = entries.filter(isSyncTask);
    const groups = projects
      .map(project => {
        const own = tasks.filter(task => task.projectId === project.id);
        const open = own.filter(task => OPEN.includes(task.status)).sort(compareTasks);
        const doneToday = own.filter(task => task.status === "feita" && task.doneAuto && task.updatedAt && localDay(task.updatedAt) === today);
        return {
          project,
          tasks: open,
          doneToday,
          deadline: earliest([project.deadline, ...open.map(task => task.date)]),
          priority: projectPriority(project, goals),
          idleDays: project.lastActivity ? daysBetween(project.lastActivity, today) : null,
          isNew: !project.reviewed
        };
      })
      .filter(group => group.tasks.length || group.doneToday.length);
    return {
      groups: groups.filter(group => !group.project.paused).sort(compareGroups),
      paused: groups.filter(group => group.project.paused).sort((a, b) => String(a.project.name).localeCompare(String(b.project.name)))
    };
  }

  function applyTaskAction(task, action, now) {
    if (action === "confirm") return { ...task, status: "confirmada", decision: task.decision || "confirmada", updatedAt: now };
    if (action === "dismiss") return { ...task, status: "descartada", decision: "descartada", updatedAt: now };
    if (action === "done") return { ...task, status: "feita", doneAuto: false, decision: task.decision || "confirmada", doneAt: now, updatedAt: now };
    // Zera em vez de apagar: a mescla com o servidor soma campos e traria os apagados de volta.
    if (action === "undo") return { ...task, status: task.previousStatus || "sugerida", doneAuto: false, doneBy: null, previousStatus: null, updatedAt: now };
    throw new Error(`Ação desconhecida: ${action}`);
  }

  function applyProjectChange(project, changes, now) {
    return { ...project, ...changes, reviewed: true, updatedAt: now };
  }

  // As três métricas da spec: decisões nas sugeridas, dias com o checklist aberto e
  // tarefas que ainda foram cadastradas à mão nos últimos 7 dias.
  function checklistMetrics({ entries = [], opens = [], today }) {
    const weekStart = addDays(today, -6);
    const tasks = entries.filter(isSyncTask);
    const confirmed = tasks.filter(task => task.decision === "confirmada").length;
    const dismissed = tasks.filter(task => task.decision === "descartada").length;
    return {
      confirmed,
      dismissed,
      acceptance: confirmed + dismissed ? confirmed / (confirmed + dismissed) : null,
      openDays: new Set(opens.filter(day => day >= weekStart && day <= today)).size,
      manualTasks: entries.filter(entry => !isSyncTask(entry) && entry.type === "task" && entry.createdAt && localDay(entry.createdAt) >= weekStart).length
    };
  }

  function recordOpen(opens = [], today) {
    return Array.from(new Set([...opens, today])).sort();
  }

  return { buildChecklist, applyTaskAction, applyProjectChange, checklistMetrics, recordOpen, localDay };
});
