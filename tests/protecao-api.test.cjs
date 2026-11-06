const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const { hostPermitido, pedidoLocal, origemPermitida, pelaTailnet } = require("../request-guard");

async function abrir(t, opcoes = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-protecao-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), ...opcoes });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return app.server.address().port;
}
// O fetch nao deixa trocar o Host; o http.request deixa, e e assim que um navegador enganado chega aqui.
function pedir(port, { method = "GET", caminho = "/api/state", host, origin, body, extras = {} } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", Host: host || `127.0.0.1:${port}`, ...extras };
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

// ------------------------------------------------------------------ pela tailnet (docs/specs/cockpit-pela-tailnet.md)
// O `tailscale serve` do notebook repassa o pedido de outra maquina da tailnet para 127.0.0.1, com o Host do nome dela
// na tailnet, o X-Forwarded-For de quem pediu e o Tailscale-User-Login, que ele mesmo preenche (o cliente nao forja).
const TAILNET = "notebook.tailnet-exemplo.ts.net";
const doProxy = (login, ip = "100.64.0.2") => ({ "X-Forwarded-For": ip, ...(login ? { "Tailscale-User-Login": login } : {}) });

test("tailnet: pelo proxy, so entra o login da lista; sem a lista, ninguem entra por ele", async t => {
  const comLista = await abrir(t, { hosts: TAILNET, logins: "dono@exemplo.test" });
  assert.equal((await pedir(comLista, { host: TAILNET, extras: doProxy("dono@exemplo.test") })).status, 200);
  assert.equal((await pedir(comLista, { host: TAILNET, extras: doProxy("Dono@Exemplo.test") })).status, 200);  // e-mail sem caixa
  const outro = await pedir(comLista, { host: TAILNET, extras: doProxy("visita@x.test") });
  assert.equal(outro.status, 403);
  assert.match(outro.body.error, /AGENDA_TAILSCALE_LOGINS/);
  assert.equal((await pedir(comLista, { host: TAILNET, extras: doProxy("") })).status, 403);  // maquina com tag, sem pessoa
  assert.equal((await pedir(comLista, { host: `127.0.0.1:${comLista}`, extras: doProxy("visita@x.test") })).status, 403);  // Host trocado
  const semLista = await abrir(t, { hosts: TAILNET });
  assert.equal((await pedir(semLista, { host: TAILNET, extras: doProxy("dono@exemplo.test") })).status, 403);
});

test("tailnet: o login da lista da ordem ao Copiloto de outra maquina, e quem esta no notebook continua sem login", async t => {
  let rodadas = 0;
  const copiloto = { rodar: async () => { rodadas += 1; return { estado: "iniciado" }; } };
  const port = await abrir(t, { hosts: TAILNET, logins: "dono@exemplo.test, outro@x.test", copiloto });
  const ordem = { method: "POST", caminho: "/api/copiloto/rodar", body: {} };
  assert.equal((await pedir(port, { ...ordem, host: TAILNET, origin: `http://${TAILNET}`, extras: doProxy("dono@exemplo.test") })).status, 200);
  assert.equal((await pedir(port, { ...ordem, host: TAILNET, origin: `https://${TAILNET}`, extras: doProxy("outro@x.test") })).status, 200);
  assert.equal((await pedir(port, { ...ordem, origin: `http://127.0.0.1:${port}` })).status, 200);
  assert.equal((await pedir(port, { ...ordem, host: TAILNET, origin: `http://${TAILNET}`, extras: doProxy("visita@x.test") })).status, 403);
  assert.equal(rodadas, 3);
});

test("tailnet: a origem https do mesmo nome vale; a de outro nome, nao", () => {
  assert.equal(origemPermitida({ method: "POST", origin: `https://${TAILNET}`, host: TAILNET }), true);
  assert.equal(origemPermitida({ method: "POST", origin: `http://${TAILNET}`, host: TAILNET }), true);
  assert.equal(origemPermitida({ method: "POST", origin: "https://site.example", host: TAILNET }), false);
  assert.equal(pelaTailnet({ "x-forwarded-for": "100.64.0.2" }), true);
  assert.equal(pelaTailnet({ "tailscale-user-login": "dono@exemplo.test" }), true);
  assert.equal(pelaTailnet({ host: "127.0.0.1:8787" }), false);
});
