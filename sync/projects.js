const fs = require("fs");
const path = require("path");

const DEFAULT_CONFIG_FILE = path.join(__dirname, "projects.config.json");
const LOOSE = { area: null, project: null, loose: true };
const IGNORED = { area: null, project: null, loose: false, ignored: true };

function loadConfig(file = DEFAULT_CONFIG_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// "/c/Dev/x" (Git Bash) e "C:\Dev\x\.claude\worktrees\abc\src" viram "C:\Dev\x".
function normalizeCwd(cwd) {
  if (!cwd) return "";
  let out = String(cwd).trim();
  const bash = out.match(/^\/([a-zA-Z])(\/.*)?$/);
  if (bash) out = `${bash[1].toUpperCase()}:${bash[2] || "\\"}`;
  out = out.replace(/\//g, "\\").replace(/\\+$/, "");
  const worktree = out.search(/\\\.claude\\worktrees\\/i);
  if (worktree !== -1) out = out.slice(0, worktree);
  return out;
}

function isUnder(lowerDir, prefix) {
  const lowerPrefix = prefix.toLowerCase();
  return lowerDir === lowerPrefix || lowerDir.startsWith(`${lowerPrefix}\\`);
}

// Apelido exato primeiro; "nome-*" junta worktrees manuais ("olimpo-feat-x") no projeto.
function resolveAlias(project, aliases = {}) {
  if (aliases[project]) return aliases[project];
  const wildcard = Object.keys(aliases)
    .filter(key => key.endsWith("*") && project.startsWith(key.slice(0, -1)))
    .sort((a, b) => b.length - a.length)[0];
  return wildcard ? aliases[wildcard] : project;
}

function classify(cwd, config) {
  const dir = normalizeCwd(cwd);
  if (!dir) return LOOSE;
  const lower = dir.toLowerCase();
  if ((config.ignoreCwdPrefixes || []).some(prefix => isUnder(lower, prefix))) return IGNORED;
  const rule = (config.rules || [])
    .filter(r => isUnder(lower, r.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return LOOSE;

  let project = rule.project;
  if (!project && rule.projectFromSubfolder) {
    const rest = dir.slice(rule.prefix.length).replace(/^\\/, "");
    project = rest ? rest.split("\\")[0] : rule.rootProject;
  }
  if (!project) return LOOSE;
  return { area: rule.area, project: resolveAlias(project, config.aliases), loose: false };
}

module.exports = { loadConfig, normalizeCwd, classify };
