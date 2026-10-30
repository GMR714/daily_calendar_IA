const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { createCopilotoCommands, erroDoComando } = require("../copiloto-command");
const { rotaSoLocal } = require("../request-guard");

const SID = "bed96b72-86d1-400a-8a02-ebcacaf9813e";

async function abrir(t, copiloto, extras = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-sessoes-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), copiloto, ...extras });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return `http://127.0.0.1:${app.server.address().port}`;
}
const get = (base, caminho) => fetch(base + caminho).then(async r => ({ status: r.status, body: await r.json() }));
function copilotoFalso() {
  const chamadas = [];
  return { chamadas, lerSessao: async pedido => {
    chamadas.push(pedido);
    return { sessao: pedido.sessao, sub: pedido.sub, falas: [{ quem: "claude", texto: "Pronto.", hora: "29/10 17:30" }], antes: 123, tamanho: 999 };
  } };
}

test("sessoes: a conversa pede ao Copiloto a sessao, a subsessao e a posicao", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  const r = await get(base, `/api/sessoes/${SID}/conversa?sub=a16c7a8c945a71c91&antes=241831139`);
  assert.equal(r.status, 200);
  assert.deepEqual(copiloto.chamadas, [{ sessao: SID, sub: "a16c7a8c945a71c91", antes: 241831139 }]);
  assert.equal(r.body.falas[0].texto, "Pronto.");
  assert.equal(r.body.antes, 123);
  assert.equal((await get(base, `/api/sessoes/${SID.slice(0, 8)}/conversa`)).status, 200);
  assert.deepEqual(copiloto.chamadas[1], { sessao: SID.slice(0, 8), sub: null, antes: null });
});

test("sessoes: id, subsessao ou posicao fora do formato da 400 e nao chega ao Copiloto", async t => {
  const copiloto = copilotoFalso();
  const base = await abrir(t, copiloto);
  for (const caminho of ["/api/sessoes/..%2Fsegredo/conversa", "/api/sessoes/xyz/conversa", `/api/sessoes/${SID.toUpperCase()}/conversa`,
    `/api/sessoes/${SID}/conversa?sub=..%2Fx`, `/api/sessoes/${SID}/conversa?antes=-1`, `/api/sessoes/${SID}/conversa?antes=abc`]) {
    assert.equal((await get(base, caminho)).status, 400, caminho);
  }
  assert.equal(copiloto.chamadas.length, 0);
});

test("sessoes: falha do Copiloto vira 503 com a mensagem dele", async t => {
  const base = await abrir(t, { lerSessao: async () => { throw Object.assign(new Error("O Copiloto nao aceitou: Não achei a conversa dessa sessão."), { status: 503 }); } });
  const r = await get(base, `/api/sessoes/${SID}/conversa`);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /conversa dessa sessão/);
});

test("sessoes: o cli.py recebe sessao ler com a subsessao e a posicao", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async argumentos => { chamadas.push(argumentos); return {}; } });
  await comandos.lerSessao({ sessao: SID, sub: "a16c7a8c945a71c91", antes: 120 });
  await comandos.lerSessao({ sessao: SID, sub: null, antes: null });
  assert.deepEqual(chamadas, [["sessao", "ler", SID, "--sub", "a16c7a8c945a71c91", "--antes", "120"], ["sessao", "ler", SID]]);
});

test("sessoes: as rotas de sessao so atendem este computador, ate no GET", () => {
  assert.equal(rotaSoLocal(`/api/sessoes/${SID}/conversa`), true);
  assert.equal(rotaSoLocal("/api/copiloto/responder"), true);
  assert.equal(rotaSoLocal("/api/overlay/abrir"), true);
  assert.equal(rotaSoLocal("/api/cockpit"), false);
  assert.equal(rotaSoLocal("/cockpit"), false);
});

test("sessoes: Copiloto antigo, sem o comando sessao, explica o que falta", () => {
  const texto = erroDoComando({ stderr: "copiloto: error: argument grupo: invalid choice: 'sessao' (choose from 'tarefa', 'msg')" });
  assert.match(texto, /sess/i);
  assert.match(texto, /git pull/);
});

// ------------------------------------------------------------------ entrega 2: responder e parar
const post = (base, caminho, body, headers = { "Content-Type": "application/json" }) =>
  fetch(base + caminho, { method: "POST", headers, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
function copilotoDeResposta(estado = "entregue") {
  const chamadas = { responder: [], parar: [], entregar: 0 };
  let pendentes = estado === "na-fila" ? 2 : 0;
  return { chamadas,
    responderSessao: async r => { chamadas.responder.push(r); return { estado, id: "P-20261029-190606-1" }; },
    pararSessao: async s => { chamadas.parar.push(s); return { estado: "parada" }; },
    entregarSessoes: async () => { chamadas.entregar += 1; pendentes = Math.max(0, pendentes - 1); return { entregues: [], pendentes, erros: [] }; } };
}

test("sessoes: responder leva o texto ao Copiloto e devolve se entregou", async t => {
  const copiloto = copilotoDeResposta("entregue");
  const base = await abrir(t, copiloto);
  const r = await post(base, `/api/sessoes/${SID}/responder`, { texto: "  pode seguir  " });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, estado: "entregue", id: "P-20261029-190606-1" });
  assert.deepEqual(copiloto.chamadas.responder, [{ sessao: SID, texto: "pode seguir" }]);
});

test("sessoes: resposta vazia, longa, sem JSON ou de outro site nao chega ao Copiloto", async t => {
  const copiloto = copilotoDeResposta();
  const base = await abrir(t, copiloto);
  assert.equal((await post(base, `/api/sessoes/${SID}/responder`, { texto: "  " })).status, 400);
  assert.equal((await post(base, `/api/sessoes/${SID}/responder`, { texto: "x".repeat(8001) })).status, 400);
  assert.equal((await post(base, "/api/sessoes/xyz/responder", { texto: "oi" })).status, 400);
  assert.equal((await post(base, `/api/sessoes/${SID}/responder`, { texto: "oi" }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post(base, `/api/sessoes/${SID}/parar`, {}, { "Content-Type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal((await post(base, `/api/sessoes/${SID}/responder`, { texto: "oi" }, { "Content-Type": "application/json", Origin: "http://site.example" })).status, 403);
  assert.deepEqual([copiloto.chamadas.responder.length, copiloto.chamadas.parar.length], [0, 0]);
});

test("sessoes: parar pede ao Copiloto o claude stop da sessao", async t => {
  const copiloto = copilotoDeResposta();
  const base = await abrir(t, copiloto);
  const r = await post(base, `/api/sessoes/${SID}/parar`, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, estado: "parada" });
  assert.deepEqual(copiloto.chamadas.parar, [SID]);
});

test("sessoes: resposta na fila liga a entrega, que roda ate a fila esvaziar e para", async t => {
  const copiloto = copilotoDeResposta("na-fila");
  const base = await abrir(t, copiloto, { entregaMs: 15 });
  assert.equal((await post(base, `/api/sessoes/${SID}/responder`, { texto: "depois" })).body.estado, "na-fila");
  await new Promise(r => setTimeout(r, 200));
  assert.equal(copiloto.chamadas.entregar, 2);
});

test("sessoes: o cli.py recebe sessao responder (texto pela entrada padrao), entregar e parar", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, entrada: opcoes.entrada }); return {}; } });
  await comandos.responderSessao({ sessao: SID, texto: "oi" });
  await comandos.entregarSessoes();
  await comandos.pararSessao(SID);
  assert.deepEqual(chamadas, [
    { argumentos: ["sessao", "responder"], entrada: { sessao: SID, texto: "oi", origem: "tela" } },
    { argumentos: ["sessao", "entregar"], entrada: undefined },
    { argumentos: ["sessao", "parar", SID], entrada: undefined }]);
});

// ------------------------------------------------------------------ entrega 3: resumo para ouvir
test("sessoes: o Ouvir pede ao Copiloto o resumo da sessao, so deste computador", async t => {
  const chamadas = [];
  const base = await abrir(t, { resumirSessao: async sessao => {
    chamadas.push(sessao);
    return { sessao: SID, texto: "A revisão terminou e espera você.", palavras: 6, segundos: 3, fonte: "ia", guardado: false };
  } });
  const r = await get(base, `/api/sessoes/${SID.slice(0, 8)}/resumo`);
  assert.equal(r.status, 200);
  assert.equal(r.body.texto, "A revisão terminou e espera você.");
  assert.equal((await get(base, "/api/sessoes/xyz/resumo")).status, 400);
  assert.deepEqual(chamadas, [SID.slice(0, 8)]);
  assert.equal(rotaSoLocal(`/api/sessoes/${SID}/resumo`), true);
});

test("sessoes: falha do resumo vira 503 com a mensagem do Copiloto", async t => {
  const base = await abrir(t, { resumirSessao: async () => { throw Object.assign(new Error("O Copiloto demorou demais para responder."), { status: 503 }); } });
  const r = await get(base, `/api/sessoes/${SID}/resumo`);
  assert.equal(r.status, 503);
  assert.match(r.body.error, /demorou/);
});

test("sessoes: o cli.py recebe sessao resumo, com tempo para o claude -p", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async (argumentos, opcoes = {}) => { chamadas.push({ argumentos, timeoutMs: opcoes.timeoutMs }); return {}; } });
  await comandos.resumirSessao(SID);
  assert.deepEqual(chamadas, [{ argumentos: ["sessao", "resumo", SID], timeoutMs: 90000 }]);
});

test("sessoes: Copiloto sem o resumo explica o que falta", () => {
  const texto = erroDoComando({ stderr: "copiloto sessao: error: argument acao: invalid choice: 'resumo' (choose from 'ler', 'responder', 'entregar', 'parar')" });
  assert.match(texto, /resumo/);
  assert.match(texto, /git pull/);
});
