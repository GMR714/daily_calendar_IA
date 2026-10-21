const { spawn, spawnSync } = require("node:child_process");
const { agendaSchema, guardProposal } = require("./ollama");

const CLI_MODEL = process.env.CLAUDE_CLI_MODEL || "sonnet";
const CLI_EFFORT = process.env.CLAUDE_CLI_EFFORT || "high";
const CLI_TIMEOUT_MS = Math.min(180000, Math.max(15000, Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 120000)));
let activeRuns = 0;

function isClaudeCliInstalled() {
  const result = spawnSync("claude", ["--version"], { windowsHide: true, timeout: 3000, stdio: "ignore", shell: false });
  return !result.error && result.status === 0;
}

function buildCliPrompt(payload) {
  return [
    "Voce e o motor de planejamento adaptativo de uma agenda pessoal em portugues do Brasil.",
    "Produza somente uma proposta conservadora em JSON valido, de acordo com o schema fornecido. A proposta sera revisada pelo usuario antes de qualquer alteracao.",
    "goal e resultado de longo prazo; task e proxima acao concreta; routine e comportamento recorrente; event e compromisso fixo.",
    "Para objetivo complexo, crie no maximo uma meta nova, de 3 a 6 marcos e etapas concretas. Cada etapa de meta precisa de verbo de acao, duracao total honesta, 2 a 5 instrucoes praticas e criterio observavel de conclusao.",
    "duration e o esforco TOTAL em minutos. O planejador dividira trabalho longo; nao comprima relatorio ou estudo dificil em 15 minutos.",
    "Preserve cada data e horario informado. Prova, consulta ou reuniao e event na data indicada; estudo, preparacao ou producao sao tasks separadas antes dela. Prazo futuro vai em deadline, nao em date.",
    "Horarios explicitamente pedidos sao fixos. Nao crie sobreposicoes e nao mova compromissos confirmados. Para rotina, date e null e preferredDays usa segunda=0 ate domingo=6.",
    "Altere item existente somente com updates e o entryId exato do contexto. Nunca duplique ou exclua para simular edicao. delete so quando o usuario pedir explicitamente apagar, excluir ou remover.",
    "Para relatos, proponha concluir, reagendar, pausar ou ajustar duracao. Em rotina, complete afeta apenas a ocorrencia relatada. Nunca apague meta por causa de um dia ruim.",
    "Se faltar dado essencial, use null e faca pergunta curta no summary. Nao invente IDs, datas, horarios, especializacoes ou capacidade disponivel.",
    "Limite a proposta a 12 novas etapas, 8 atualizacoes e 1 relato. Prioridade: 3 alta, 2 media, 1 baixa.",
    "<context>" + JSON.stringify(payload.context || {}) + "</context>",
    "<modo>" + (payload.mode || "auto") + "</modo>",
    "<intencao>" + (payload.intent || "message") + "</intencao>",
    "<meta_selecionada>" + (payload.planningGoalId || "nenhuma") + "</meta_selecionada>",
    "<mensagem>" + String(payload.message || "") + "</mensagem>"
  ].join("\n");
}

function cliArguments(payload, { model = CLI_MODEL, effort = CLI_EFFORT } = {}) {
  const policy = JSON.stringify({ permissions: { allow: ["StructuredOutput"], deny: ["Bash", "PowerShell", "Read", "Edit", "Write", "Glob", "Grep", "WebFetch", "WebSearch", "Task"] } });
  return [
    "-p", "Crie a proposta estruturada para a agenda.",
    "--output-format", "stream-json",
    "--verbose",
    "--json-schema", JSON.stringify(agendaSchema()),
    "--system-prompt", buildCliPrompt(payload),
    "--permission-mode", "dontAsk",
    "--permission-prompts", "none",
    "--settings", policy,
    "--restricted",
    "--tools", "StructuredOutput",
    "--allowedTools", "StructuredOutput",
    "--strict-mcp-config",
    "--safe-mode",
    "--no-session-persistence",
    "--model", model,
    "--effort", effort
  ];
}

function resultFromStream(output) {
  let final;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") final = event;
    } catch {}
  }
  if (!final) throw new Error("Claude Code nao retornou o evento final.");
  if (final.is_error) throw new Error(String(final.result || final.subtype || "Claude Code encerrou com erro."));
  const proposal = final.structured_output || (typeof final.result === "string" ? JSON.parse(final.result) : final.result);
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) throw new Error("Claude Code nao retornou JSON de proposta.");
  return proposal;
}

function createClaudeCliInterpreter({ spawnImpl = spawn, model = CLI_MODEL, effort = CLI_EFFORT, timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return function interpretWithClaudeCli(payload) {
    if (activeRuns >= 2) return Promise.resolve({ mode: "local", provider: "claude", message: "Claude Code esta processando outras duas mensagens. Aguarde um instante." });
    activeRuns += 1;
    return new Promise(resolve => {
      let output = "";
      let errors = "";
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        activeRuns -= 1;
        resolve(result);
      };
      let child;
      try {
        child = spawnImpl("claude", cliArguments(payload, { model, effort }), { cwd: __dirname, detached: true, shell: false, windowsHide: true });
      } catch (error) {
        return finish({ mode: "local", provider: "claude", message: "Nao consegui iniciar Claude Code. " + error.message });
      }
      const timer = setTimeout(() => {
        child.kill();
        finish({ mode: "local", provider: "claude", message: "Claude Code excedeu o limite de " + Math.round(timeoutMs / 1000) + " segundos." });
      }, timeoutMs);
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 1024 * 1024) child.kill(); });
      child.stderr.on("data", chunk => { errors += chunk; });
      child.on("error", error => {
        clearTimeout(timer);
        finish({ mode: "local", provider: "claude", message: "Nao consegui iniciar Claude Code. " + error.message });
      });
      child.on("close", code => {
        clearTimeout(timer);
        try {
          const proposal = resultFromStream(output);
          finish({ mode: "ai", provider: "claude", model, ...guardProposal(proposal, payload) });
        } catch (error) {
          const detail = String(errors || error.message).replace(/\s+/g, " ").slice(0, 360);
          finish({ mode: "local", provider: "claude", message: "Claude Code nao gerou uma proposta valida" + (code ? " (codigo " + code + ")" : "") + ": " + detail });
        }
      });
    });
  };
}

module.exports = { CLI_MODEL, buildCliPrompt, cliArguments, createClaudeCliInterpreter, interpret: createClaudeCliInterpreter(), isClaudeCliInstalled, resultFromStream };
