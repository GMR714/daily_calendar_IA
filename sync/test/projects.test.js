const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeCwd, classify } = require("../projects");

const config = {
  rules: [
    { prefix: "C:\\Dev", area: "Pessoais", projectFromSubfolder: true },
    { prefix: "C:\\Dev\\Dev Seazone", area: "Seazone", projectFromSubfolder: true, rootProject: "Geral" },
    { prefix: "C:\\Dev\\faculdade", area: "Faculdade", projectFromSubfolder: true },
    { prefix: "C:\\Dev\\TC", area: "Lifeshub", project: "The Connection" },
    { prefix: "C:\\Users\\gabri\\Documents\\New project", area: "Pessoais", project: "Agenda" }
  ],
  aliases: { "Video-editor-broll": "Video editor" }
};

test("normaliza caminho no estilo Git Bash para Windows", () => {
  assert.equal(normalizeCwd("/c/Dev/Dev Seazone/olimpo"), "C:\\Dev\\Dev Seazone\\olimpo");
});

test("remove o sufixo de worktree do Claude", () => {
  assert.equal(
    normalizeCwd("C:\\Dev\\Video editor\\.claude\\worktrees\\jolly-goldstine-db662d\\src"),
    "C:\\Dev\\Video editor"
  );
});

test("projeto vem da primeira subpasta da área", () => {
  assert.deepEqual(classify("/c/Dev/Dev Seazone/setup-com-prova", config), { area: "Seazone", project: "setup-com-prova", loose: false });
  assert.deepEqual(classify("C:\\Dev\\Video editor\\output\\estilos", config), { area: "Pessoais", project: "Video editor", loose: false });
});

test("a regra mais específica vence, independente da ordem", () => {
  assert.equal(classify("C:\\Dev\\Dev Seazone\\olimpo", config).area, "Seazone");
  assert.equal(classify("C:\\Dev\\TC\\the-connection", config).project, "The Connection");
});

test("raiz da área usa o projeto de raiz, se houver", () => {
  assert.deepEqual(classify("/c/Dev/Dev Seazone", config), { area: "Seazone", project: "Geral", loose: false });
  assert.equal(classify("C:\\Dev", config).loose, true);
});

test("worktree de projeto com nome fixo", () => {
  const cwd = "C:\\Users\\gabri\\Documents\\New project\\.claude\\worktrees\\obsidian-planning-integration-a01363";
  assert.deepEqual(classify(cwd, config), { area: "Pessoais", project: "Agenda", loose: false });
});

test("aplica apelidos de projeto", () => {
  assert.equal(classify("C:\\Dev\\Video-editor-broll", config).project, "Video editor");
});

test("prefixo não diferencia maiúsculas", () => {
  assert.deepEqual(classify("c:\\dev\\PokeSurvivors", config), { area: "Pessoais", project: "PokeSurvivors", loose: false });
});

test("apelido com * junta worktrees manuais no projeto de origem", () => {
  const withWorktrees = {
    rules: [...config.rules, { prefix: "C:\\Dev\\Dev Seazone\\wt", area: "Seazone", projectFromSubfolder: true }],
    aliases: { "olimpo-*": "olimpo", "setup-com-prova-*": "setup-com-prova" }
  };
  assert.equal(classify("/c/Dev/Dev Seazone/wt/olimpo-feat-setup-com-prova-no-lab/agents", withWorktrees).project, "olimpo");
  assert.equal(classify("C:\\Dev\\Dev Seazone\\wt\\setup-com-prova-docs-handover", withWorktrees).project, "setup-com-prova");
  assert.equal(classify("C:\\Dev\\Dev Seazone\\setup-com-prova", withWorktrees).project, "setup-com-prova");
  assert.equal(classify("C:\\Dev\\Dev Seazone\\wt\\scp02-tools", withWorktrees).project, "scp02-tools");
});

test("pasta ignorada não vira nem projeto nem avulsa", () => {
  const withIgnore = { ...config, ignoreCwdPrefixes: ["C:\\Users\\gabri\\AppData\\Local\\Temp"] };
  const temp = "C:\\Users\\gabri\\AppData\\Local\\Temp\\pytest-of-gabri\\pytest-594\\runs\\_worktree";
  assert.deepEqual(classify(temp, withIgnore), { area: null, project: null, loose: false, ignored: true });
});

test("pasta fora das regras é sessão avulsa", () => {
  const scratch = "C:\\Users\\gabri\\AppData\\Local\\Claude-Data\\scratch-workspaces\\x\\scratch-2026-10-06-3e26b3";
  assert.deepEqual(classify(scratch, config), { area: null, project: null, loose: true });
  assert.equal(classify("", config).loose, true);
});
