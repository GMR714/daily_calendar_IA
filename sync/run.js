#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig } = require("./projects");
const { listSessionFiles, readRecords } = require("./sessions");
const { createDigestBuilder, renderDigest, localDay } = require("./digest");

const DEFAULT_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const DEFAULT_OUT_DIR = path.join(__dirname, "..", "sync-preview");
const DAY_MS = 86400e3;

function safeName(text) {
  return String(text).replace(/[<>:"/\\|?*]/g, "-").trim();
}

function listWithMore(items, max) {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; +${items.length - max}` : shown;
}

function cell(text) {
  return String(text).replace(/\|/g, "/").replace(/\n/g, " ");
}

function groupProjects(digests) {
  const projects = new Map();
  for (const digest of digests.filter(d => !d.loose)) {
    const key = `${digest.area}|${digest.project}`;
    if (!projects.has(key)) projects.set(key, { area: digest.area, project: digest.project, sessions: new Map(), days: new Set(), cwds: new Set(), digests: [] });
    const project = projects.get(key);
    project.sessions.set(digest.sessionId, digest.title || "(sem título)");
    project.days.add(digest.day);
    digest.cwds.forEach(cwd => project.cwds.add(cwd));
    project.digests.push(digest);
  }
  return Array.from(projects.values());
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
  // Margem de um dia: o arquivo pode ter sido tocado pela última vez no fim do dia anterior em UTC.
  const sinceMs = since ? Date.parse(`${since}T00:00:00Z`) - DAY_MS : 0;
  const files = listSessionFiles(projectsDir, { sinceMs, ignoreDirs: config.ignoreProjectDirs || [] });
  const builder = createDigestBuilder({ config, offsetHours, since, until });
  let badLines = 0;
  for (const file of files) badLines += await readRecords(file.path, builder.add);
  const digests = builder.finish();
  const projects = groupProjects(digests);

  fs.rmSync(path.join(outDir, "digest"), { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "projetos.md"), renderProjectsIndex(projects, { since, until }));
  fs.writeFileSync(path.join(outDir, "avulsas.md"), renderLoose(digests));

  for (const project of projects) {
    const byDay = new Map();
    for (const digest of project.digests) byDay.set(digest.day, [...(byDay.get(digest.day) || []), digest]);
    for (const [day, sameDay] of byDay) {
      const dir = path.join(outDir, "digest", day);
      fs.mkdirSync(dir, { recursive: true });
      const perSession = Math.floor(maxChars / sameDay.length);
      const text = sameDay.map(d => renderDigest(d, { maxChars: perSession })).join("\n\n---\n\n");
      fs.writeFileSync(path.join(dir, `${safeName(project.area)} - ${safeName(project.project)}.md`), text);
    }
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

function parseArgs(argv) {
  const args = { digest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--digest") args.digest = true;
    else if (arg === "--desde") args.since = argv[++i];
    else if (arg === "--ate") args.until = argv[++i];
    else if (arg === "--saida") args.outDir = path.resolve(argv[++i]);
    else if (arg === "--max-chars") args.maxChars = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.digest) {
    console.error("Nesta versão só existe a prévia: node sync/run.js --digest --desde AAAA-MM-DD [--ate AAAA-MM-DD] [--saida pasta]");
    process.exit(1);
  }
  const today = localDay(new Date().toISOString());
  const since = args.since || localDay(new Date(Date.now() - 30 * DAY_MS).toISOString());
  const started = Date.now();
  const summary = await runDigest({ since, until: args.until || today, outDir: args.outDir, maxChars: args.maxChars });
  console.log(`${summary.files} arquivos lidos, ${summary.digests} trechos de sessão, ${summary.projects} projetos, ${summary.looseSessions} sessões avulsas, ${summary.badLines} linhas inválidas (${((Date.now() - started) / 1000).toFixed(1)}s).`);
  console.log(`Prévia em ${summary.outDir}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { runDigest, parseArgs };
