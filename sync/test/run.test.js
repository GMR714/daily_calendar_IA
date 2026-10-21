const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runDigest, runVault } = require("../run");

const config = {
  rules: [
    { prefix: "C:\\Dev", area: "Pessoais", projectFromSubfolder: true },
    { prefix: "C:\\Dev\\Dev Seazone", area: "Seazone", projectFromSubfolder: true, rootProject: "Geral" }
  ],
  aliases: {}
};

const SECRET = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

function jsonl(records) {
  return records.map(r => JSON.stringify(r)).join("\n") + "\n";
}

function makeProjectsDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-run-"));
  const projects = path.join(root, "projects");
  const poke = path.join(projects, "C--Dev-PokeSurvivors");
  const scratch = path.join(projects, "C--Users-gabri-AppData-scratch");
  fs.mkdirSync(path.join(poke, "s1", "subagents"), { recursive: true });
  fs.mkdirSync(scratch, { recursive: true });
  fs.writeFileSync(path.join(poke, "s1.jsonl"), jsonl([
    { type: "custom-title", customTitle: "Menu de pausa", sessionId: "s1" },
    { type: "user", sessionId: "s1", timestamp: "2026-10-20T13:00:00.000Z", cwd: "C:\\Dev\\PokeSurvivors\\.claude\\worktrees\\x", message: { content: `Cria o menu de pausa, token ${SECRET}` } },
    { type: "assistant", sessionId: "s1", timestamp: "2026-10-20T13:05:00.000Z", cwd: "C:\\Dev\\PokeSurvivors\\.claude\\worktrees\\x", message: { content: [{ type: "text", text: "Menu criado." }] } }
  ]));
  fs.writeFileSync(path.join(poke, "s1", "subagents", "agent-1.jsonl"), jsonl([
    { type: "user", sessionId: "s1", timestamp: "2026-10-20T13:02:00.000Z", cwd: "C:\\Dev\\PokeSurvivors", message: { content: "CONTEUDO DE SUBAGENTE" } }
  ]));
  fs.writeFileSync(path.join(scratch, "s2.jsonl"), jsonl([
    { type: "custom-title", customTitle: "Uso de memória do PC", sessionId: "s2" },
    { type: "user", sessionId: "s2", timestamp: "2026-10-20T20:00:00.000Z", cwd: "C:\\Users\\gabri\\AppData\\scratch", message: { content: "Quais apps usam mais memória?" } }
  ]));
  fs.writeFileSync(path.join(scratch, "quebrado.jsonl"), "{nao é json\n");
  return { root, projects };
}

test("gera a prévia de projetos, avulsas e digests sem vazar segredo nem subagente", async () => {
  const { root, projects } = makeProjectsDir();
  const outDir = path.join(root, "preview");
  const summary = await runDigest({ projectsDir: projects, outDir, config, since: "2026-09-01", until: "2026-10-21", offsetHours: -3 });

  assert.equal(summary.projects, 1);
  assert.equal(summary.looseSessions, 1);

  const projetos = fs.readFileSync(path.join(outDir, "projetos.md"), "utf8");
  assert.match(projetos, /## Pessoais/);
  assert.match(projetos, /PokeSurvivors/);
  assert.match(projetos, /Menu de pausa/);

  const avulsas = fs.readFileSync(path.join(outDir, "avulsas.md"), "utf8");
  assert.match(avulsas, /Uso de memória do PC/);

  const digestFile = path.join(outDir, "digest", "2026-10-20", "Pessoais - PokeSurvivors.md");
  const digest = fs.readFileSync(digestFile, "utf8");
  assert.match(digest, /Cria o menu de pausa/);
  assert.match(digest, /Menu criado\./);

  const everything = [projetos, avulsas, digest].join("\n");
  assert.ok(!everything.includes(SECRET));
  assert.ok(!everything.includes("CONTEUDO DE SUBAGENTE"));
});

function fakeSummary(day) {
  return {
    estadoAtual: `Menu de pausa pronto em ${day}. Falta testar no celular.`,
    ondeEstaCadaCoisa: [{ item: "Repositório", local: "C:\\Dev\\PokeSurvivors" }],
    feitoNoDia: ["Criou o menu de pausa"],
    mudancas: [{ antes: "Pausa com P", depois: "Pausa com Esc" }],
    tarefasNovas: [{ titulo: "Testar o menu no celular", contexto: "Abre com Esc.", prazo: null }],
    tarefasConcluidas: []
  };
}

test("rodada do vault: escreve projeto, diário e índice, preserva o resto e usa o cache", async () => {
  const { root, projects } = makeProjectsDir();
  const vaultDir = path.join(root, "vault");
  const dataDir = path.join(root, "data");
  const note = path.join(vaultDir, "Projetos", "Pessoais", "PokeSurvivors.md");
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, "# PokeSurvivors\nminha anotação\n<!-- auto:estado -->\nestado velho\n<!-- /auto:estado -->\n");
  fs.writeFileSync(path.join(vaultDir, "Seazone.md"), "hub intocável");

  const prompts = [];
  const runner = async prompt => { prompts.push(prompt); return fakeSummary("2026-10-20"); };
  const options = { projectsDir: projects, vaultDir, dataDir, config, since: "2026-09-01", until: "2026-10-21", offsetHours: -3, runner, today: "2026-10-21" };
  const first = await runVault(options);

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Cria o menu de pausa/);
  assert.ok(!prompts[0].includes(SECRET));
  assert.equal(first.summarized, 1);

  const text = fs.readFileSync(note, "utf8");
  assert.match(text, /minha anotação/);
  assert.ok(!text.includes("estado velho"));
  assert.match(text, /Menu de pausa pronto em 2026-10-20/);
  assert.match(text, /ultima-atividade: 2026-10-20/);
  assert.equal(fs.readFileSync(path.join(vaultDir, "Seazone.md"), "utf8"), "hub intocável");
  assert.equal(fs.readFileSync(path.join(vaultDir, ".sync-backup", "2026-10-21", "Projetos", "Pessoais", "PokeSurvivors.md"), "utf8").includes("estado velho"), true);

  const diary = fs.readFileSync(path.join(vaultDir, "Diário", "2026-10-20.md"), "utf8");
  assert.match(diary, /Criou o menu de pausa/);
  assert.match(diary, /Uso de memória do PC/);
  assert.match(fs.readFileSync(path.join(vaultDir, "Projetos.md"), "utf8"), /PokeSurvivors/);

  const second = await runVault(options);
  assert.equal(prompts.length, 1, "não chama a IA de novo para o mesmo registro");
  assert.equal(second.cached, 1);
});

test("dry-run não toca no vault", async () => {
  const { root, projects } = makeProjectsDir();
  const vaultDir = path.join(root, "vault");
  const previewDir = path.join(root, "preview-vault");
  fs.mkdirSync(vaultDir);
  await runVault({ projectsDir: projects, vaultDir, previewDir, dataDir: path.join(root, "data"), config, since: "2026-09-01", until: "2026-10-21", runner: async () => fakeSummary("x"), dryRun: true, today: "2026-10-21" });
  assert.deepEqual(fs.readdirSync(vaultDir), []);
  assert.ok(fs.existsSync(path.join(previewDir, "Projetos", "Pessoais", "PokeSurvivors.md")));
});

test("ao bater no limite de uso, para de chamar a IA e deixa o resto pendente", async () => {
  const { root, projects } = makeProjectsDir();
  fs.writeFileSync(path.join(projects, "C--Dev-PokeSurvivors", "s3.jsonl"), jsonl([
    { type: "user", sessionId: "s3", timestamp: "2026-10-21T13:00:00.000Z", cwd: "C:\\Dev\\PokeSurvivors", message: { content: "Agora o placar" } }
  ]));
  let calls = 0;
  const runner = async () => { calls += 1; throw new Error("claude: You've hit your session limit · resets 4pm"); };
  const result = await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), dataDir: path.join(root, "data"), config, since: "2026-09-01", until: "2026-10-21", runner, today: "2026-10-21" });
  assert.equal(calls, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.limitHit, true);
  assert.match(fs.readFileSync(path.join(root, "vault", "Diário", "2026-10-21.md"), "utf8"), /resumo pendente: limite de uso do Claude/);
});

test("rodada leva tarefas abertas à IA, fecha a feita e sugere a nova na agenda", async () => {
  const { root, projects } = makeProjectsDir();
  const agendaFile = path.join(root, "agenda-data.json");
  const manual = { id: "manual-1", type: "routine", text: "Academia", duration: 60, priority: 2 };
  const open = { id: "sync-aberta", type: "task", source: "sync", status: "confirmada", text: "Criar o menu de pausa", projectId: "pessoais/pokesurvivors", fingerprint: "pessoais/pokesurvivors::criar-o-menu-de-pausa", updatedAt: "2026-10-19T06:00:00.000Z" };
  fs.writeFileSync(agendaFile, JSON.stringify({ entries: [manual, open], reports: [] }));

  const prompts = [];
  const runner = async prompt => {
    prompts.push(prompt);
    return { ...fakeSummary("2026-10-20"), tarefasConcluidas: [{ id: "sync-aberta", evidencia: "Menu criado." }] };
  };
  const result = await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), dataDir: path.join(root, "data"), agendaFile, config, since: "2026-09-01", until: "2026-10-21", runner, today: "2026-10-21" });

  assert.match(prompts[0], /\[sync-aberta\] Criar o menu de pausa/);
  assert.equal(result.tasksAdded, 1);
  assert.equal(result.tasksClosed, 1);
  const agenda = JSON.parse(fs.readFileSync(agendaFile, "utf8"));
  assert.deepEqual(agenda.entries.find(e => e.id === "manual-1"), manual);
  assert.equal(agenda.entries.find(e => e.id === "sync-aberta").status, "feita");
  assert.equal(agenda.entries.find(e => e.status === "sugerida").text, "Testar o menu no celular");
  assert.equal(agenda.projects[0].id, "pessoais/pokesurvivors");
});

test("dry-run grava a agenda só na prévia", async () => {
  const { root, projects } = makeProjectsDir();
  const agendaFile = path.join(root, "agenda-data.json");
  const agendaPreviewFile = path.join(root, "preview", "agenda-data.json");
  const original = JSON.stringify({ entries: [{ id: "manual-1", text: "Academia" }], reports: [] });
  fs.writeFileSync(agendaFile, original);
  await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), previewDir: path.join(root, "preview", "vault"), dataDir: path.join(root, "data"), agendaFile, agendaPreviewFile, config, since: "2026-09-01", until: "2026-10-21", runner: async () => fakeSummary("x"), dryRun: true, today: "2026-10-21" });
  assert.equal(fs.readFileSync(agendaFile, "utf8"), original);
  const preview = JSON.parse(fs.readFileSync(agendaPreviewFile, "utf8"));
  assert.equal(preview.entries.length, 2);
});

function addPokeDay(projects, sessionId, iso, text) {
  fs.writeFileSync(path.join(projects, "C--Dev-PokeSurvivors", `${sessionId}.jsonl`), jsonl([
    { type: "user", sessionId, timestamp: iso, cwd: "C:\\Dev\\PokeSurvivors", message: { content: text } }
  ]));
}

test("teto da rodada: termina o dia em curso, não começa outro e deixa o resto pendente", async () => {
  const { root, projects } = makeProjectsDir();
  addPokeDay(projects, "s3", "2026-10-21T13:00:00.000Z", "Agora o placar");
  let calls = 0;
  const runner = async () => { calls += 1; return fakeSummary("x"); };
  const result = await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), dataDir: path.join(root, "data"), config, since: "2026-09-01", until: "2026-10-21", runner, today: "2026-10-22", maxSummaries: 1 });
  assert.equal(calls, 1);
  assert.equal(result.summarized, 1);
  assert.equal(result.pending, 1);
  assert.equal(result.limitHit, false);
  assert.deepEqual(result.pendingDays, ["2026-10-21"]);
  assert.deepEqual(result.failedDays, []);
  assert.match(fs.readFileSync(path.join(root, "vault", "Diário", "2026-10-21.md"), "utf8"), /resumo pendente: teto de resumos da rodada/);
});

test("rodada separa dias que falharam dos que ficaram pendentes", async () => {
  const { root, projects } = makeProjectsDir();
  addPokeDay(projects, "s3", "2026-10-21T13:00:00.000Z", "Agora o placar");
  let calls = 0;
  const runner = async () => {
    calls += 1;
    if (calls <= 2) return { estadoAtual: "sem o resto" };
    throw new Error("claude: You've hit your session limit · resets 4pm");
  };
  const result = await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), dataDir: path.join(root, "data"), config, since: "2026-09-01", until: "2026-10-21", runner, today: "2026-10-22" });
  assert.deepEqual(result.failedDays, ["2026-10-20"]);
  assert.deepEqual(result.pendingDays, ["2026-10-21"]);
});

test("o que o app grava na agenda durante a rodada não se perde", async () => {
  const { root, projects } = makeProjectsDir();
  const agendaFile = path.join(root, "agenda-data.json");
  fs.writeFileSync(agendaFile, JSON.stringify({ entries: [], reports: [] }));
  const fromApp = { id: "manual-durante", type: "task", text: "Criada no app no meio da rodada", updatedAt: "2026-10-21T06:01:00.000Z" };
  const runner = async () => {
    fs.writeFileSync(agendaFile, JSON.stringify({ entries: [fromApp], reports: [] }));
    return fakeSummary("2026-10-20");
  };
  await runVault({ projectsDir: projects, vaultDir: path.join(root, "vault"), dataDir: path.join(root, "data"), agendaFile, config, since: "2026-09-01", until: "2026-10-21", runner, today: "2026-10-21" });
  const agenda = JSON.parse(fs.readFileSync(agendaFile, "utf8"));
  assert.deepEqual(agenda.entries.find(e => e.id === "manual-durante"), fromApp);
  assert.ok(agenda.entries.some(e => e.status === "sugerida"));
});
