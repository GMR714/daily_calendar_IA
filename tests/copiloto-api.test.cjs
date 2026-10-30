const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { createCopilotoCommands, validarResposta, envDoCopiloto } = require("../copiloto-command");
const { commandFor, DEFAULT_CLI } = require("../cockpit-source");

async function abrir(t, copiloto, extras = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-copiloto-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), copiloto, ...extras });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return `http://127.0.0.1:${app.server.address().port}`;
}
const post = (base, caminho, body, headers = { "Content-Type": "application/json" }) =>
  fetch(base + caminho, { method: "POST", headers, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
function copilotoFalso() {
  const chamadas = { responder: [], rodar: 0 };
  return { chamadas, responder: async r => { chamadas.responder.push(r); return { id: "E-20261029-01", ...r }; },
    rodar: async () => { chamadas.rodar += 1; return { estado: "iniciado" }; } };
}

test("copiloto: aprovar um rascunho grava a resposta pelo Copiloto", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  const resposta = await post(base, "/api/copiloto/responder", { acao: "aprovar", item: "R-07" });
  assert.equal(resposta.status, 200);
  assert.deepEqual(copiloto.chamadas.responder, [{ acao: "aprovar", item: "R-07", texto: "" }]);
  assert.equal(resposta.body.ok, true);
  assert.equal(resposta.body.entrada.id, "E-20261029-01");
});

test("copiloto: responder uma decisao leva o texto, sem espacos sobrando", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  const resposta = await post(base, "/api/copiloto/responder", { acao: "responder", item: "T-20261029-03", texto: "  pode seguir com a opcao B  " });
  assert.equal(resposta.status, 200);
  assert.deepEqual(copiloto.chamadas.responder, [{ acao: "responder", item: "T-20261029-03", texto: "pode seguir com a opcao B" }]);
});

test("copiloto: pedido invalido nao chega ao Copiloto", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  for (const body of [{ acao: "apagar", item: "R-07" }, { acao: "aprovar", item: "R-07; del *" }, { acao: "aprovar" },
    { acao: "responder", item: "T-20261029-03", texto: "   " }, { acao: "responder", item: "T-20261029-03", texto: "x".repeat(4001) }]) {
    assert.equal((await post(base, "/api/copiloto/responder", body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(copiloto.chamadas.responder.length, 0);
});

test("copiloto: sem Content-Type JSON ou vindo de outro site e barrado", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  const body = { acao: "aprovar", item: "R-07" };
  assert.equal((await post(base, "/api/copiloto/responder", body, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(base, "/api/copiloto/rodar", {}, { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await post(base, "/api/copiloto/responder", body, { "Content-Type": "application/json", Origin: "http://site-qualquer.example" })).status, 403);
  assert.equal(copiloto.chamadas.responder.length, 0);
  assert.equal(copiloto.chamadas.rodar, 0);
});

test("copiloto: rodar agora pede um ciclo e devolve o estado", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  const resposta = await post(base, "/api/copiloto/rodar", {});
  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { ok: true, estado: "iniciado" });
  assert.equal(copiloto.chamadas.rodar, 1);
});

test("copiloto: falha do Copiloto vira 503 com a mensagem dele", async t => {
  const base = await abrir(t, { responder: async () => { throw Object.assign(new Error("O Copiloto instalado ainda nao tem a caixa de entrada."), { status: 503 }); },
    rodar: async () => ({}) });
  const resposta = await post(base, "/api/copiloto/responder", { acao: "descartar", item: "R-07" });
  assert.equal(resposta.status, 503);
  assert.match(resposta.body.error, /caixa de entrada/);
});

test("copiloto: a resposta vai pela entrada padrao do cli.py, marcada como vinda da tela", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, entrada: opcoes.entrada }); return {}; } });
  await comandos.responder({ acao: "responder", item: "T-20261029-03", texto: "opcao B" });
  await comandos.rodar();
  assert.deepEqual(chamadas, [
    { argumentos: ["entrada", "gravar"], entrada: { acao: "responder", item: "T-20261029-03", texto: "opcao B", origem: "tela" } },
    { argumentos: ["ciclo", "agora"], entrada: undefined }]);
});

test("copiloto: chave de API da agenda nao vai para o ciclo do Copiloto", () => {
  const env = envDoCopiloto({ PATH: "C:\\bin", TZ: "America/Sao_Paulo", ANTHROPIC_API_KEY: "chave", ANTHROPIC_BASE_URL: "https://x", COCKPIT_CLI: "c" }, "win32");
  assert.equal(env.PATH, "C:\\bin");
  assert.equal(env.COCKPIT_CLI, "c");
  assert.equal(env.PYTHONIOENCODING, "utf-8");
  assert.equal("TZ" in env, false);
  assert.deepEqual(Object.keys(env).filter(k => k.startsWith("ANTHROPIC_")), []);
});

test("copiloto: validarResposta aceita os ids do Copiloto e recusa o resto", () => {
  assert.deepEqual(validarResposta({ acao: "aprovar", item: "R-07" }), { acao: "aprovar", item: "R-07", texto: "" });
  assert.equal(validarResposta({ acao: "descartar", item: "R-123" }).item, "R-123");
  assert.throws(() => validarResposta({ acao: "aprovar", item: "../estado" }), /Item invalido/);
  assert.throws(() => validarResposta({}), /Acao desconhecida/);
});

test("copiloto: o py -3 cli.py recebe os argumentos de cada comando", () => {
  assert.deepEqual(commandFor({}, "win32", ["ciclo", "agora", "--json"]), { file: "py", args: ["-3", DEFAULT_CLI, "ciclo", "agora", "--json"] });
  assert.deepEqual(commandFor({}, "win32"), { file: "py", args: ["-3", DEFAULT_CLI, "cockpit", "--json"] });
});

test("copiloto: resposta gravada pede uma leitura nova do cockpit, para a tela mostrar que espera o ciclo", async t => {
  let releituras = 0;
  const cockpit = { get: async () => ({ dados: {}, lidoEm: "x", idadeSegundos: 0, atualizando: false, erro: null }),
    refresh: async () => { releituras += 1; } };
  const base = await abrir(t, copilotoFalso(), { cockpit });
  assert.equal((await fetch(base + "/api/cockpit")).status, 200);
  assert.equal((await post(base, "/api/copiloto/responder", { acao: "aprovar", item: "R-07" })).status, 200);
  assert.equal(releituras, 1);
});

test("copiloto: a tela do cockpit tem o botao Rodar agora e pede a versao nova dos scripts", async t => {
  const base = await abrir(t, copilotoFalso());
  const html = await (await fetch(base + "/cockpit")).text();
  assert.match(html, /<button id="rodarAgora"/);
  assert.match(html, /<button id="voltarMapa"/);  // o grafo de um projeto ou tarefa volta ao Mapa
  assert.match(html, /<button id="abrirRotinas"/);  // Rotinas recolhida vira uma faixa que abre a coluna
  assert.match(html, /<button id="recolherRotinas"/);
  assert.match(html, /<div id="historia"/);  // o clique numa bola troca as bolas pela historia da tarefa
  assert.match(html, /cockpit\.js\?v=11/);
  assert.match(html, /cockpit-view\.js\?v=10/);
  assert.match(html, /cockpit\.css\?v=9/);
});

// ------------------------------------------------------------------ excluir tarefa (29/10)
test("copiloto: excluir tarefa leva o id ao Copiloto e rele o cockpit, para o card sair na hora", async t => {
  const excluidas = [];
  let releituras = 0;
  const cockpit = { get: async () => ({ dados: {}, lidoEm: "x", idadeSegundos: 0, atualizando: false, erro: null }), refresh: async () => { releituras += 1; } };
  const base = await abrir(t, { excluirTarefa: async id => { excluidas.push(id); return { id, status: "descartada" }; } }, { cockpit });
  const r = await post(base, "/api/copiloto/excluir-tarefa", { tarefa: "T-20261029-03" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, id: "T-20261029-03", status: "descartada" });
  assert.deepEqual(excluidas, ["T-20261029-03"]);
  assert.equal(releituras, 1);
});

test("copiloto: excluir com id fora do formato, sem JSON ou de outro site nao chega ao Copiloto", async t => {
  const excluidas = [];
  const base = await abrir(t, { excluirTarefa: async id => { excluidas.push(id); return { id, status: "descartada" }; } });
  for (const body of [{ tarefa: "R-07" }, { tarefa: "T-2026" }, { tarefa: "../Tarefas/T-20261029-03" }, { tarefa: "T-20261029-03 x" }, {}]) {
    assert.equal((await post(base, "/api/copiloto/excluir-tarefa", body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(base, "/api/copiloto/excluir-tarefa", { tarefa: "T-20261029-03" }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(base, "/api/copiloto/excluir-tarefa", { tarefa: "T-20261029-03" }, { "Content-Type": "application/json", Origin: "http://site.example" })).status, 403);
  assert.deepEqual(excluidas, []);
});

test("copiloto: o cli.py recebe tarefa registrar com o texto fixo e o status descartada", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, entrada: opcoes.entrada }); return {}; } });
  await comandos.excluirTarefa("T-20261029-03");
  assert.deepEqual(chamadas, [{ argumentos: ["tarefa", "registrar", "T-20261029-03", "Descartada pela tela do cockpit.", "--status", "descartada"], entrada: undefined }]);
});
