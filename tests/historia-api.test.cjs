const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { createCopilotoCommands, erroDoComando } = require("../copiloto-command");
const { rotaSoLocal } = require("../request-guard");

async function abrir(t, copiloto) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-historia-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), copiloto });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return `http://127.0.0.1:${app.server.address().port}`;
}
const get = (base, caminho) => fetch(base + caminho).then(async r => ({ status: r.status, body: await r.json() }));

test("historia: a rota pede ao Copiloto a historia da tarefa, so deste computador", async t => {
  const chamadas = [];
  const base = await abrir(t, { historiaDaTarefa: async id => {
    chamadas.push(id);
    return { id, passos: [{ quando: "29/10 12:38", texto: "Rascunho R-69" }], agora: { tipo: "voce", texto: "espera o ok R-69" } };
  } });
  const r = await get(base, "/api/tarefas/T-20261029-01/historia");
  assert.equal(r.status, 200);
  assert.equal(r.body.passos[0].quando, "29/10 12:38");
  for (const ruim of ["R-07", "T-2026", "..%2FTarefas%2FT-20261029-01"]) assert.equal((await get(base, `/api/tarefas/${ruim}/historia`)).status, 400, ruim);
  assert.deepEqual(chamadas, ["T-20261029-01"]);
  assert.equal(rotaSoLocal("/api/tarefas/T-20261029-01/historia"), true);
});

test("historia: falha do Copiloto vira 503 com a mensagem dele", async t => {
  const base = await abrir(t, { historiaDaTarefa: async () => { throw Object.assign(new Error("O Copiloto nao aceitou: tarefa T-20261029-01 não encontrada"), { status: 503 }); } });
  const r = await get(base, "/api/tarefas/T-20261029-01/historia");
  assert.equal(r.status, 503);
  assert.match(r.body.error, /não encontrada/);
});

test("historia: o cli.py recebe tarefa historia com o id", async () => {
  const chamadas = [];
  const comandos = createCopilotoCommands({ run: async argumentos => { chamadas.push(argumentos); return {}; } });
  await comandos.historiaDaTarefa("T-20261029-01");
  assert.deepEqual(chamadas, [["tarefa", "historia", "T-20261029-01"]]);
});

test("historia: Copiloto sem a historia explica o que falta", () => {
  const texto = erroDoComando({ stderr: "copiloto tarefa: error: argument acao: invalid choice: 'historia' (choose from 'nova', 'salvar')" });
  assert.match(texto, /hist[oó]ria/i);
  assert.match(texto, /git pull/);
});
