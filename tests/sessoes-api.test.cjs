const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { createCopilotoCommands, erroDoComando } = require("../copiloto-command");
const { rotaSoLocal } = require("../request-guard");

const SID = "bed96b72-86d1-400a-8a02-ebcacaf9813e";

async function abrir(t, copiloto) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-sessoes-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), copiloto });
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
