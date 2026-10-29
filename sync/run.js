#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig } = require("./projects");
const { listSessionFiles, readRecords } = require("./sessions");
const { createDigestBuilder, renderDigest, localDay } = require("./digest");
const { PROMPT_VERSION, summarizeProject, claudeRunner } = require("./summarize");
const vault = require("./vault");
const agendaStore = require("./agenda");

const DEFAULT_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const DEFAULT_OUT_DIR = path.join(__dirname, "..", "sync-preview");
const DEFAULT_DATA_DIR = process.env.AGENDA_SYNC_DATA_DIR || path.join(__dirname, "..", "sync-data");
const DEFAULT_VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR || path.join(os.homedir(), "Documents", "Obsidian Vault");
const DEFAULT_AGENDA_FILE = process.env.AGENDA_DATA_FILE || path.join(__dirname, "..", "agenda-data.json");
// Pasta neutra para o `claude -p`: fica em Temp, que a coleta já ignora.
const CLAUDE_WORK_DIR = path.join(os.tmpdir(), "agenda-sync-claude");
const DAY_MS = 86400e3;

function listWithMore(items, max) {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; +${items.length - max}` : shown;
}

function cell(text) {
  return String(text).replace(/\|/g, "/").replace(/\n/g, " ");
}

function projectKey(area, project) {
  return `${area}|${project}`;
}

async function collectDigests({ projectsDir, config, since, until, offsetHours }) {
  // Margem de um dia: o arquivo pode ter sido tocado pela última vez no fim do dia anterior em UTC.
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) - DAY_MS : 0;
  const files = listSessionFiles(projectsDir, { sinceMs, ignoreDirs: config.ignoreProjectDirs || [] });
  const builder = createDigestBuilder({ config, offsetHours, since, until });
  let badLines = 0;
  for (const file of files) badLines += await readRecords(file.path, builder.add);
  return { files, badLines, digests: builder.finish() };
}

function groupProjects(digests) {
  const projects = new Map();
  for (const digest of digests.filter(d => !d.loose)) {
    const key = projectKey(digest.area, digest.project);
    if (!projects.has(key)) projects.set(key, { area: digest.area, project: digest.project, sessions: new Map(), days: new Set(), cwds: new Set(), digests: [] });
    const project = projects.get(key);
    project.sessions.set(digest.sessionId, digest.title || "(sem título)");
    project.days.add(digest.day);
    digest.cwds.forEach(cwd => project.cwds.add(cwd));
    project.digests.push(digest);
  }
  return Array.from(projects.values());
}

// Um dia de um projeto pode ter várias sessões: o orçamento de texto é dividido entre elas.
function projectDays(project, maxChars) {
  const byDay = new Map();
  for (const digest of project.digests) byDay.set(digest.day, [...(byDay.get(digest.day) || []), digest]);
  return Array.from(byDay, ([day, sameDay]) => ({
    area: project.area,
    project: project.project,
    day,
    sessions: sameDay.map(d => ({ day, sessionId: d.sessionId, title: d.title })),
    text: sameDay.map(d => renderDigest(d, { maxChars: Math.floor(maxChars / sameDay.length) })).join("\n\n---\n\n")
  }));
}

function renderProjectsIndex(projects, { since, until }) {
  const areas = Array.from(new Set(projects.map(p => p.area))).sort();
  const lines = [
    `# Projetos encontrados nas sessões (${since} a ${until})`,
    "",
    "Prévia gerada sem IA. Confira a área e o nome de cada projeto; correções vão em `sync/projects.config.json`.",
    ""
  ];
  for (const area of areas) {
    lines.push(`## ${area}`, "", "| Projeto | Sessões | Dias | Primeiro dia | Último dia | Pastas | Sessões (mais recentes) |", "|---|---|---|---|---|---|---|");
    const inArea = projects.filter(p => p.area === area).sort((a, b) => Math.max(...[...b.days].map(Date.parse)) - Math.max(...[...a.days].map(Date.parse)));
    for (const p of inArea) {
      const days = Array.from(p.days).sort();
      const recentTitles = Array.from(new Set(p.digests.slice().sort((a, b) => b.day.localeCompare(a.day)).map(d => d.title || "(sem título)")));
      lines.push(`| ${cell(p.project)} | ${p.sessions.size} | ${days.length} | ${days[0]} | ${days[days.length - 1]} | ${cell(listWithMore(Array.from(p.cwds), 3))} | ${cell(listWithMore(recentTitles, 5))} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderLoose(digests) {
  const loose = digests.filter(d => d.loose).sort((a, b) => b.day.localeCompare(a.day));
  const lines = ["# Sessões avulsas", "", "Não viram projeto: entram só no log do dia.", ""];
  for (const d of loose) lines.push(`- ${d.day} — ${d.title || "(sem título)"} (${d.cwds[0] || "sem pasta"})`);
  return lines.join("\n");
}

async function runDigest({ projectsDir = DEFAULT_PROJECTS_DIR, outDir = DEFAULT_OUT_DIR, config = loadConfig(), since, until, offsetHours = -3, maxChars = 40000 }) {
  const { files, badLines, digests } = await collectDigests({ projectsDir, config, since, until, offsetHours });
  const projects = groupProjects(digests);

  fs.rmSync(path.join(outDir, "digest"), { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "projetos.md"), renderProjectsIndex(projects, { since, until }));
  fs.writeFileSync(path.join(outDir, "avulsas.md"), renderLoose(digests));

  for (const item of projects.flatMap(p => projectDays(p, maxChars))) {
    const dir = path.join(outDir, "digest", item.day);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${vault.safeName(item.area)} - ${vault.safeName(item.project)}.md`), item.text);
  }

  return {
    files: files.length,
    badLines,
    digests: digests.length,
    projects: projects.length,
    looseSessions: new Set(digests.filter(d => d.loose).map(d => d.sessionId)).size,
    outDir
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Todos os resumos já feitos, por projeto: dão o estado anterior e o histórico dos
// "últimos dias" mesmo quando a rodada só processa ontem.
function loadSummaryCache(cacheDir) {
  const history = new Map();
  if (!fs.existsSync(cacheDir)) return history;
  for (const day of fs.readdirSync(cacheDir)) {
    for (const name of fs.readdirSync(path.join(cacheDir, day))) {
      const entry = readJson(path.join(cacheDir, day, name));
      if (!entry || !entry.summary) continue;
      const key = projectKey(entry.area, entry.project);
      history.set(key, [...(history.get(key) || []), entry]);
    }
  }
  return history;
}

function putEntry(history, entry) {
  const key = projectKey(entry.area, entry.project);
  const others = (history.get(key) || []).filter(e => e.day !== entry.day);
  history.set(key, [...others, entry].sort((a, b) => a.day.localeCompare(b.day)));
}

function lastGoodBefore(entries = [], day) {
  return entries.filter(e => e.summary && e.day < day).pop() || null;
}

// Cada rodada só vê o dia anterior: a lista de avulsas do índice vem do que foi acumulado.
function mergeLoose(known, digests) {
  const byKey = new Map(known.map(s => [`${s.day}|${s.title}`, s]));
  for (const d of digests.filter(d => d.loose)) byKey.set(`${d.day}|${d.title || "(sem título)"}`, { day: d.day, title: d.title || "(sem título)" });
  return Array.from(byKey.values()).sort((a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title));
}

const OPEN_TASK = new Set(["sugerida", "confirmada"]);

// O vault é uma projeção do cache de resumos e da agenda: a cada rodada todos os projetos e
// todas as tarefas são regravados, e só muda no disco o arquivo cujo conteúdo mudou.
function writeVault({ target, backupDir, history, agendaData, loose, today, offsetHours }) {
  const write = (rel, build) => vault.safeWrite(target, rel, build(vault.readNote(target, rel)), { backupDir });
  const views = agendaData ? agendaStore.taskViews(agendaData, { offsetHours }) : null;
  let notes = [];
  if (views) {
    const existing = vault.findTaskNotes(target);
    // Descartada não ganha nota; se já tinha, a nota fica e só o status muda.
    const visible = views.filter(v => v.status !== "descartada" || existing.has(v.id));
    const paths = vault.assignTaskPaths(visible, existing);
    notes = visible.map(v => ({ ...v, path: paths.get(v.id), note: paths.get(v.id).replace(/\.md$/, "") }));
    for (const task of notes) write(task.path, current => vault.taskNoteText(current, task));
  }
  const tasksOf = key => notes.filter(t => projectKey(t.area, t.project) === key);

  const rows = [];
  for (const [key, entries] of history) {
    const good = entries.filter(e => e.summary);
    if (!good.length) continue;
    const latest = good[good.length - 1];
    const lastDay = entries[entries.length - 1].day;
    const pendingDays = entries.filter(e => !e.summary && e.day > latest.day).map(e => e.day);
    const tasks = views ? tasksOf(key) : undefined;
    const blocks = vault.renderProjectBlocks({ summary: latest.summary, summaryDay: latest.day, pendingDays, history: entries, sessions: entries.flatMap(e => e.sessions || []), lastDay, tasks });
    const initial = vault.projectTemplate(latest.area, latest.project);
    write(vault.projectNotePath(latest.area, latest.project), current => vault.setFrontmatter(
      vault.upsertBlocks(current == null ? null : vault.removeBlocks(current, ["recente"]), blocks, { initial, anchor: vault.MINE }),
      { tipo: "projeto", area: latest.area, projeto: latest.project, "ultima-atividade": lastDay }
    ));
    rows.push({ area: latest.area, project: latest.project, lastDay, summaryDay: latest.day, state: latest.summary.estadoAtual, open: tasks ? tasks.filter(t => OPEN_TASK.has(t.status)).length : null });
  }
  write(vault.INDEX_PATH, current => vault.upsertBlocks(current, { indice: vault.renderIndex(rows), avulsas: vault.renderLoose(loose, today) }, { initial: vault.indexTemplate() }));
  if (vault.readNote(target, vault.TASKS_BASE_PATH) == null) write(vault.TASKS_BASE_PATH, () => vault.tasksBase());
  return { taskNotes: notes.length, projects: rows.length };
}

async function runVault({
  projectsDir = DEFAULT_PROJECTS_DIR,
  vaultDir = DEFAULT_VAULT_DIR,
  previewDir = path.join(DEFAULT_OUT_DIR, "vault"),
  dataDir = DEFAULT_DATA_DIR,
  agendaFile = null,
  agendaPreviewFile = path.join(DEFAULT_OUT_DIR, "agenda-data.json"),
  config = loadConfig(),
  since,
  until,
  offsetHours = -3,
  maxChars = 40000,
  runner,
  model = "haiku",
  maxSummaries = Infinity,
  dryRun = false,
  renderOnly = false,
  today = localDay(new Date().toISOString(), offsetHours),
  log = () => {}
}) {
  // Só regravar o vault: nada de sessões nem de IA, só o cache e a agenda como estão.
  const { digests } = renderOnly ? { digests: [] } : await collectDigests({ projectsDir, config, since, until, offsetHours });
  const items = groupProjects(digests)
    .flatMap(p => projectDays(p, maxChars))
    .sort((a, b) => a.day.localeCompare(b.day) || a.area.localeCompare(b.area) || a.project.localeCompare(b.project));

  if (!runner && items.length) fs.mkdirSync(CLAUDE_WORK_DIR, { recursive: true });
  const run = runner || claudeRunner({ model, cwd: CLAUDE_WORK_DIR });
  const cacheDir = path.join(dataDir, "summaries");
  const history = loadSummaryCache(cacheDir);
  const agenda = agendaFile ? agendaStore.loadAgenda(agendaFile) : null;
  const processed = [];
  const counts = { summarized: 0, cached: 0, failed: 0, pending: 0 };
  let limitHit = false;
  let capHit = false;
  let calls = 0;
  let lastCallDay = null;

  for (const [index, item] of items.entries()) {
    const previous = lastGoodBefore(history.get(projectKey(item.area, item.project)), item.day);
    const previousState = previous ? previous.summary.estadoAtual : null;
    const openTasks = agenda ? agendaStore.openTasksFor(agenda, agendaStore.projectId(item.area, item.project)) : [];
    // Sem tarefas abertas a chave fica igual à de antes, e o cache já feito continua valendo.
    const tasksKey = openTasks.length ? `${JSON.stringify(openTasks)}\n` : "";
    const key = crypto.createHash("sha1").update(`${PROMPT_VERSION}\n${previousState}\n${tasksKey}${item.text}`).digest("hex");
    const cacheFile = path.join(cacheDir, item.day, `${vault.safeName(item.area)} - ${vault.safeName(item.project)}.json`);
    const label = `[${index + 1}/${items.length}] ${item.day} ${item.area} / ${item.project}`;

    // O teto só vale na virada do dia: um dia nunca fica pela metade por causa dele.
    if (!capHit && calls >= maxSummaries && item.day !== lastCallDay) {
      capHit = true;
      log(`Teto de ${maxSummaries} resumos da rodada atingido: o resto fica pendente para a próxima rodada.`);
    }

    let entry = readJson(cacheFile);
    if (entry && entry.key === key && entry.summary) {
      counts.cached += 1;
      log(`${label}: cache`);
    } else if (limitHit || capHit) {
      // Depois do limite de uso ou do teto, nem tenta: o dia fica pendente para a próxima rodada.
      entry = limitHit
        ? { key, day: item.day, area: item.area, project: item.project, sessions: item.sessions, summary: null, error: "limite de uso", limit: true }
        : { key, day: item.day, area: item.area, project: item.project, sessions: item.sessions, summary: null, error: "teto da rodada", capped: true };
      counts.pending += 1;
    } else {
      calls += 1;
      lastCallDay = item.day;
      const started = Date.now();
      const { summary, error, limit } = await summarizeProject({
        area: item.area,
        project: item.project,
        day: item.day,
        previousState,
        knownPlaces: previous ? previous.summary.ondeEstaCadaCoisa : [],
        openTasks,
        digestText: item.text
      }, { runner: run });
      entry = { key, day: item.day, area: item.area, project: item.project, sessions: item.sessions, summary, error, limit };
      if (summary) {
        writeJson(cacheFile, entry);
        counts.summarized += 1;
      } else {
        counts.failed += 1;
      }
      log(`${label}: ${summary ? "resumido" : `falhou (${error})`} em ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (limit) {
        limitHit = true;
        log("Limite de uso do Claude atingido: o resto fica pendente para a próxima rodada.");
      }
    }
    putEntry(history, entry);
    processed.push(entry);
  }

  // Agenda antes do vault: as tarefas sugeridas nesta rodada já ganham nota agora.
  let tasks = { added: 0, closed: 0 };
  let agendaData = null;
  if (agenda) {
    // Relê o arquivo: o app pode ter gravado nele enquanto a IA resumia.
    const current = agendaStore.loadAgenda(agendaFile);
    if (renderOnly) {
      agendaData = current;
    } else {
      const result = agendaStore.applySummaries(current, processed, { now: new Date().toISOString() });
      tasks = result;
      agendaData = result.data;
      if (dryRun) agendaStore.saveAgenda(agendaPreviewFile, result.data);
      else agendaStore.saveAgenda(agendaFile, result.data, { backupFile: path.join(dataDir, "agenda-backup", `${today}.json`) });
    }
  }

  const looseFile = path.join(dataDir, "avulsas.json");
  const known = readJson(looseFile) || [];
  const loose = mergeLoose(known, digests);
  if (!dryRun && JSON.stringify(loose) !== JSON.stringify(known)) writeJson(looseFile, loose);

  const target = dryRun ? previewDir : vaultDir;
  const backupDir = dryRun ? null : path.join(vaultDir, ".sync-backup", today);
  const written = writeVault({ target, backupDir, history, agendaData, loose, today, offsetHours });

  if (!dryRun) vault.pruneBackups(path.join(vaultDir, ".sync-backup"), today);

  const daysWhere = test => Array.from(new Set(processed.filter(test).map(e => e.day))).sort();
  return {
    ...counts,
    limitHit,
    capHit,
    tasksAdded: tasks.added,
    tasksClosed: tasks.closed,
    projectDays: items.length,
    taskNotes: written.taskNotes,
    projects: written.projects,
    failedDays: daysWhere(e => !e.summary && !e.limit && !e.capped),
    pendingDays: daysWhere(e => !e.summary && (e.limit || e.capped)),
    target
  };
}

function parseArgs(argv) {
  const args = { digest: false, vault: false, dryRun: false, renderOnly: false, agendaFile: DEFAULT_AGENDA_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--digest") args.digest = true;
    else if (arg === "--vault") args.vault = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--so-vault") args.renderOnly = true;
    else if (arg === "--desde") args.since = argv[++i];
    else if (arg === "--ate") args.until = argv[++i];
    else if (arg === "--saida") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--vault-dir") args.vaultDir = path.resolve(argv[++i]);
    else if (arg === "--agenda-file") args.agendaFile = path.resolve(argv[++i]);
    else if (arg === "--sem-agenda") args.agendaFile = null;
    else if (arg === "--modelo") args.model = argv[++i];
    else if (arg === "--max-chars") args.maxChars = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return args;
}

const USAGE = [
  "Uso:",
  "  node sync/run.js --digest --desde AAAA-MM-DD [--ate AAAA-MM-DD] [--saida pasta]",
  "  node sync/run.js --vault --desde AAAA-MM-DD [--ate AAAA-MM-DD] [--dry-run] [--vault-dir pasta] [--agenda-file arquivo | --sem-agenda] [--modelo haiku]",
  "  node sync/run.js --vault --so-vault [--dry-run] [--vault-dir pasta]   (regrava o vault com os resumos já feitos e a agenda, sem ler sessões nem chamar a IA)"
].join("\n");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.digest === args.vault) {
    console.error(USAGE);
    process.exit(1);
  }
  const today = localDay(new Date().toISOString());
  const since = args.since || localDay(new Date(Date.now() - 30 * DAY_MS).toISOString());
  const until = args.until || today;
  const started = Date.now();
  const seconds = () => ((Date.now() - started) / 1000).toFixed(1);

  if (args.digest) {
    const summary = await runDigest({ since, until, outDir: args.outDir, maxChars: args.maxChars });
    console.log(`${summary.files} arquivos lidos, ${summary.digests} trechos de sessão, ${summary.projects} projetos, ${summary.looseSessions} sessões avulsas, ${summary.badLines} linhas inválidas (${seconds()}s).`);
    console.log(`Prévia em ${summary.outDir}`);
    return;
  }

  const result = await runVault({ since, until, dryRun: args.dryRun, renderOnly: args.renderOnly, vaultDir: args.vaultDir, agendaFile: args.agendaFile, model: args.model, maxChars: args.maxChars, today, log: line => console.log(line) });
  console.log(`${result.projectDays} dias de projeto: ${result.summarized} resumidos, ${result.cached} do cache, ${result.failed} falharam, ${result.pending} pendentes; ${result.projects} projetos e ${result.taskNotes} notas de tarefa no vault (${seconds()}s).`);
  if (args.agendaFile) console.log(`Agenda${args.dryRun ? " (prévia)" : ""}: ${result.tasksAdded} tarefas sugeridas, ${result.tasksClosed} fechadas.`);
  if (result.limitHit) console.log("Limite de uso do Claude atingido. Rode de novo depois que ele renovar: o que já foi resumido está no cache.");
  console.log(`${args.dryRun ? "Prévia do vault" : "Vault"} em ${result.target}`);
  if (result.failed || result.pending) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { runDigest, runVault, parseArgs, DEFAULT_DATA_DIR, DEFAULT_AGENDA_FILE };
