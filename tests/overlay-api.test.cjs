const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");

async function abrir(t, launchOverlay) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-cantinho-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), launchOverlay });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return `http://127.0.0.1:${app.server.address().port}`;
}
const post = (base, headers = {}) => fetch(base + "/api/overlay/abrir", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" })
  .then(async resposta => ({ status: resposta.status, body: await resposta.json() }));

test("cantinho: abre o painel flutuante apontando para este servidor e nao abre dois", async t => {
  const chamadas = [];
  const base = await abrir(t, ({ serverUrl }) => { chamadas.push(serverUrl); return { jaAberto: chamadas.length > 1 }; });
  const primeiro = await post(base);
  assert.equal(primeiro.status, 200);
  assert.deepEqual(primeiro.body, { ok: true, jaAberto: false });
  assert.deepEqual(chamadas, [base]);
  assert.equal((await post(base)).body.jaAberto, true);
});

test("cantinho: pedido vindo de outro site e barrado antes de abrir qualquer coisa", async t => {
  let chamadas = 0;
  const base = await abrir(t, () => { chamadas += 1; return { jaAberto: false }; });
  const resposta = await post(base, { Origin: "http://site-qualquer.example" });
  assert.equal(resposta.status, 403);
  assert.equal(chamadas, 0);
});

test("cantinho fora do Windows responde 501 com mensagem clara", async t => {
  const base = await abrir(t, () => { throw Object.assign(new Error("O painel flutuante so existe no Windows."), { status: 501 }); });
  const resposta = await post(base);
  assert.equal(resposta.status, 501);
  assert.match(resposta.body.error, /Windows/);
});
