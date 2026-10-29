const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { hostPermitido, pedidoLocal } = require("../request-guard");

async function abrir(t, opcoes = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-protecao-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), ...opcoes });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return app.server.address().port;
}
// O fetch nao deixa trocar o Host; o http.request deixa, e e assim que um navegador enganado chega aqui.
function pedir(port, { method = "GET", caminho = "/api/state", host, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", Host: host || `127.0.0.1:${port}` };
    if (origin) headers.Origin = origin;
    const req = http.request({ hostname: "127.0.0.1", port, path: caminho, method, headers }, res => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", parte => { texto += parte; });
      res.on("end", () => resolve({ status: res.statusCode, body: texto ? JSON.parse(texto) : null }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test("protecao: Host com nome de outro site e barrado ate em GET (DNS rebinding)", async t => {
  const port = await abrir(t);
  const resposta = await pedir(port, { host: `site-qualquer.example:${port}` });
  assert.equal(resposta.status, 403);
  assert.match(resposta.body.error, /AGENDA_HOSTS/);
});

test("protecao: localhost, 127.0.0.1 e [::1] continuam entrando", async t => {
  const port = await abrir(t);
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    assert.equal((await pedir(port, { host })).status, 200, host);
  }
});

test("protecao: um nome a mais so entra se estiver em AGENDA_HOSTS", async t => {
  const port = await abrir(t, { hosts: "agenda.lan, Notebook-Gabriel" });
  assert.equal((await pedir(port, { host: `agenda.lan:${port}` })).status, 200);
  assert.equal((await pedir(port, { host: `notebook-gabriel:${port}` })).status, 200);
  assert.equal((await pedir(port, { host: `outra.lan:${port}` })).status, 403);
});

test("protecao: POST de outra origem, ou de origem null, e barrado em qualquer rota", async t => {
  const port = await abrir(t);
  const body = { base: {}, incoming: {} };
  assert.equal((await pedir(port, { method: "POST", caminho: "/api/state/merge", origin: "http://site-qualquer.example", body })).status, 403);
  assert.equal((await pedir(port, { method: "POST", caminho: "/api/state/merge", origin: "null", body })).status, 403);
});

test("protecao: o nome do Host e lido de forma estrita", () => {
  assert.equal(hostPermitido("localhost:8787"), true);
  assert.equal(hostPermitido("LOCALHOST:8787"), true);
  assert.equal(hostPermitido("[::1]:8787"), true);
  assert.equal(hostPermitido("127.0.0.1"), true);
  assert.equal(hostPermitido("site.example@localhost:8787"), false);
  assert.equal(hostPermitido("localhost:8787/x"), false);
  assert.equal(hostPermitido(""), false);
  assert.equal(hostPermitido(undefined), false);
  assert.equal(hostPermitido("agenda.lan:8787", ["agenda.lan"]), true);
});

test("protecao: comando so vale vindo deste computador", () => {
  for (const endereco of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(pedidoLocal(endereco), true, endereco);
  for (const endereco of ["192.168.0.10", "::ffff:192.168.0.10", "10.0.0.2", "", undefined]) assert.equal(pedidoLocal(endereco), false, String(endereco));
});
