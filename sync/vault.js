const fs = require("fs");
const path = require("path");

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const INDEX_PATH = "Projetos.md";
const TASKS_BASE_PATH = "Projetos/Tarefas.base";
const MINE = "## Minhas notas";
const RECENT_SESSIONS = 15;
const RECENT_DONE = 10;
const LOOSE_DAYS = 30;
const MAX_TASK_NAME = 80;

function safeName(text) {
  return String(text).replace(/[<>:"/\\|?*#^[\]]/g, "-").trim();
}

// Texto que aparece depois do "|" de um link: "|", "[" e "]" quebrariam o link.
function alias(text) {
  return String(text).replace(/[|[\]]/g, "-");
}

function projectLinkTarget(area, project) {
  return `Projetos/${safeName(area)}/${safeName(project)}`;
}

function projectNotePath(area, project) {
  return `${projectLinkTarget(area, project)}.md`;
}

function shortDay(day) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function fullDay(day) {
  return `${shortDay(day)}/${day.slice(0, 4)}`;
}

function dayWithWeekday(day) {
  return `${shortDay(day)} (${WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]})`;
}

function monthTitle(day) {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} de ${day.slice(0, 4)}`;
}

function addDays(day, amount) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400e3).toISOString().slice(0, 10);
}

function firstSentence(text) {
  return String(text || "").split(/(?<=[.!?])\s/)[0].trim();
}

function blockRange(text, name) {
  const open = `<!-- auto:${name} -->`;
  const close = `<!-- /auto:${name} -->`;
  const start = text.indexOf(open);
  const end = start === -1 ? -1 : text.indexOf(close, start);
  return start !== -1 && end !== -1 ? { start, end: end + close.length } : null;
}

// Só o que está entre <!-- auto:X --> e <!-- /auto:X --> é da rodada; o resto é do Gabriel.
// Bloco que a nota ainda não tem entra antes do próximo bloco da lista (ou do anchor), para
// a ordem do modelo valer também em nota antiga; sem nenhum dos dois, vai para o fim.
function upsertBlocks(text, blocks, { initial = "", anchor = null } = {}) {
  let out = text == null ? initial : text;
  const names = Object.keys(blocks);
  names.forEach((name, index) => {
    const block = `<!-- auto:${name} -->\n${blocks[name]}\n<!-- /auto:${name} -->`;
    const range = blockRange(out, name);
    if (range) {
      out = out.slice(0, range.start) + block + out.slice(range.end);
      return;
    }
    const next = names.slice(index + 1).map(other => blockRange(out, other)).find(Boolean);
    const at = next ? next.start : anchor ? out.indexOf(anchor) : -1;
    if (at === -1) out = `${out.replace(/\s*$/, "")}\n\n${block}\n`;
    else out = `${out.slice(0, at)}${block}\n\n${out.slice(at)}`;
  });
  return out;
}

// Tira da nota os blocos que saíram do modelo (ex.: "recente", que ligava para o Diário/).
function removeBlocks(text, names) {
  let out = text;
  for (const name of names) {
    const range = blockRange(out, name);
    if (!range) continue;
    const head = out.slice(0, range.start).replace(/\s*$/, "");
    const tail = out.slice(range.end).replace(/^\s*/, "");
    out = tail ? `${head}\n\n${tail}` : `${head}\n`;
  }
  return out;
}

function yamlValue(value) {
  const text = String(value);
  return /[:#[\]{}&*!|>'"%@`]/.test(text) ? JSON.stringify(text) : text;
}

function setFrontmatter(text, fields) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const lines = match ? match[1].split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(fields)) {
    const line = value === "" ? `${key}:` : `${key}: ${yamlValue(value)}`;
    const index = lines.findIndex(existing => existing.startsWith(`${key}:`));
    if (index === -1) lines.push(line);
    else lines[index] = line;
  }
  const body = match ? text.slice(match[0].length) : text;
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function allowedPath(rel) {
  const clean = path.posix.normalize(String(rel).normalize("NFC").replace(/\\/g, "/"));
  if (clean.startsWith("/") || clean.split("/").includes("..")) return null;
  if (clean === INDEX_PATH || clean.startsWith("Projetos/")) return clean;
  return null;
}

// Escreve só nas áreas da rodada, guarda a versão anterior (uma por dia de rodada)
// e troca o arquivo de uma vez para o Obsidian nunca ver nota pela metade.
function safeWrite(vaultDir, rel, content, { backupDir } = {}) {
  const clean = allowedPath(rel);
  if (!clean) throw new Error(`Escrita recusada fora das áreas da rodada: ${rel}`);
  const target = path.join(vaultDir, ...clean.split("/"));
  const exists = fs.existsSync(target);
  if (exists) {
    const current = fs.readFileSync(target, "utf8");
    if (current === content) return "igual";
    if (backupDir) {
      const backup = path.join(backupDir, ...clean.split("/"));
      if (!fs.existsSync(backup)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.writeFileSync(backup, current);
      }
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.sync-tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  return exists ? "atualizado" : "criado";
}

function readNote(vaultDir, rel) {
  const file = path.join(vaultDir, ...rel.split("/"));
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function pruneBackups(root, today, keepDays = 14) {
  if (!fs.existsSync(root)) return;
  const limit = Date.parse(`${today}T00:00:00Z`) - keepDays * 86400e3;
  for (const name of fs.readdirSync(root)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(name) && Date.parse(`${name}T00:00:00Z`) < limit) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
}

// Nome do arquivo da tarefa: o título, sem o que o Windows e o Obsidian recusam, cortado
// numa palavra para o caminho inteiro (com backup) caber no limite do Windows. O "#" de PR
// some ("olimpo#2048" vira "olimpo2048"), como nas notas do copiloto.
function taskFileName(title) {
  let name = safeName(String(title).replace(/#/g, "")).replace(/\s+/g, " ");
  if (name.length > MAX_TASK_NAME) {
    const cut = name.slice(0, MAX_TASK_NAME + 1);
    const space = cut.lastIndexOf(" ");
    name = space > MAX_TASK_NAME / 2 ? cut.slice(0, space) : name.slice(0, MAX_TASK_NAME);
  }
  return name.replace(/[\s.]+$/, "") || "Tarefa";
}

// A nota da tarefa é achada pelo id: título mudado no app não cria outra nota. Tarefa nova
// com nome já usado na pasta ganha o fim do id; a mais antiga fica com o nome limpo.
function assignTaskPaths(tasks, existing = new Map()) {
  const paths = new Map();
  const taken = new Set(Array.from(existing.values(), rel => rel.toLowerCase()));
  const ordered = tasks.slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id));
  for (const task of ordered) {
    if (existing.has(task.id)) {
      paths.set(task.id, existing.get(task.id));
      continue;
    }
    const dir = `${projectLinkTarget(task.area, task.project)}/Tarefas`;
    const name = taskFileName(task.title);
    let rel = `${dir}/${name}.md`;
    if (taken.has(rel.toLowerCase())) rel = `${dir}/${name} (${task.id.slice(-6)}).md`;
    taken.add(rel.toLowerCase());
    paths.set(task.id, rel);
  }
  return paths;
}

// Notas de tarefa que já existem no vault, pelo id do cabeçalho.
function findTaskNotes(vaultDir) {
  const found = new Map();
  const walk = rel => {
    const dir = path.join(vaultDir, ...rel.split("/"));
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = `${rel}/${item.name}`;
      if (item.isDirectory()) walk(child);
      else if (item.name.endsWith(".md") && rel.endsWith("/Tarefas")) {
        const head = fs.readFileSync(path.join(dir, item.name), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const id = head && head[1].match(/^id:\s*"?([^"\r\n]+)"?\s*$/m);
        if (id) found.set(id[1], child.normalize("NFC"));
      }
    }
  };
  walk("Projetos");
  return found;
}

function taskLink(task) {
  return `[[${task.note}|${alias(task.title)}]]`;
}

function projectTemplate(area, project) {
  return [
    "---",
    "tipo: projeto",
    "---",
    `# ${project}`,
    "",
    "> Nota mantida pela rodada diária do app de agenda. Só os trechos entre marcadores `auto` são reescritos; escreva à vontade fora deles.",
    "",
    ...(area === "Seazone" ? ["Ver também: [[Seazone]]", ""] : []),
    ...["estado", "onde", "tarefas", "historico", "sessoes"].flatMap(name => [`<!-- auto:${name} -->`, `<!-- /auto:${name} -->`, ""]),
    MINE,
    ""
  ].join("\n");
}

function taskTemplate(task) {
  return [
    "---",
    "tipo: tarefa",
    "---",
    `# ${task.title}`,
    "",
    "> Nota mantida pela rodada diária do app de agenda: confirme, descarte ou marque feita no app. Só os trechos entre marcadores `auto` são reescritos; escreva à vontade fora deles.",
    "",
    "<!-- auto:tarefa -->",
    "<!-- /auto:tarefa -->",
    "",
    MINE,
    ""
  ].join("\n");
}

function indexTemplate() {
  return [
    "# Projetos",
    "",
    "Índice mantido pela rodada diária do app de agenda. Cada projeto tem sua nota em `Projetos/<Área>/`, com estado, tarefas e histórico; cada tarefa tem a sua em `Projetos/<Área>/<Projeto>/Tarefas/`. Visões de todas as tarefas: [[Projetos/Tarefas.base|Tarefas]].",
    "",
    "<!-- auto:indice -->",
    "<!-- /auto:indice -->",
    "",
    "<!-- auto:avulsas -->",
    "<!-- /auto:avulsas -->",
    ""
  ].join("\n");
}

function taskLog(task) {
  const lines = [];
  if (task.createdDay) lines.push(`- ${fullDay(task.createdDay)} — sugerida pela rodada, a partir das sessões do dia`);
  if (task.status === "confirmada" && task.changedDay) lines.push(`- ${fullDay(task.changedDay)} — confirmada no app`);
  if (task.status === "feita" && task.doneDay) {
    lines.push(`- ${fullDay(task.doneDay)} — ${task.doneAuto ? `concluída pela rodada${task.evidence ? `: ${task.evidence}` : ""}` : "marcada como feita no app"}`);
  }
  if (task.status === "descartada" && task.changedDay) lines.push(`- ${fullDay(task.changedDay)} — descartada no app`);
  return lines;
}

function taskNoteText(current, task) {
  const project = `[[${projectLinkTarget(task.area, task.project)}|${alias(task.project)}]]`;
  const head = [`**Projeto:** ${project}`, `**Status:** ${task.status}`];
  if (task.deadline) head.push(`**Prazo:** ${fullDay(task.deadline)}`);
  const block = [head.join(" · "), "", "## Contexto", task.context || "(sem contexto)", "", "## Registro", ...taskLog(task)].join("\n");
  return setFrontmatter(upsertBlocks(current, { tarefa: block }, { initial: taskTemplate(task), anchor: MINE }), {
    tipo: "tarefa",
    id: task.id,
    titulo: task.title,
    status: task.status,
    area: task.area,
    projeto: project,
    criada: task.createdDay || "",
    concluida: task.status === "feita" ? task.doneDay || "" : "",
    prazo: task.deadline || ""
  });
}

function renderTasks(tasks) {
  const newestFirst = (a, b) => String(b.createdDay || "").localeCompare(String(a.createdDay || ""));
  const open = [...tasks.filter(t => t.status === "confirmada").sort(newestFirst), ...tasks.filter(t => t.status === "sugerida").sort(newestFirst)];
  const done = tasks.filter(t => t.status === "feita").sort((a, b) => String(b.doneDay || "").localeCompare(String(a.doneDay || "")));
  const lines = ["## Tarefas", `### Abertas (${open.length})`];
  lines.push(...(open.length
    ? open.map(t => `- ${taskLink(t)} — ${t.status === "confirmada" ? "confirmada" : t.createdDay ? `sugerida em ${shortDay(t.createdDay)}` : "sugerida"}`)
    : ["- (nenhuma)"]));
  if (done.length) {
    lines.push("", `### Concluídas (${done.length})`, ...done.slice(0, RECENT_DONE).map(t => `- ${taskLink(t)} — ${t.doneDay ? shortDay(t.doneDay) : "feita"}`));
    if (done.length > RECENT_DONE) lines.push(`- … e mais ${done.length - RECENT_DONE} em [[${TASKS_BASE_PATH}|Tarefas]]`);
  }
  return lines.join("\n");
}

function dayLines(entry) {
  if (!entry) return [];
  if (entry.summary) {
    return [
      ...(entry.summary.feitoNoDia || []).map(item => `  - ${item}`),
      ...(entry.summary.mudancas || []).map(m => `  - Mudou: ${m.antes} → ${m.depois}`)
    ];
  }
  if (entry.limit) return ["  - _resumo pendente: limite de uso do Claude atingido; entra na próxima rodada._"];
  if (entry.capped) return ["  - _resumo pendente: teto de resumos da rodada atingido; entra na próxima rodada._"];
  return [`  - _resumo indisponível (${entry.error || "erro"}); veja as sessões do dia._`];
}

// O que antes ia para o Diário/: cada dia é um item dobrável, os meses são seções.
function renderHistory(history, tasks) {
  const byDay = new Map(history.map(entry => [entry.day, entry]));
  const doneByDay = new Map();
  for (const t of tasks.filter(t => t.status === "feita" && t.doneDay)) doneByDay.set(t.doneDay, [...(doneByDay.get(t.doneDay) || []), t]);
  const days = Array.from(new Set([...byDay.keys(), ...doneByDay.keys()])).sort().reverse();
  if (!days.length) return "## Histórico\n- (sem registro)";
  const lines = ["## Histórico"];
  let month = null;
  for (const day of days) {
    if (day.slice(0, 7) !== month) {
      if (month) lines.push("");
      month = day.slice(0, 7);
      lines.push(`### ${monthTitle(day)}`);
    }
    lines.push(`- **${dayWithWeekday(day)}**`, ...dayLines(byDay.get(day)), ...(doneByDay.get(day) || []).map(t => `  - Concluiu ${taskLink(t)}`));
  }
  return lines.join("\n");
}

// tasks ausente (rodada sem agenda) deixa o bloco de tarefas de fora, para não apagar a lista.
function renderProjectBlocks({ summary, history, sessions, lastDay, summaryDay = lastDay, pendingDays = [], tasks }) {
  const places = summary.ondeEstaCadaCoisa || [];
  const recentSessions = sessions
    .slice()
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, RECENT_SESSIONS);
  const warning = pendingDays.length
    ? `\n\n> [!warning] Ainda sem resumo: ${pendingDays.map(shortDay).join(", ")} (entram na próxima rodada). O estado acima pode estar desatualizado.`
    : "";
  return {
    estado: `## Estado atual\n${summary.estadoAtual}\n\n_Atualizado com o registro de ${shortDay(summaryDay)}._${warning}`,
    onde: `## Onde está cada coisa\n${places.length ? places.map(p => `- **${p.item}**: \`${p.local}\``).join("\n") : "- (nada registrado ainda)"}`,
    ...(tasks ? { tarefas: renderTasks(tasks) } : {}),
    historico: renderHistory(history, tasks || []),
    sessoes: `## Sessões\n${recentSessions.map(s => `- ${s.day} — ${s.title || "(sem título)"} \`${String(s.sessionId).slice(0, 8)}\``).join("\n")}`
  };
}

function renderIndex(rows) {
  const areas = Array.from(new Set(rows.map(r => r.area))).sort();
  return areas.map(area => {
    const lines = [`## ${area}`, "", "| Projeto | Último dia | Abertas | Estado |", "|---|---|---|---|"];
    rows
      .filter(r => r.area === area)
      .sort((a, b) => b.lastDay.localeCompare(a.lastDay))
      .forEach(r => {
        const stale = r.summaryDay && r.summaryDay < r.lastDay ? `⚠ resumo de ${shortDay(r.summaryDay)}: ` : "";
        lines.push(`| [[${projectLinkTarget(r.area, r.project)}\\|${r.project}]] | ${r.lastDay} | ${r.open == null ? "—" : r.open} | ${stale}${firstSentence(r.state).replace(/\|/g, "/")} |`);
      });
    return lines.join("\n");
  }).join("\n\n");
}

function renderLoose(sessions, today, days = LOOSE_DAYS) {
  const limit = addDays(today, -days);
  const recent = sessions.filter(s => s.day >= limit).sort((a, b) => b.day.localeCompare(a.day));
  return [
    "## Sessões avulsas",
    `Sessões em pastas fora de projeto, últimos ${days} dias.`,
    "",
    ...(recent.length ? recent.map(s => `- ${shortDay(s.day)} — ${s.title || "(sem título)"}`) : ["- (nenhuma)"])
  ].join("\n");
}

function baseView(name, { filters = null, order, sort }) {
  return [
    "  - type: table",
    `    name: ${name}`,
    ...(filters ? ["    filters:", `      ${filters.length > 1 ? "or" : "and"}:`, ...filters.map(f => `        - ${f}`)] : []),
    "    order:",
    ...order.map(column => `      - ${column}`),
    "    sort:",
    ...sort.flatMap(([property, direction]) => [`      - property: ${property}`, `        direction: ${direction}`])
  ];
}

// Criada uma vez; depois as visões são do Gabriel.
function tasksBase() {
  return [
    "filters:",
    "  and:",
    '    - file.inFolder("Projetos")',
    '    - tipo == "tarefa"',
    "views:",
    ...baseView("Abertas", { filters: ['status == "confirmada"', 'status == "sugerida"'], order: ["file.name", "status", "area", "projeto", "criada", "prazo"], sort: [["status", "ASC"], ["criada", "DESC"]] }),
    ...baseView("Sugeridas", { filters: ['status == "sugerida"'], order: ["file.name", "area", "projeto", "criada"], sort: [["criada", "DESC"]] }),
    ...baseView("Concluídas", { filters: ['status == "feita"'], order: ["file.name", "area", "projeto", "concluida"], sort: [["concluida", "DESC"]] }),
    ...baseView("Todas", { order: ["file.name", "status", "area", "projeto", "criada", "concluida"], sort: [["criada", "DESC"]] }),
    ""
  ].join("\n");
}

module.exports = {
  INDEX_PATH,
  TASKS_BASE_PATH,
  MINE,
  safeName,
  projectNotePath,
  upsertBlocks,
  removeBlocks,
  setFrontmatter,
  safeWrite,
  readNote,
  pruneBackups,
  taskFileName,
  assignTaskPaths,
  findTaskNotes,
  taskNoteText,
  tasksBase,
  projectTemplate,
  indexTemplate,
  renderProjectBlocks,
  renderIndex,
  renderLoose
};
