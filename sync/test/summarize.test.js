const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPrompt, claudeArgs, parseClaudeOutput, validateSummary, summarizeProject } = require("../summarize");

function goodSummary(overrides = {}) {
  return {
    estadoAtual: "Menu de pausa pronto; falta testar no celular.",
    ondeEstaCadaCoisa: [{ item: "Repositório", local: "C:\\Dev\\PokeSurvivors" }],
    feitoNoDia: ["Criou o menu de pausa"],
    mudancas: [],
    tarefasNovas: [{ titulo: "Testar o menu no celular", contexto: "O menu abre com Esc.", prazo: null }],
    tarefasConcluidas: [],
    ...overrides
  };
}

const input = {
  area: "Pessoais",
  project: "PokeSurvivors",
  day: "2026-10-20",
  previousState: "Jogo com movimentação básica.",
  knownPlaces: [{ item: "Repositório", local: "C:\\Dev\\PokeSurvivors" }],
  digestText: "**Você:** Cria o menu de pausa"
};

test("prompt traz projeto, dia, estado anterior e o registro", () => {
  const prompt = buildPrompt(input);
  for (const part of ["Pessoais / PokeSurvivors", "2026-10-20", "Jogo com movimentação básica.", "Cria o menu de pausa", "C:\\Dev\\PokeSurvivors"]) {
    assert.ok(prompt.includes(part), part);
  }
  assert.match(buildPrompt({ ...input, previousState: null, knownPlaces: [] }), /primeiro registro deste projeto/);
});

test("chamada do claude não tem ferramentas, plugins, MCP nem grava sessão", () => {
  const args = claudeArgs({ model: "haiku", schema: { type: "object" }, systemPrompt: "x" });
  const after = flag => args[args.indexOf(flag) + 1];
  assert.equal(args[0], "-p");
  assert.equal(after("--tools"), "");
  assert.equal(after("--setting-sources"), "local");
  assert.equal(after("--model"), "haiku");
  for (const flag of ["--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) assert.ok(args.includes(flag), flag);
  assert.deepEqual(JSON.parse(after("--json-schema")), { type: "object" });
});

test("lê a saída estruturada e recusa erro", () => {
  assert.deepEqual(parseClaudeOutput(JSON.stringify({ is_error: false, structured_output: { a: 1 } })), { a: 1 });
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: "limite atingido" })), /limite atingido/);
  assert.throws(() => parseClaudeOutput("não é json"));
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: false, result: "texto" })), /sem saída estruturada/);
});

test("validação aceita o resumo certo e aponta o que falta", () => {
  assert.equal(validateSummary(goodSummary()).ok, true);
  const bad = validateSummary({ ...goodSummary(), estadoAtual: "", feitoNoDia: "x" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => e.includes("estadoAtual")));
  assert.ok(bad.errors.some(e => e.includes("feitoNoDia")));
  assert.equal(validateSummary(null).ok, false);
});

test("tenta de novo uma vez quando a resposta vem inválida", async () => {
  const answers = [{ estadoAtual: "" }, goodSummary()];
  let calls = 0;
  const result = await summarizeProject(input, { runner: async () => answers[calls++] });
  assert.equal(calls, 2);
  assert.equal(result.summary.estadoAtual, "Menu de pausa pronto; falta testar no celular.");
});

test("desiste depois de duas falhas e devolve o motivo", async () => {
  let calls = 0;
  const result = await summarizeProject(input, { runner: async () => { calls += 1; throw new Error("timeout"); } });
  assert.equal(calls, 2);
  assert.equal(result.summary, null);
  assert.match(result.error, /timeout/);
});

test("limite de uso não gasta nova tentativa e é sinalizado", async () => {
  let calls = 0;
  const result = await summarizeProject(input, { runner: async () => { calls += 1; throw new Error("claude: You've hit your session limit · resets 4pm (America/Sao_Paulo)"); } });
  assert.equal(calls, 1);
  assert.equal(result.summary, null);
  assert.equal(result.limit, true);
});

test("corta listas longas demais", async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ titulo: `T${i}`, contexto: "c", prazo: null }));
  const result = await summarizeProject(input, { runner: async () => goodSummary({ tarefasNovas: many }) });
  assert.equal(result.summary.tarefasNovas.length, 6);
});
