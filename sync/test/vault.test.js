const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { upsertBlocks, setFrontmatter, safeWrite, pruneBackups, renderProjectBlocks, renderDiary, renderIndex, projectNotePath } = require("../vault");

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

test("atualiza o cabeçalho sem perder campos que você criou", () => {
  const before = "---\ntipo: projeto\nminha-tag: x\nultima-atividade: 2026-10-01\n---\n# P\n";
  const after = setFrontmatter(before, { "ultima-atividade": "2026-10-20", area: "Pessoais" });
  assert.match(after, /minha-tag: x/);
  assert.match(after, /ultima-atividade: 2026-10-20/);
  assert.match(after, /area: Pessoais/);
  assert.ok(!after.includes("2026-10-01"));
  assert.match(setFrontmatter("# Sem cabeçalho\n", { tipo: "projeto" }), /^---\ntipo: projeto\n---\n# Sem cabeçalho/);
});

test("só escreve em Projetos/, Diário/ e Projetos.md", () => {
  const vault = tempVault();
  const backupDir = path.join(vault, ".sync-backup", "2026-10-21");
  for (const rel of ["Seazone.md", "Seazone/Glossário Seazone.md", "../fora.md", "Projetos/../Seazone.md", ".obsidian/app.json"]) {
    assert.throws(() => safeWrite(vault, rel, "x", { backupDir }), /fora das áreas/, rel);
  }
  safeWrite(vault, "Projetos/Pessoais/PokeSurvivors.md", "a", { backupDir });
  safeWrite(vault, "Diário/2026-10-20.md", "b", { backupDir });
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

test("blocos do projeto: estado inteiro, locais e últimos dias em ordem", () => {
  const history = [
    { day: "2026-10-18", summary: { feitoNoDia: ["Fez A"] } },
    { day: "2026-10-20", summary: { feitoNoDia: ["Fez B.", "Fez C."] } }
  ];
  const blocks = renderProjectBlocks({
    summary: { estadoAtual: "Estado de hoje.", ondeEstaCadaCoisa: [{ item: "Repositório", local: "C:\\Dev\\PokeSurvivors" }] },
    history,
    sessions: [{ day: "2026-10-20", title: "Menu de pausa", sessionId: "0a21d8ca-ed6d" }],
    lastDay: "2026-10-20"
  });
  assert.match(blocks.estado, /Estado de hoje\./);
  assert.match(blocks.onde, /\*\*Repositório\*\*: `C:\\Dev\\PokeSurvivors`/);
  assert.ok(blocks.recente.indexOf("2026-10-20") < blocks.recente.indexOf("2026-10-18"));
  assert.match(blocks.recente, /\[\[Diário\/2026-10-20\|20\/10\]\]: Fez B; Fez C/);
  assert.match(blocks.sessoes, /Menu de pausa/);
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

test("diário marca resumo pendente por limite de uso", () => {
  const text = renderDiary("2026-10-20", [{ area: "Seazone", project: "olimpo", summary: null, limit: true, error: "You've hit your session limit" }], []);
  assert.match(text, /resumo pendente: limite de uso do Claude/);
  assert.doesNotMatch(text, /You've hit/);
});

test("diário traz feito, mudanças, próximos passos e avulsas", () => {
  const text = renderDiary("2026-10-20", [
    { area: "Pessoais", project: "PokeSurvivors", summary: { feitoNoDia: ["Criou o menu"], mudancas: [{ antes: "Pausa com P", depois: "Pausa com Esc" }], tarefasNovas: [{ titulo: "Testar no celular" }] } },
    { area: "Seazone", project: "olimpo", summary: null, error: "timeout" }
  ], [{ title: "Uso de memória do PC" }]);
  assert.match(text, /## Pessoais \/ \[\[Projetos\/Pessoais\/PokeSurvivors\|PokeSurvivors\]\]/);
  assert.match(text, /Criou o menu/);
  assert.match(text, /Pausa com P → Pausa com Esc/);
  assert.match(text, /Testar no celular/);
  assert.match(text, /resumo indisponível/);
  assert.match(text, /Uso de memória do PC/);
});

test("índice lista projetos por área com o estado em uma linha", () => {
  const text = renderIndex([
    { area: "Pessoais", project: "PokeSurvivors", lastDay: "2026-10-20", state: "Menu pronto. Falta celular." },
    { area: "Seazone", project: "olimpo", lastDay: "2026-10-21", state: "Registro no Postgres." }
  ]);
  // Dentro de tabela o "|" do apelido do link precisa de escape, senão quebra a coluna no Obsidian.
  assert.match(text, /\| \[\[Projetos\/Pessoais\/PokeSurvivors\\\|PokeSurvivors\]\] \| 2026-10-20 \| Menu pronto\. \|/);
  assert.ok(text.indexOf("## Pessoais") < text.indexOf("## Seazone"));
  const pending = renderIndex([{ area: "Seazone", project: "olimpo", lastDay: "2026-10-21", state: "Velho.", summaryDay: "2026-10-15" }]);
  assert.match(pending, /⚠ resumo de 15\/10: Velho\./);
});

test("caminho da nota usa área e projeto sem caracteres proibidos", () => {
  assert.equal(projectNotePath("Pessoais", "Video: editor?"), "Projetos/Pessoais/Video- editor-.md");
});
