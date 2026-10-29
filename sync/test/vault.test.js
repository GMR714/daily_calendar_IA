const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { upsertBlocks, removeBlocks, setFrontmatter, safeWrite, pruneBackups, renderProjectBlocks, renderIndex, renderLoose, projectNotePath, taskFileName, assignTaskPaths, taskNoteText, tasksBase } = require("../vault");

function tempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sync-vault-"));
}

test("cria a nota a partir do modelo quando ela não existe", () => {
  const text = upsertBlocks(null, { estado: "novo estado" }, { initial: "# Projeto\n\n<!-- auto:estado -->\n<!-- /auto:estado -->\n\n## Notas\n" });
  assert.match(text, /<!-- auto:estado -->\nnovo estado\n<!-- \/auto:estado -->/);
  assert.match(text, /## Notas/);
});

test("reescreve só dentro dos marcadores e mantém o texto manual", () => {
  const before = "# P\nminha anotação\n<!-- auto:estado -->\nestado velho e errado\n<!-- /auto:estado -->\nmais anotação minha\n";
  const after = upsertBlocks(before, { estado: "estado novo" });
  assert.ok(!after.includes("estado velho e errado"));
  assert.match(after, /minha anotação/);
  assert.match(after, /mais anotação minha/);
  assert.match(after, /estado novo/);
});

test("bloco que ainda não existe na nota entra no fim", () => {
  const after = upsertBlocks("# P\ntexto\n", { onde: "- pasta" });
  assert.match(after, /texto\n[\s\S]*<!-- auto:onde -->\n- pasta\n<!-- \/auto:onde -->\n$/);
});

test("bloco novo entra antes do próximo bloco da ordem ou de Minhas notas, não no fim", () => {
  const before = "# P\n<!-- auto:estado -->\nE\n<!-- /auto:estado -->\n\n<!-- auto:sessoes -->\nS\n<!-- /auto:sessoes -->\n\n## Minhas notas\nanotação\n";
  const after = upsertBlocks(before, { estado: "E2", tarefas: "T", sessoes: "S2" }, { anchor: "## Minhas notas" });
  assert.ok(after.indexOf("auto:estado") < after.indexOf("auto:tarefas"));
  assert.ok(after.indexOf("auto:tarefas") < after.indexOf("auto:sessoes"));
  const last = upsertBlocks("# P\n\n## Minhas notas\nanotação\n", { historico: "H" }, { anchor: "## Minhas notas" });
  assert.ok(last.indexOf("auto:historico") < last.indexOf("## Minhas notas"));
  assert.match(last, /## Minhas notas\nanotação\n$/);
});

test("remove o bloco que saiu do modelo e deixa o resto", () => {
  const before = "# P\n<!-- auto:estado -->\nE\n<!-- /auto:estado -->\n\n<!-- auto:recente -->\n- [[Diário/2026-10-20|20/10]]\n<!-- /auto:recente -->\n\n## Minhas notas\nx\n";
  const after = removeBlocks(before, ["recente", "inexistente"]);
  assert.ok(!after.includes("Diário"));
  assert.ok(!after.includes("auto:recente"));
  assert.match(after, /<!-- \/auto:estado -->\n\n## Minhas notas\nx\n$/);
});

test("atualiza o cabeçalho sem perder campos que você criou", () => {
  const before = "---\ntipo: projeto\nminha-tag: x\nultima-atividade: 2026-10-01\n---\n# P\n";
  const after = setFrontmatter(before, { "ultima-atividade": "2026-10-20", area: "Pessoais" });
  assert.match(after, /minha-tag: x/);
  assert.match(after, /ultima-atividade: 2026-10-20/);
  assert.match(after, /area: Pessoais/);
  assert.ok(!after.includes("2026-10-01"));
  assert.match(setFrontmatter("# Sem cabeçalho\n", { tipo: "projeto" }), /^---\ntipo: projeto\n---\n# Sem cabeçalho/);
});

test("só escreve em Projetos/ e Projetos.md", () => {
  const vault = tempVault();
  const backupDir = path.join(vault, ".sync-backup", "2026-10-21");
  for (const rel of ["Seazone.md", "Seazone/Glossário Seazone.md", "../fora.md", "Projetos/../Seazone.md", ".obsidian/app.json", "Diário/2026-10-20.md"]) {
    assert.throws(() => safeWrite(vault, rel, "x", { backupDir }), /fora das áreas/, rel);
  }
  safeWrite(vault, "Projetos/Pessoais/PokeSurvivors.md", "a", { backupDir });
  safeWrite(vault, "Projetos/Pessoais/PokeSurvivors/Tarefas/Testar.md", "b", { backupDir });
  safeWrite(vault, "Projetos.md", "c", { backupDir });
  assert.equal(fs.readFileSync(path.join(vault, "Projetos", "Pessoais", "PokeSurvivors.md"), "utf8"), "a");
});

test("guarda cópia antes de sobrescrever e não mexe no que não mudou", () => {
  const vault = tempVault();
  const backupDir = path.join(vault, ".sync-backup", "2026-10-21");
  const rel = "Projetos/Pessoais/PokeSurvivors.md";
  assert.equal(safeWrite(vault, rel, "versão 1", { backupDir }), "criado");
  assert.equal(fs.existsSync(path.join(backupDir, rel)), false);
  assert.equal(safeWrite(vault, rel, "versão 1", { backupDir }), "igual");
  assert.equal(safeWrite(vault, rel, "versão 2", { backupDir }), "atualizado");
  assert.equal(fs.readFileSync(path.join(backupDir, rel), "utf8"), "versão 1");
  assert.equal(fs.readFileSync(path.join(vault, rel), "utf8"), "versão 2");
});

test("apaga backups com mais de 14 dias", () => {
  const vault = tempVault();
  const root = path.join(vault, ".sync-backup");
  for (const day of ["2026-10-01", "2026-10-07", "2026-10-20"]) fs.mkdirSync(path.join(root, day), { recursive: true });
  pruneBackups(root, "2026-10-21", 14);
  assert.deepEqual(fs.readdirSync(root).sort(), ["2026-10-07", "2026-10-20"]);
});

const POKE = "Projetos/Pessoais/PokeSurvivors/Tarefas";

function task(overrides = {}) {
  return { id: "sync-a", title: "Testar no celular", status: "sugerida", area: "Pessoais", project: "PokeSurvivors", context: "Abre com Esc.", createdDay: "2026-10-20", changedDay: "2026-10-20", doneDay: null, doneAuto: false, evidence: null, deadline: null, ...overrides };
}

test("blocos do projeto: estado, locais e sessões, sem link para dia", () => {
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "Estado de hoje.", ondeEstaCadaCoisa: [{ item: "Repositório", local: "C:\\Dev\\PokeSurvivors" }] },
    history: [{ day: "2026-10-20", summary: { feitoNoDia: ["Fez B."], mudancas: [] } }],
    sessions: [{ day: "2026-10-20", title: "Menu de pausa", sessionId: "0a21d8ca-ed6d" }],
    lastDay: "2026-10-20",
    tasks: []
  });
  assert.match(blocks.estado, /Estado de hoje\./);
  assert.match(blocks.onde, /\*\*Repositório\*\*: `C:\\Dev\\PokeSurvivors`/);
  assert.match(blocks.sessoes, /Menu de pausa/);
  assert.deepEqual(Object.keys(blocks), ["estado", "onde", "tarefas", "historico", "sessoes"]);
  assert.ok(!Object.values(blocks).join("\n").includes("Diário"));
});

test("bloco de tarefas: abertas (confirmadas primeiro) e concluídas, com link para a nota", () => {
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "E.", ondeEstaCadaCoisa: [] },
    history: [],
    sessions: [],
    lastDay: "2026-10-22",
    tasks: [
      task({ id: "s1", title: "Sugerida velha", createdDay: "2026-10-18", note: `${POKE}/Sugerida velha` }),
      task({ id: "s2", title: "Sugerida nova", createdDay: "2026-10-21", note: `${POKE}/Sugerida nova` }),
      task({ id: "c1", title: "Confirmada", status: "confirmada", createdDay: "2026-10-10", note: `${POKE}/Confirmada` }),
      task({ id: "f1", title: "Feita", status: "feita", doneDay: "2026-10-22", note: `${POKE}/Feita` }),
      task({ id: "d1", title: "Descartada", status: "descartada", note: `${POKE}/Descartada` })
    ]
  });
  const text = blocks.tarefas;
  assert.match(text, /\[\[Projetos\/Pessoais\/PokeSurvivors\/Tarefas\/Confirmada\|Confirmada\]\] — confirmada/);
  assert.match(text, /\[\[Projetos\/Pessoais\/PokeSurvivors\/Tarefas\/Feita\|Feita\]\] — 22\/10/);
  assert.ok(text.indexOf("Confirmada") < text.indexOf("Sugerida nova"));
  assert.ok(text.indexOf("Sugerida nova") < text.indexOf("Sugerida velha"));
  assert.ok(text.indexOf("Sugerida velha") < text.indexOf("Feita"));
  assert.ok(!text.includes("Descartada"));
});

test("histórico por mês, do mais novo ao mais velho, com o que mudou e a tarefa concluída no dia", () => {
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "E.", ondeEstaCadaCoisa: [] },
    history: [
      { day: "2026-09-30", summary: { feitoNoDia: ["Fez A"], mudancas: [] } },
      { day: "2026-10-20", summary: { feitoNoDia: ["Fez B."], mudancas: [{ antes: "Pausa com P", depois: "Pausa com Esc" }] } },
      { day: "2026-10-21", summary: null, limit: true, error: "You've hit your session limit" }
    ],
    sessions: [],
    lastDay: "2026-10-21",
    tasks: [task({ status: "feita", doneDay: "2026-10-20", note: `${POKE}/Testar no celular` })]
  });
  const text = blocks.historico;
  assert.ok(text.indexOf("### Outubro de 2026") < text.indexOf("### Setembro de 2026"));
  assert.ok(text.indexOf("**21/10 (qua)**") < text.indexOf("**20/10 (ter)**"));
  assert.match(text, /- \*\*20\/10 \(ter\)\*\*\n  - Fez B\.\n  - Mudou: Pausa com P → Pausa com Esc\n  - Concluiu \[\[Projetos\/Pessoais\/PokeSurvivors\/Tarefas\/Testar no celular\|Testar no celular\]\]/);
  assert.match(text, /\*\*21\/10 \(qua\)\*\*\n  - _resumo pendente: limite de uso do Claude/);
  assert.doesNotMatch(text, /You've hit/);
  assert.match(text, /\*\*30\/09 \(qua\)\*\*\n  - Fez A/);
});

test("histórico marca o teto da rodada e o resumo que falhou", () => {
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "E.", ondeEstaCadaCoisa: [] },
    history: [
      { day: "2026-10-20", summary: null, capped: true },
      { day: "2026-10-21", summary: null, error: "timeout" }
    ],
    sessions: [],
    lastDay: "2026-10-21"
  });
  assert.match(blocks.historico, /resumo pendente: teto de resumos da rodada atingido; entra na próxima rodada/);
  assert.match(blocks.historico, /resumo indisponível \(timeout\)/);
});

test("sem agenda, o bloco de tarefas fica de fora para não apagar a lista", () => {
  const blocks = renderProjectBlocks({ summary: { estadoAtual: "E.", ondeEstaCadaCoisa: [] }, history: [], sessions: [], lastDay: "2026-10-20" });
  assert.equal(blocks.tarefas, undefined);
});

test("nome da nota da tarefa: sem caractere proibido, até 80 caracteres, sem ponto no fim", () => {
  assert.equal(taskFileName('Mesclar gitops#3486: depois do "secret" na aba PRD.'), "Mesclar gitops3486- depois do -secret- na aba PRD");
  // "#" de PR some em vez de virar "-": "olimpo#2048" fica "olimpo2048", como nas notas do copiloto.
  assert.equal(taskFileName("Revisar os PRs (#19 a #32) e o olimpo#2048"), "Revisar os PRs (19 a 32) e o olimpo2048");
  const long = taskFileName("Revisar ".repeat(20));
  assert.ok(long.length <= 80);
  assert.ok(!long.endsWith(" "));
  assert.match(long, /Revisar$/);
});

test("caminho da tarefa: acha a nota pelo id e desempata título repetido", () => {
  const tasks = [
    task({ id: "sync-bbbbbb222222", title: "Testar", createdAt: "2026-10-21T00:00:00Z" }),
    task({ id: "sync-aaaaaa111111", title: "Testar", createdAt: "2026-10-20T00:00:00Z" }),
    task({ id: "sync-renomeada", title: "Título novo no app" }),
    task({ id: "sync-cccccc333333", title: "Placar" })
  ];
  const existing = new Map([
    ["sync-renomeada", `${POKE}/Título antigo.md`],
    ["sync-descartada-com-nota", `${POKE}/Placar.md`]
  ]);
  const paths = assignTaskPaths(tasks, existing);
  assert.equal(paths.get("sync-aaaaaa111111"), `${POKE}/Testar.md`);
  assert.equal(paths.get("sync-bbbbbb222222"), `${POKE}/Testar (222222).md`);
  assert.equal(paths.get("sync-renomeada"), `${POKE}/Título antigo.md`);
  assert.equal(paths.get("sync-cccccc333333"), `${POKE}/Placar (333333).md`);
});

test("nota da tarefa: propriedades, contexto e registro com datas", () => {
  const text = taskNoteText(null, task({ status: "feita", doneDay: "2026-10-21", doneAuto: true, evidence: "Menu testado no celular.", deadline: "2026-10-25" }));
  assert.match(text, /^---\ntipo: tarefa\n/);
  assert.match(text, /\nid: sync-a\n/);
  assert.match(text, /\nstatus: feita\n/);
  assert.match(text, /\narea: Pessoais\n/);
  assert.match(text, /\nprojeto: "\[\[Projetos\/Pessoais\/PokeSurvivors\|PokeSurvivors\]\]"\n/);
  assert.match(text, /\ncriada: 2026-10-20\n/);
  assert.match(text, /\nconcluida: 2026-10-21\n/);
  assert.match(text, /\nprazo: 2026-10-25\n/);
  assert.match(text, /# Testar no celular/);
  assert.match(text, /## Contexto\nAbre com Esc\./);
  assert.match(text, /- 20\/10\/2026 — sugerida pela rodada, a partir das sessões do dia\n- 21\/10\/2026 — concluída pela rodada: Menu testado no celular\./);
  assert.match(text, /## Minhas notas/);
});

test("nota da tarefa: o que você escreveu fica e o status acompanha o app", () => {
  const first = taskNoteText(null, task());
  const mine = first.replace("## Minhas notas\n", "## Minhas notas\nligar para o Fulano\n");
  const discarded = taskNoteText(mine, task({ status: "descartada", changedDay: "2026-10-23", title: "Outro título" }));
  assert.match(discarded, /ligar para o Fulano/);
  assert.match(discarded, /\nstatus: descartada\n/);
  assert.match(discarded, /- 23\/10\/2026 — descartada no app/);
  assert.match(discarded, /\ntitulo: Outro título\n/);
  const doneInApp = taskNoteText(null, task({ status: "feita", doneDay: "2026-10-22" }));
  assert.match(doneInApp, /- 22\/10\/2026 — marcada como feita no app/);
  const confirmed = taskNoteText(null, task({ status: "confirmada", changedDay: "2026-10-21" }));
  assert.match(confirmed, /- 21\/10\/2026 — confirmada no app/);
});

test("Base das tarefas filtra as notas de tarefa dos projetos", () => {
  const base = tasksBase();
  assert.match(base, /file\.inFolder\("Projetos"\)/);
  assert.match(base, /tipo == "tarefa"/);
  for (const view of ["Abertas", "Sugeridas", "Concluídas", "Todas"]) assert.match(base, new RegExp(`name: ${view}`));
});

test("estado avisa quando há dias mais novos ainda sem resumo", () => {
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "Estado de 18/10.", ondeEstaCadaCoisa: [] },
    summaryDay: "2026-10-18",
    pendingDays: ["2026-10-19", "2026-10-20"],
    history: [],
    sessions: [],
    lastDay: "2026-10-20"
  });
  assert.match(blocks.estado, /Atualizado com o registro de 18\/10/);
  assert.match(blocks.estado, /19\/10, 20\/10/);
  assert.match(blocks.estado, /pode estar desatualizado/);
});

test("índice lista projetos por área com tarefas abertas e o estado em uma linha", () => {
  const text = renderIndex([
    { area: "Pessoais", project: "PokeSurvivors", lastDay: "2026-10-20", state: "Menu pronto. Falta celular.", open: 3 },
    { area: "Seazone", project: "olimpo", lastDay: "2026-10-21", state: "Registro no Postgres." }
  ]);
  // Dentro de tabela o "|" do apelido do link precisa de escape, senão quebra a coluna no Obsidian.
  assert.match(text, /\| \[\[Projetos\/Pessoais\/PokeSurvivors\\\|PokeSurvivors\]\] \| 2026-10-20 \| 3 \| Menu pronto\. \|/);
  assert.match(text, /\| \[\[Projetos\/Seazone\/olimpo\\\|olimpo\]\] \| 2026-10-21 \| — \| Registro no Postgres\. \|/);
  assert.ok(text.indexOf("## Pessoais") < text.indexOf("## Seazone"));
  const pending = renderIndex([{ area: "Seazone", project: "olimpo", lastDay: "2026-10-21", state: "Velho.", summaryDay: "2026-10-15" }]);
  assert.match(pending, /⚠ resumo de 15\/10: Velho\./);
});

test("sessões avulsas dos últimos 30 dias, da mais nova para a mais velha", () => {
  const text = renderLoose([
    { day: "2026-09-01", title: "Velha demais" },
    { day: "2026-10-20", title: "Uso de memória do PC" },
    { day: "2026-10-28", title: null }
  ], "2026-10-29");
  assert.ok(text.indexOf("28/10 — (sem título)") < text.indexOf("20/10 — Uso de memória do PC"));
  assert.ok(!text.includes("Velha demais"));
  assert.match(renderLoose([], "2026-10-29"), /nenhuma/);
});

test("caminho da nota usa área e projeto sem caracteres proibidos", () => {
  assert.equal(projectNotePath("Pessoais", "Video: editor?"), "Projetos/Pessoais/Video- editor-.md");
});
