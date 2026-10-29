#!/usr/bin/env node
// Rodada diária (chamada pela tarefa agendada): processa os dias que faltam desde a
// última rodada completa até ontem, com trava contra execução dupla e log por dia.
const fs = require("fs");
const path = require("path");
const { runVault, DEFAULT_DATA_DIR, DEFAULT_AGENDA_FILE } = require("./run");
const { localDay } = require("./digest");

const DEFAULT_LOGS_DIR = path.join(__dirname, "logs");
const DEFAULT_MAX_SUMMARIES = 20;
const MAX_ATTEMPTS = 3;
// Uma rodada viva há mais que isso está travada: a tarefa agendada já a teria matado.
const STALE_LOCK_MS = 6 * 3600e3;

function addDays(day, amount) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400e3).toISOString().slice(0, 10);
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
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

// Hoje fica de fora: o dia ainda não acabou e entra inteiro na rodada de amanhã.
function pendingRange(state, today, { since } = {}) {
  const until = addDays(today, -1);
  const start = since || (state.ultimoDiaCompleto ? addDays(state.ultimoDiaCompleto, 1) : until);
  return start > until ? null : { since: start, until };
}

// Avança até o dia anterior ao primeiro pendente ou com falha. Falha segura o dia por
// até MAX_ATTEMPTS rodadas seguidas; depois a rodada desiste dele para não travar tudo.
function nextState(state, { until, failedDays, pendingDays, maxAttempts = MAX_ATTEMPTS }) {
  const attempts = failedDays.length ? (state.tentativas || 0) + 1 : 0;
  const givesUp = attempts >= maxAttempts;
  const blocking = [...pendingDays, ...(givesUp ? [] : failedDays)].sort()[0];
  const done = blocking ? addDays(blocking, -1) : until;
  const previous = state.ultimoDiaCompleto || "";
  return {
    ...state,
    ultimoDiaCompleto: done > previous ? done : state.ultimoDiaCompleto,
    tentativas: givesUp ? 0 : attempts,
    desistiu: givesUp ? failedDays : []
  };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// Devolve a função que solta a trava, ou null se outra rodada viva está com ela.
function acquireLock(file, { pid = process.pid, now = Date.now(), isAlive = pidAlive, staleMs = STALE_LOCK_MS } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const mine = { pid, inicio: new Date(now).toISOString() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: "wx" });
      return () => {
        const held = readJson(file);
        if (held && held.pid === mine.pid && held.inicio === mine.inicio) fs.rmSync(file, { force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const held = readJson(file);
      const stale = !held || !isAlive(held.pid) || now - Date.parse(held.inicio) > staleMs;
      if (!stale) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

function createLog(logsDir, today, echo) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `${today}.log`);
  return line => {
    fs.appendFileSync(file, `[${new Date().toTimeString().slice(0, 8)}] ${line}\n`);
    if (echo) console.log(line);
  };
}

async function runDaily({
  dataDir = DEFAULT_DATA_DIR,
  logsDir = DEFAULT_LOGS_DIR,
  today = localDay(new Date().toISOString()),
  since,
  maxSummaries = DEFAULT_MAX_SUMMARIES,
  dryRun = false,
  runVault: run = runVault,
  vaultOptions = {},
  echo = false
} = {}) {
  const log = createLog(logsDir, today, echo);
  const stateFile = path.join(dataDir, "rodada.json");
  const release = acquireLock(path.join(dataDir, "rodada.lock"));
  if (!release) {
    log("Outra rodada em andamento: esta sai sem fazer nada.");
    return { status: "ocupada" };
  }
  try {
    const state = readJson(stateFile) || {};
    const range = pendingRange(state, today, { since });
    if (!range) {
      log(`Em dia: tudo até ${state.ultimoDiaCompleto} já foi processado.`);
      return { status: "em-dia", state };
    }

    log(`Rodada${dryRun ? " (prévia)" : ""} de ${range.since} a ${range.until}, teto de ${maxSummaries} resumos.`);
    const started = Date.now();
    const result = await run({ ...vaultOptions, dataDir, since: range.since, until: range.until, maxSummaries, dryRun, today, log });
    log(`${result.projectDays} dias de projeto: ${result.summarized} resumidos, ${result.cached} do cache, ${result.failed} falharam, ${result.pending} pendentes; ${result.tasksAdded} tarefas sugeridas, ${result.tasksUpdated || 0} atualizadas, ${result.tasksClosed} fechadas (${((Date.now() - started) / 1000).toFixed(1)}s).`);

    const next = nextState(state, { until: range.until, failedDays: result.failedDays, pendingDays: result.pendingDays });
    if (next.desistiu.length) log(`Desisti de ${next.desistiu.join(", ")} depois de ${MAX_ATTEMPTS} rodadas com falha; veja as sessões desses dias.`);
    const complete = !result.failedDays.length && !result.pendingDays.length;
    if (!complete) log(`Incompleta: processado até ${next.ultimoDiaCompleto || "(nada)"}; o resto entra na próxima rodada.`);
    if (!dryRun) {
      writeJson(stateFile, {
        ...next,
        ultimaRodada: { em: new Date().toISOString(), de: range.since, ate: range.until, resumidos: result.summarized, falharam: result.failed, pendentes: result.pending }
      });
    }
    return { status: complete ? "ok" : "incompleta", range, result, state: next };
  } catch (error) {
    log(`Erro: ${error.stack || error.message}`);
    throw error;
  } finally {
    release();
  }
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--desde") args.since = argv[++i];
    else if (arg === "--teto") args.maxSummaries = Number(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${arg}\nUso: node sync/daily.js [--desde AAAA-MM-DD] [--teto 20] [--dry-run]`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = await runDaily({ ...args, vaultOptions: { agendaFile: DEFAULT_AGENDA_FILE }, echo: true });
  if (out.status === "incompleta") process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { pendingRange, nextState, acquireLock, runDaily };
