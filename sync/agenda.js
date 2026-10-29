const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { projectNotePath } = require("./vault");
const { localDay } = require("./digest");
const { validDate } = require("../planner-core");

const OPEN = new Set(["sugerida", "confirmada"]);
const DEFAULT_DURATION = 60;
const DEFAULT_PRIORITY = 2;

function slug(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function projectId(area, project) {
  return `${slug(area)}/${slug(project)}`;
}

// Mesmo título com outra caixa, acento ou pontuação é a mesma tarefa.
function fingerprint(pid, title) {
  return `${pid}::${slug(title)}`;
}

// Palavras que não mudam a tarefa: "Mergear o setup-com-prova#59" é "Mergear setup-com-prova#59".
const STOPWORDS = new Set(["a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "e", "em", "no", "na", "nos", "nas", "ao", "aos", "para", "pra", "por", "pelo", "pela", "com", "que", "se", "apos", "sobre", "ate"]);

function titleWords(title) {
  return new Set(String(title)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9#_.-]+/)
    .map(word => word.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(word => word && !STOPWORDS.has(word)));
}

// Mesma tarefa com outras palavras: a menor cabe quase toda na maior, as duas têm tamanho
// parecido e citam os mesmos identificadores (PR, commit, arquivo): olimpo#1822 não é olimpo#1824.
function sameTask(a, b) {
  const [small, large] = [titleWords(a), titleWords(b)].sort((x, y) => x.size - y.size);
  const ids = words => [...words].filter(word => /\d/.test(word)).sort().join(" ");
  if (ids(small) !== ids(large)) return false;
  const shared = [...small].filter(word => large.has(word)).length;
  return shared >= 2 && shared / small.size >= 0.8 && small.size / large.size >= 0.6;
}

function taskId(print) {
  return `sync-${crypto.createHash("sha1").update(print).digest("hex").slice(0, 12)}`;
}

function loadAgenda(file) {
  const empty = { entries: [], reports: [], projects: [], opens: [] };
  if (!fs.existsSync(file)) return empty;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ...parsed,
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    reports: Array.isArray(parsed.reports) ? parsed.reports : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    opens: Array.isArray(parsed.opens) ? parsed.opens : []
  };
}

// Guarda a primeira versão do dia antes de sobrescrever e troca o arquivo de uma vez.
// Nova revisão: o app só busca o arquivo de novo quando ela muda. O planningAt fica como
// está, porque tarefa da rodada não entra no planejamento.
function saveAgenda(file, data, { backupFile, now = new Date().toISOString() } = {}) {
  if (backupFile && fs.existsSync(file) && !fs.existsSync(backupFile)) {
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(file, backupFile);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.sync-tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...data, revision: (Number(data.revision) || 0) + 1, updatedAt: now }, null, 2));
  fs.renameSync(tmp, file);
}

function isOpenSyncTask(entry, pid) {
  return entry.source === "sync" && entry.projectId === pid && OPEN.has(entry.status);
}

function openTasksFor(data, pid) {
  return (data.entries || []).filter(entry => isOpenSyncTask(entry, pid)).map(entry => ({ id: entry.id, titulo: entry.text }));
}

function upsertProject(projects, item, now) {
  const id = projectId(item.area, item.project);
  const note = projectNotePath(item.area, item.project).replace(/\.md$/, "");
  const existing = projects.find(p => p.id === id);
  if (!existing) {
    return [...projects, { id, name: item.project, area: item.area, priority: DEFAULT_PRIORITY, goalId: null, deadline: null, lastActivity: item.day, note, createdAt: now, updatedAt: now }];
  }
  const lastActivity = existing.lastActivity && existing.lastActivity > item.day ? existing.lastActivity : item.day;
  if (lastActivity === existing.lastActivity && existing.note === note) return projects;
  return projects.map(p => (p.id === id ? { ...p, name: item.project, area: item.area, lastActivity, note, updatedAt: now } : p));
}

// Recebe os resumos da rodada em ordem de dia. Fecha o que cada dia mostrou feito;
// tarefas novas só do resumo mais recente de cada projeto (os próximos passos de dias
// antigos ou já foram feitos ou foram substituídos pelos do dia seguinte).
function applySummaries(data, processed, { now }) {
  let entries = (data.entries || []).slice();
  let projects = (data.projects || []).slice();
  let added = 0;
  let closed = 0;
  const withSummary = processed.filter(item => item.summary);

  for (const item of withSummary) {
    projects = upsertProject(projects, item, now);
    const pid = projectId(item.area, item.project);
    for (const done of item.summary.tarefasConcluidas || []) {
      const index = entries.findIndex(entry => entry.id === done.id && isOpenSyncTask(entry, pid));
      if (index === -1) continue;
      const task = entries[index];
      entries[index] = { ...task, previousStatus: task.status, status: "feita", doneAuto: true, doneBy: { day: item.day, evidence: done.evidencia }, updatedAt: now };
      closed += 1;
    }
  }

  const latest = new Map();
  for (const item of withSummary) latest.set(projectId(item.area, item.project), item);
  for (const [pid, item] of latest) {
    for (const task of item.summary.tarefasNovas || []) {
      const print = fingerprint(pid, task.titulo);
      if (entries.some(entry => entry.fingerprint === print)) continue;
      if (entries.some(entry => isOpenSyncTask(entry, pid) && sameTask(entry.text, task.titulo))) continue;
      entries.push({
        id: taskId(print),
        type: "task",
        source: "sync",
        status: "sugerida",
        text: task.titulo,
        context: task.contexto,
        projectId: pid,
        // O app recusa gravar qualquer coisa se uma data não for AAAA-MM-DD válida.
        date: validDate(task.prazo) ? task.prazo : null,
        time: null,
        duration: DEFAULT_DURATION,
        priority: DEFAULT_PRIORITY,
        preferredDays: [],
        fingerprint: print,
        origin: { day: item.day, area: item.area, project: item.project },
        createdAt: now,
        updatedAt: now
      });
      added += 1;
    }
  }

  return { data: { ...data, entries, projects }, added, closed };
}

// Ficha de cada tarefa da rodada para o vault. A área e o nome vêm do projeto da agenda
// (acompanham renomeação); a origem só cobre projeto que saiu da lista.
function taskViews(data, { offsetHours = -3 } = {}) {
  const projects = new Map((data.projects || []).map(p => [p.id, p]));
  return (data.entries || [])
    .filter(entry => entry.source === "sync" && entry.projectId)
    .map(entry => {
      const project = projects.get(entry.projectId);
      const origin = entry.origin || {};
      const changedDay = entry.updatedAt ? localDay(entry.updatedAt, offsetHours) : null;
      return {
        id: entry.id,
        title: entry.text,
        status: entry.status,
        area: project ? project.area : origin.area,
        project: project ? project.name : origin.project,
        context: entry.context || "",
        createdAt: entry.createdAt || null,
        createdDay: origin.day || (entry.createdAt ? localDay(entry.createdAt, offsetHours) : null),
        changedDay,
        doneDay: entry.status === "feita" ? (entry.doneBy && entry.doneBy.day) || changedDay : null,
        doneAuto: Boolean(entry.doneAuto),
        evidence: entry.doneBy ? entry.doneBy.evidence || null : null,
        deadline: validDate(entry.date) ? entry.date : null
      };
    })
    .filter(task => task.area && task.project && task.title);
}

module.exports = { projectId, fingerprint, openTasksFor, applySummaries, loadAgenda, saveAgenda, taskViews };
