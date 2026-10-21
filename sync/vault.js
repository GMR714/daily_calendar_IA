const fs = require("fs");
const path = require("path");

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const INDEX_PATH = "Projetos.md";
const RECENT_DAYS = 7;
const RECENT_SESSIONS = 15;

function safeName(text) {
  return String(text).replace(/[<>:"/\\|?*#^[\]]/g, "-").trim();
}

function projectLinkTarget(area, project) {
  return `Projetos/${safeName(area)}/${safeName(project)}`;
}

function projectNotePath(area, project) {
  return `${projectLinkTarget(area, project)}.md`;
}

function diaryPath(day) {
  return `Diário/${day}.md`;
}

function shortDay(day) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function longDay(day) {
  const weekday = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)} — ${weekday}`;
}

function firstSentence(text) {
  return String(text || "").split(/(?<=[.!?])\s/)[0].trim();
}

// Só o que está entre <!-- auto:X --> e <!-- /auto:X --> é da rodada; o resto é do Gabriel.
function upsertBlocks(text, blocks, { initial = "" } = {}) {
  let out = text == null ? initial : text;
  for (const [name, content] of Object.entries(blocks)) {
    const open = `<!-- auto:${name} -->`;
    const close = `<!-- /auto:${name} -->`;
    const block = `${open}\n${content}\n${close}`;
    const start = out.indexOf(open);
    const end = start === -1 ? -1 : out.indexOf(close, start);
    if (start !== -1 && end !== -1) out = out.slice(0, start) + block + out.slice(end + close.length);
    else out = `${out.replace(/\s*$/, "")}\n\n${block}\n`;
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
    const line = `${key}: ${yamlValue(value)}`;
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
  if (clean === INDEX_PATH || clean.startsWith("Projetos/") || clean.startsWith("Diário/")) return clean;
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
    "<!-- auto:estado -->",
    "<!-- /auto:estado -->",
    "",
    "<!-- auto:onde -->",
    "<!-- /auto:onde -->",
    "",
    "<!-- auto:recente -->",
    "<!-- /auto:recente -->",
    "",
    "<!-- auto:sessoes -->",
    "<!-- /auto:sessoes -->",
    "",
    "## Minhas notas",
    ""
  ].join("\n");
}

function diaryTemplate(day) {
  return `---\ntipo: diario\ndata: ${day}\n---\n# ${longDay(day)}\n\n<!-- auto:dia -->\n<!-- /auto:dia -->\n`;
}

function indexTemplate() {
  return "# Projetos\n\nÍndice mantido pela rodada diária do app de agenda. Cada projeto tem sua nota em `Projetos/`, e o que foi feito em cada dia está em `Diário/`.\n\n<!-- auto:indice -->\n<!-- /auto:indice -->\n";
}

function renderProjectBlocks({ summary, history, sessions, lastDay }) {
  const places = summary.ondeEstaCadaCoisa || [];
  const recent = history
    .filter(entry => entry.summary && entry.summary.feitoNoDia && entry.summary.feitoNoDia.length)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, RECENT_DAYS);
  const recentSessions = sessions
    .slice()
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, RECENT_SESSIONS);
  return {
    estado: `## Estado atual\n${summary.estadoAtual}\n\n_Atualizado com o registro de ${shortDay(lastDay)}._`,
    onde: `## Onde está cada coisa\n${places.length ? places.map(p => `- **${p.item}**: \`${p.local}\``).join("\n") : "- (nada registrado ainda)"}`,
    recente: `## Últimos dias\n${recent.map(entry => `- [[Diário/${entry.day}|${shortDay(entry.day)}]]: ${entry.summary.feitoNoDia.map(item => item.replace(/[.;]\s*$/, "")).join("; ")}`).join("\n") || "- (sem registro)"}`,
    sessoes: `## Sessões\n${recentSessions.map(s => `- ${s.day} — ${s.title || "(sem título)"} \`${String(s.sessionId).slice(0, 8)}\``).join("\n")}`
  };
}

function renderDiary(day, projects, loose = []) {
  const parts = [];
  const sorted = projects.slice().sort((a, b) => a.area.localeCompare(b.area) || a.project.localeCompare(b.project));
  for (const p of sorted) {
    const lines = [`## ${p.area} / [[${projectLinkTarget(p.area, p.project)}|${p.project}]]`];
    if (!p.summary) {
      lines.push(`_resumo indisponível (${p.error || "erro"}); veja as sessões do dia._`);
    } else {
      lines.push(...p.summary.feitoNoDia.map(item => `- ${item}`));
      if (p.summary.mudancas.length) lines.push("", "**Mudou:**", ...p.summary.mudancas.map(m => `- ${m.antes} → ${m.depois}`));
      if (p.summary.tarefasNovas.length) lines.push("", "**Próximos passos sugeridos:**", ...p.summary.tarefasNovas.map(t => `- ${t.titulo}`));
    }
    parts.push(lines.join("\n"));
  }
  if (loose.length) parts.push(["## Sessões avulsas", ...loose.map(s => `- ${s.title || "(sem título)"}`)].join("\n"));
  return parts.join("\n\n") || "_Nenhuma sessão registrada neste dia._";
}

function renderIndex(rows) {
  const areas = Array.from(new Set(rows.map(r => r.area))).sort();
  return areas.map(area => {
    const lines = [`## ${area}`, "", "| Projeto | Último dia | Estado |", "|---|---|---|"];
    rows
      .filter(r => r.area === area)
      .sort((a, b) => b.lastDay.localeCompare(a.lastDay))
      .forEach(r => lines.push(`| [[${projectLinkTarget(r.area, r.project)}\\|${r.project}]] | ${r.lastDay} | ${firstSentence(r.state).replace(/\|/g, "/")} |`));
    return lines.join("\n");
  }).join("\n\n");
}

module.exports = {
  INDEX_PATH,
  safeName,
  projectNotePath,
  diaryPath,
  upsertBlocks,
  setFrontmatter,
  safeWrite,
  readNote,
  pruneBackups,
  projectTemplate,
  diaryTemplate,
  indexTemplate,
  renderProjectBlocks,
  renderDiary,
  renderIndex
};
