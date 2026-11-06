const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { createCopilotoCommands, validarResposta, envDoCopiloto, erroDoComando } = require("../copiloto-command");
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
  const chamadas = { responder: [], rodar: 0, mestra: 0 };
  return { chamadas, responder: async r => { chamadas.responder.push(r); return { id: "E-20261029-01", ...r }; },
    rodar: async () => { chamadas.rodar += 1; return { estado: "iniciado" }; },
    abrirMestra: async () => { chamadas.mestra += 1; return { ok: true, acao: "nova", curto: "7c0f5a9e", sessao: "7c0f5a9e-1111", janela: 777 }; } };
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

test("copiloto: o botao Mestra abre a janela pelo Copiloto e devolve o que ele fez", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  assert.equal((await post(base, "/api/copiloto/mestra", {}, { "Content-Type": "text/plain" })).status, 415);
  const resposta = await post(base, "/api/copiloto/mestra", {});
  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { ok: true, acao: "nova", curto: "7c0f5a9e", sessao: "7c0f5a9e-1111", janela: 777 });
  assert.equal(copiloto.chamadas.mestra, 1);
});

test("copiloto: a Mestra roda mestra --abrir no cli.py, com tempo para ela nascer", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, timeoutMs: opcoes.timeoutMs }); return {}; } });
  await comandos.abrirMestra();
  assert.deepEqual(chamadas[0].argumentos, ["mestra", "--abrir"]);
  assert.ok(chamadas[0].timeoutMs >= 90000);  // criar a sessao espera o claude --bg e o claude agents
});

test("copiloto: Copiloto sem a Mestra explica o que falta", () => {
  assert.match(erroDoComando({ stderr: "copiloto: error: argument grupo: invalid choice: 'mestra'" }), /Mestra/);
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
  assert.match(html, /<button id="abrirMestra"/);  // a janela do chat que manda nas outras sessoes (ADR 022 do copiloto)
  assert.match(html, /<button id="abrirRotinas"/);  // Rotinas recolhida vira uma faixa que abre a coluna
  assert.match(html, /<button id="recolherRotinas"/);
  assert.match(html, /<svg id="mapa"/);  // as bolas voltaram (docs/specs/mapa-bolas-arvore.md)
  assert.match(html, /<button id="voltarMapa"/);  // a arvore da tarefa volta ao Mapa
  assert.match(html, /<div id="arvoreDecisao" class="arvore-decisao"/);  // o clique na bola abre a arvore de decisao
  assert.doesNotMatch(html, /id="historia"|id="arvore" class="arvore"/);  // sairam os cartoes e a lista em arvore do #24
  assert.match(html, /cockpit\.js\?v=16/);
  assert.match(html, /cockpit-view\.js\?v=15/);
  assert.match(html, /cockpit-painel\.js\?v=1/);
  assert.match(html, /cockpit\.css\?v=12/);
});

// ------------------------------------------------------------------ o painel do Bill (docs/specs/cockpit-billverso.md)
test("copiloto: a tela tem as abas do painel do Bill, o mapa dos times e a faixa das acoes", async t => {
  const base = await abrir(t, copilotoFalso());
  const html = await (await fetch(base + "/cockpit")).text();
  const abas = [...html.matchAll(/data-aba="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(abas, ["mapa", "pulso", "tarefas", "saldos", "ideias", "entregas"]);
  assert.match(html, /<a class="aba-link" href="\/"[^>]*>Pessoal/);  // a parte pessoal e a agenda
  assert.match(html, /id="abrirExcalidraw" href="obsidian:\/\/search\?/);
  assert.match(html, /<svg id="mapaTimes"/);
  assert.match(html, /id="faixaAcoes"/);
  assert.match(html, /<form id="formPrioridade"/);
  assert.equal((await fetch(base + "/cockpit-painel.js")).status, 200);
});

function copilotoDoPainel() {
  const chamadas = { prioridades: [], veredito: [] };
  const lista = [{ id: "p1", texto: "Fechar o cockpit", feita: false, tarefas: [] }];
  return { ...copilotoFalso(), chamadas,
    prioridades: async p => { chamadas.prioridades.push(p); return { prioridades: lista }; },
    veredito: async v => { chamadas.veredito.push(v); return v.veredito === "ok" ? { item: v.item, acao: "ok", status: "feita", verificada: "gabriel" }
      : { item: v.item, acao: "reprovada", status: "pronta", verificada: "" }; } };
}
const leituraContada = () => {
  const c = { releituras: 0, get: async () => ({ dados: {}, lidoEm: "x", idadeSegundos: 0, atualizando: false, erro: null }) };
  c.refresh = async () => { c.releituras += 1; };
  return c;
};

test("copiloto: as prioridades pela tela chegam ao Copiloto e voltam com a lista inteira", async t => {
  const copiloto = copilotoDoPainel();
  const cockpit = leituraContada();
  const base = await abrir(t, copiloto, { cockpit });
  const r = await post(base, "/api/copiloto/prioridades", { acao: "adicionar", texto: "  Fechar o cockpit  " });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, prioridades: [{ id: "p1", texto: "Fechar o cockpit", feita: false, tarefas: [] }] });
  for (const body of [{ acao: "mover", id: "p1", direcao: "subir" }, { acao: "marcar", id: "p1", feita: true }, { acao: "apagar", id: "p1" }]) {
    assert.equal((await post(base, "/api/copiloto/prioridades", body)).status, 200, JSON.stringify(body));
  }
  assert.deepEqual(copiloto.chamadas.prioridades, [{ acao: "adicionar", dados: { texto: "Fechar o cockpit" } },
    { acao: "mover", dados: { id: "p1", direcao: "subir" } }, { acao: "marcar", dados: { id: "p1", feita: true } }, { acao: "apagar", dados: { id: "p1" } }]);
  assert.equal(cockpit.releituras, 4);  // o mapa e a orquestradora passam a ver a lista nova
});

test("copiloto: prioridade fora do formato nao chega ao Copiloto, e o erro dele volta como 400", async t => {
  const copiloto = copilotoDoPainel();
  const base = await abrir(t, copiloto);
  for (const body of [{ acao: "ligar", id: "p1", tarefa: "T-20261105-01" }, { acao: "adicionar", texto: "   " }, { acao: "adicionar", texto: "x".repeat(201) },
    { acao: "mover", id: "p1", direcao: "lado" }, { acao: "marcar", id: "1; rm", feita: true }, { acao: "apagar" }, { acao: "marcar", id: "p1", feita: "sim" }, {}]) {
    assert.equal((await post(base, "/api/copiloto/prioridades", body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(copiloto.chamadas.prioridades.length, 0);  // ligar a task e da orquestradora, nao da tela
  const recusa = await abrir(t, { ...copilotoFalso(), prioridades: async () => ({ erro: "a prioridade parece ter um segredo", prioridades: [] }) });
  const r = await post(recusa, "/api/copiloto/prioridades", { acao: "adicionar", texto: "usar a chave" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /segredo/);
  assert.deepEqual(r.body.prioridades, []);
  assert.equal((await post(base, "/api/copiloto/prioridades", { acao: "apagar", id: "p1" }, { "Content-Type": "text/plain" })).status, 415);
});

test("copiloto: aceitar e reprovar pela tela vao como veredito do Gabriel, nunca de outro", async t => {
  const copiloto = copilotoDoPainel();
  const cockpit = leituraContada();
  const base = await abrir(t, copiloto, { cockpit });
  const ok = await post(base, "/api/copiloto/veredito", { tarefa: "T-20261105-17", veredito: "ok", quem: "Verificadora" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, item: "T-20261105-17", acao: "ok", status: "feita", verificada: "gabriel" });
  const reprovada = await post(base, "/api/copiloto/veredito", { tarefa: "T-20261105-17", veredito: "reprovar", motivo: "  o print não mostra a faixa  " });
  assert.equal(reprovada.status, 200);
  assert.equal(reprovada.body.status, "pronta");
  assert.deepEqual(copiloto.chamadas.veredito, [
    { item: "T-20261105-17", veredito: "ok", motivo: "conferi a entrega e a prova pela tela do cockpit", quem: "Gabriel" },
    { item: "T-20261105-17", veredito: "reprovar", motivo: "o print não mostra a faixa", quem: "Gabriel" }]);
  assert.equal(cockpit.releituras, 2);
});

test("copiloto: veredito sem motivo na reprovacao, fora do formato ou que nao muda nada nao passa", async t => {
  const copiloto = copilotoDoPainel();
  const base = await abrir(t, copiloto);
  for (const body of [{ tarefa: "T-20261105-17", veredito: "reprovar" }, { tarefa: "T-20261105-17", veredito: "reprovar", motivo: "   " },
    { tarefa: "T-20261105-17", veredito: "segurar", motivo: "x" }, { tarefa: "R-07", veredito: "ok" },
    { tarefa: "T-20261105-17", veredito: "ok", motivo: "x".repeat(501) }, {}]) {
    assert.equal((await post(base, "/api/copiloto/veredito", body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(copiloto.chamadas.veredito.length, 0);
  const nada = await abrir(t, { ...copilotoFalso(), veredito: async v => ({ item: v.item, acao: "nada", motivo: "a task já não espera verificação (feita, verificada: ok)" }) });
  const r = await post(nada, "/api/copiloto/veredito", { tarefa: "T-20261105-17", veredito: "ok" });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /já não espera verificação/);
  const erro = await abrir(t, { ...copilotoFalso(), veredito: async v => ({ item: v.item, erro: ["o motivo parece ter um segredo: tire antes de gravar na nota"] }) });
  const e = await post(erro, "/api/copiloto/veredito", { tarefa: "T-20261105-17", veredito: "reprovar", motivo: "a chave" });
  assert.equal(e.status, 400);
  assert.match(e.body.error, /segredo/);
});

test("copiloto: prioridades e veredito chamam o cli.py com o pedido pela entrada padrao", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, entrada: opcoes.entrada }); return {}; } });
  await comandos.prioridades({ acao: "mover", dados: { id: "p2", direcao: "descer" } });
  await comandos.veredito({ item: "T-20261105-17", veredito: "ok", motivo: "m", quem: "Gabriel" });
  assert.deepEqual(chamadas, [{ argumentos: ["prioridades", "mover"], entrada: { id: "p2", direcao: "descer" } },
    { argumentos: ["verificacao", "veredito"], entrada: { item: "T-20261105-17", veredito: "ok", motivo: "m", quem: "Gabriel" } }]);
  assert.match(erroDoComando({ stderr: "copiloto: error: argument grupo: invalid choice: 'prioridades'" }), /prioridades/);
});

// ------------------------------------------------------------------ a resposta pede o ciclo (30/10)
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

test("copiloto: a resposta pela tela pede um ciclo cicloMs depois da ultima, e respostas seguidas pedem um so", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto, { cicloMs: 300 });
  await post(base, "/api/copiloto/responder", { acao: "aprovar", item: "R-07" });
  await esperar(200);
  await post(base, "/api/copiloto/responder", { acao: "descartar", item: "R-08" });
  await post(base, "/api/copiloto/responder", { acao: "responder", item: "T-20261029-03", texto: "pode seguir" });
  await esperar(150);
  assert.equal(copiloto.chamadas.rodar, 0);  // passou o tempo da primeira, nao o da ultima
  await esperar(400);
  assert.equal(copiloto.chamadas.rodar, 1);
});

test("copiloto: com um rodar agora ainda vivo, o servidor tenta de novo ate o pedido entrar", async t => {
  const estados = ["ja-pedido", "ja-pedido", "na-fila", "iniciado"];
  let vezes = 0;
  const base = await abrir(t, { responder: async r => ({ id: "E-20261030-01", ...r }), rodar: async () => ({ estado: estados[vezes++] }) },
    { cicloMs: 20 });
  await post(base, "/api/copiloto/responder", { acao: "aprovar", item: "R-07" });
  await esperar(400);
  assert.equal(vezes, 3);  // o ciclo anterior podia ja ter lido a fila; parou quando o pedido entrou
});

test("copiloto: pausado ou com erro, o servidor nao insiste no ciclo", async t => {
  for (const resultado of [async () => ({ estado: "pausado" }), async () => { throw new Error("cli.py fora do ar"); }]) {
    let vezes = 0;
    const base = await abrir(t, { responder: async r => ({ id: "E-20261030-01", ...r }), rodar: async () => { vezes += 1; return resultado(); } },
      { cicloMs: 20 });
    await post(base, "/api/copiloto/responder", { acao: "aprovar", item: "R-07" });
    await esperar(250);
    assert.equal(vezes, 1);
  }
});

test("copiloto: resposta recusada nao pede ciclo", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto, { cicloMs: 20 });
  assert.equal((await post(base, "/api/copiloto/responder", { acao: "apagar", item: "R-07" })).status, 400);
  await esperar(150);
  assert.equal(copiloto.chamadas.rodar, 0);
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

test("copiloto: a arvore da tarefa e a do projeto vem do Copiloto, com o id e o nome conferidos", async t => {
  const pedidos = [];
  const copiloto = { ...copilotoFalso(),
    arvoreDaTarefa: async id => { pedidos.push(["tarefa", id]); return { tipo: "tarefa", id, filhos: [] }; },
    arvoreDoProjeto: async nome => { pedidos.push(["projeto", nome]); return { tipo: "projeto", texto: nome, filhos: [] }; } };
  const base = await abrir(t, copiloto);
  const tarefa = await fetch(`${base}/api/tarefas/T-20261103-03/arvore`).then(r => r.json());
  assert.equal(tarefa.id, "T-20261103-03");
  const projeto = await fetch(`${base}/api/projetos/${encodeURIComponent("Jornada da Implantação")}/arvore`).then(r => r.json());
  assert.equal(projeto.texto, "Jornada da Implantação");
  for (const caminho of ["/api/tarefas/..%2Fx/arvore", "/api/projetos/..%2F..%2Fsegredo/arvore", "/api/projetos/a%5Cb/arvore"]) {
    assert.equal((await fetch(base + caminho)).status, 400, caminho);
  }
  assert.deepEqual(pedidos, [["tarefa", "T-20261103-03"], ["projeto", "Jornada da Implantação"]]);
});

test("copiloto: os comandos da arvore chamam tarefa arvore e projeto arvore", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async argumentos => { chamadas.push(argumentos); return {}; } });
  await comandos.arvoreDaTarefa("T-20261103-03");
  await comandos.arvoreDoProjeto("Jornada da Implantação");
  assert.deepEqual(chamadas, [["tarefa", "arvore", "T-20261103-03"], ["projeto", "arvore", "Jornada da Implantação"]]);
});
