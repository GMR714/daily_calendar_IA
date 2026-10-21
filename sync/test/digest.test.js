const test = require("node:test");
const assert = require("node:assert/strict");
const { localDay, stripNoise, eventsFromRecord, buildDigests, renderDigest } = require("../digest");

const config = {
  rules: [
    { prefix: "C:\\Dev", area: "Pessoais", projectFromSubfolder: true },
    { prefix: "C:\\Dev\\Dev Seazone", area: "Seazone", projectFromSubfolder: true, rootProject: "Geral" }
  ],
  aliases: {}
};

function user(content, extra = {}) {
  return { type: "user", timestamp: "2026-10-20T13:00:00.000Z", sessionId: "s1", cwd: "C:\\Dev\\PokeSurvivors", message: { role: "user", content }, ...extra };
}

function assistant(content, extra = {}) {
  return { type: "assistant", timestamp: "2026-10-20T13:01:00.000Z", sessionId: "s1", cwd: "C:\\Dev\\PokeSurvivors", message: { role: "assistant", content }, ...extra };
}

function toolUse(name, input) {
  return assistant([{ type: "tool_use", id: "t1", name, input }]);
}

test("dia local considera o fuso de Brasília", () => {
  assert.equal(localDay("2026-10-21T02:30:00.000Z", -3), "2026-10-20");
  assert.equal(localDay("2026-10-21T03:00:00.000Z", -3), "2026-10-21");
});

test("tira lembretes do sistema e saídas de comando", () => {
  const text = "Arruma o bug\n<system-reminder>\nnão é do usuário\n</system-reminder>\n<local-command-stdout>lixo</local-command-stdout>";
  assert.equal(stripNoise(text), "Arruma o bug");
  assert.equal(stripNoise("<system-reminder>só isso</system-reminder>"), "");
});

test("fala do usuário vira evento; meta e subagente são ignorados", () => {
  assert.deepEqual(eventsFromRecord(user("Cria o menu de pausa")).map(e => [e.kind, e.text]), [["user", "Cria o menu de pausa"]]);
  assert.deepEqual(eventsFromRecord(user("x", { isMeta: true })), []);
  assert.deepEqual(eventsFromRecord(user("x", { isSidechain: true })), []);
  assert.deepEqual(eventsFromRecord(user([{ type: "text", text: "<system-reminder>a</system-reminder>" }])), []);
});

test("texto do assistente entra; raciocínio interno não", () => {
  const events = eventsFromRecord(assistant([
    { type: "thinking", thinking: "pensando" },
    { type: "text", text: "Pronto, o menu abre com Esc." }
  ]));
  assert.deepEqual(events.map(e => [e.kind, e.text]), [["assistant", "Pronto, o menu abre com Esc."]]);
});

test("ferramentas viram só o rastro útil", () => {
  assert.deepEqual(eventsFromRecord(toolUse("Edit", { file_path: "C:\\Dev\\PokeSurvivors\\src\\menu.js" })).map(e => [e.kind, e.text]),
    [["edit", "C:\\Dev\\PokeSurvivors\\src\\menu.js"]]);
  assert.equal(eventsFromRecord(toolUse("Bash", { command: 'git add . && git commit -m "feat: menu de pausa"' }))[0].text, "feat: menu de pausa");
  const heredoc = "git commit -q -F - <<'EOF'\ndocs: aprova spec mapeamento-obsidian\n\nCorpo.\nEOF";
  assert.deepEqual(eventsFromRecord(toolUse("Bash", { command: heredoc })).map(e => [e.kind, e.text]),
    [["commit", "docs: aprova spec mapeamento-obsidian"]]);
  assert.deepEqual(eventsFromRecord(toolUse("PowerShell", { command: 'gh pr create --title "Menu de pausa" --body x' })).map(e => [e.kind, e.text]),
    [["pr", "PR aberto: Menu de pausa"]]);
  assert.deepEqual(eventsFromRecord(toolUse("Bash", { command: "ls -la" })), []);
  assert.deepEqual(eventsFromRecord(toolUse("Read", { file_path: "a.js" })), []);
});

test("plano e recap do app viram eventos", () => {
  const plan = toolUse("mcp__ccd_turn__update_plan", { items: [
    { content: "Escrever testes", status: "completed" },
    { content: "Implementar", status: "in_progress" },
    { content: "Commitar", status: "pending" }
  ] });
  assert.equal(eventsFromRecord(plan)[0].kind, "plan");
  assert.equal(eventsFromRecord(plan)[0].text, "[x] Escrever testes · [>] Implementar · [ ] Commitar");
  const recap = toolUse("mcp__ccd_turn__wrap_up", { recap: "Menu pronto, falta testar no celular." });
  assert.deepEqual(eventsFromRecord(recap).map(e => [e.kind, e.text]), [["recap", "Menu pronto, falta testar no celular."]]);
});

test("link de PR em resultado de ferramenta vira evento", () => {
  const record = user([{ type: "tool_result", tool_use_id: "t1", content: "Created https://github.com/GMR714/Video_editor/pull/18 ok" }]);
  assert.deepEqual(eventsFromRecord(record).map(e => [e.kind, e.text]), [["pr", "https://github.com/GMR714/Video_editor/pull/18"]]);
});

test("agrupa por sessão, dia e projeto, com título e branch", () => {
  const records = [
    { type: "custom-title", customTitle: "Bot do setup", sessionId: "s9" },
    { type: "user", sessionId: "s9", timestamp: "2026-10-20T14:00:00.000Z", cwd: "/c/Dev/Dev Seazone/olimpo", gitBranch: "main", message: { content: "Ajusta o olimpo" } },
    { type: "user", sessionId: "s9", timestamp: "2026-10-20T15:00:00.000Z", cwd: "/c/Dev/Dev Seazone", gitBranch: "main", message: { content: "Agora a apresentação" } },
    { type: "user", sessionId: "s9", timestamp: "2026-10-21T12:00:00.000Z", cwd: "/c/Dev/Dev Seazone/olimpo", gitBranch: "feat/x", message: { content: "Continua o olimpo" } }
  ];
  const digests = buildDigests(records, { config, offsetHours: -3 });
  const keys = digests.map(d => `${d.day}|${d.area}|${d.project}`).sort();
  assert.deepEqual(keys, ["2026-10-20|Seazone|Geral", "2026-10-20|Seazone|olimpo", "2026-10-21|Seazone|olimpo"]);
  const last = digests.find(d => d.day === "2026-10-21");
  assert.equal(last.title, "Bot do setup");
  assert.deepEqual(last.branches, ["feat/x"]);
  assert.equal(last.sessionId, "s9");
});

test("ignora registros de pastas ignoradas", () => {
  const withIgnore = { ...config, ignoreCwdPrefixes: ["C:\\Users\\gabri\\AppData\\Local\\Temp"] };
  const records = [user("teste do pytest", { cwd: "C:\\Users\\gabri\\AppData\\Local\\Temp\\pytest-of-gabri\\x" })];
  assert.deepEqual(buildDigests(records, { config: withIgnore, offsetHours: -3 }), []);
});

test("ignora registros fora do intervalo de datas", () => {
  const records = [
    user("antigo", { timestamp: "2026-08-01T12:00:00.000Z" }),
    user("novo", { timestamp: "2026-10-20T12:00:00.000Z" })
  ];
  const digests = buildDigests(records, { config, offsetHours: -3, since: "2026-09-01", until: "2026-10-21" });
  assert.equal(digests.length, 1);
  assert.equal(digests[0].events[0].text, "novo");
});

test("render corta a conversa antiga primeiro e mantém o rastro", () => {
  const records = [];
  for (let i = 0; i < 50; i += 1) {
    records.push(user(`mensagem ${i} ${"x".repeat(200)}`, { timestamp: `2026-10-20T13:${String(i).padStart(2, "0")}:00.000Z` }));
  }
  records.push(toolUse("Bash", { command: 'git commit -m "feat: menu"' }));
  records[records.length - 1].timestamp = "2026-10-20T12:00:00.000Z";
  const [digest] = buildDigests(records, { config, offsetHours: -3 });
  const text = renderDigest(digest, { maxChars: 3000 });
  assert.ok(text.length <= 3000, `tamanho ${text.length}`);
  assert.match(text, /feat: menu/);
  assert.match(text, /mensagem 49/);
  assert.doesNotMatch(text, /mensagem 0 /);
  assert.match(text, /mensagens anteriores omitidas/);
});

test("render remove segredos", () => {
  const secret = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
  const [digest] = buildDigests([user(`usa o token ${secret}`)], { config, offsetHours: -3 });
  assert.ok(!renderDigest(digest).includes(secret));
});
