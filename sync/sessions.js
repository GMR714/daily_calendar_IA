const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Só o .jsonl principal de cada sessão: as pastas <sessão>/subagents ficam de fora,
// o resultado do subagente já aparece na sessão que o chamou.
function listSessionFiles(projectsDir, { sinceMs = 0, ignoreDirs = [] } = {}) {
  if (!fs.existsSync(projectsDir)) return [];
  const ignored = new Set(ignoreDirs.map(name => name.toLowerCase()));
  const files = [];
  for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || ignored.has(dir.name.toLowerCase())) continue;
    const full = path.join(projectsDir, dir.name);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(full, entry.name);
      const stat = fs.statSync(file);
      if (stat.mtimeMs < sinceMs) continue;
      files.push({ path: file, size: stat.size, mtimeMs: stat.mtimeMs, projectDir: dir.name });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const WANTED = /"type":"(user|assistant|custom-title|agent-name)"/;

// Devolve quantas linhas não eram JSON válido (arquivo cortado no meio da escrita).
async function readRecords(file, onRecord) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let bad = 0;
  for await (const line of lines) {
    if (!line || !WANTED.test(line)) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    onRecord(record);
  }
  return bad;
}

module.exports = { listSessionFiles, readRecords };
