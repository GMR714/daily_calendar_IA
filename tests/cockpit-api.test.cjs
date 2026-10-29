const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server-runtime");
const Planner = require("../planner-core");

async function abrir(t, cockpit) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-cockpit-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }), cockpit });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  return { app, base: `http://127.0.0.1:${app.server.address().port}` };
}

test("cockpit: tela, arquivos, dados e item da fila levado para a agenda sem duplicar", async t => {
  let forcado = null;
  const cockpit = { get: async ({ force } = {}) => { forcado = force; return { dados: { placar: { atencao: 2 } }, lidoEm: "x", idadeSegundos: 0, atualizando: false, erro: null }; } };
  const { app, base } = await abrir(t, cockpit);
  assert.match(await (await fetch(base + "/cockpit")).text(), /<title>Cockpit da IA<\/title>/);
  for (const [arquivo, tipo] of [["/cockpit.js", /javascript/], ["/cockpit.css", /css/], ["/cockpit-view.js", /javascript/]]) {
    const resposta = await fetch(base + arquivo);
    assert.equal(resposta.status, 200, arquivo);
    assert.match(resposta.headers.get("content-type"), tipo);
  }
  const api = await (await fetch(base + "/api/cockpit?force=1")).json();
  assert.equal(api.dados.placar.atencao, 2);
  assert.equal(forcado, true);
  // o menu lateral (tests/nav-rail.test.cjs) leva da agenda ao cockpit e volta; as duas paginas carregam o mesmo menu
  for (const pagina of ["/", "/cockpit"]) {
    const html = await (await fetch(base + pagina)).text();
    assert.match(html, /<nav id="rail"/, pagina);
    assert.match(html, /nav-rail\.js/, pagina);
  }
  for (const [arquivo, tipo] of [["/nav-rail.js", /javascript/], ["/nav-rail.css", /css/], ["/agenda-layout.js", /javascript/]]) {
    const resposta = await fetch(base + arquivo);
    assert.equal(resposta.status, 200, arquivo);
    assert.match(resposta.headers.get("content-type"), tipo);
  }

  const post = body => fetch(base + "/api/cockpit/agenda", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async resposta => ({ status: resposta.status, body: await resposta.json() }));
  const primeiro = await post({ id: "R-03", titulo: "Dar ok no R-03 (acessos)", texto: "Os acessos que precisei", tipo: "dar ok" });
  assert.equal(primeiro.status, 200);
  assert.equal(primeiro.body.created, true);
  const entrada = app.store.read().entries.find(e => e.fingerprint === "cockpit::R-03");
  assert.equal(entrada.type, "task");
  assert.equal(entrada.source, "cockpit");
  assert.equal(entrada.priority, 3);
  assert.equal(entrada.duration, 30);
  assert.equal(entrada.deadline, Planner.dateKey(new Date()));
  assert.equal(entrada.text, "Dar ok no R-03 (acessos)");
  assert.equal(entrada.context, "Os acessos que precisei");
  const repetido = await post({ id: "R-03", titulo: "Dar ok no R-03 (acessos)" });
  assert.equal(repetido.body.alreadyExists, true);
  assert.equal(app.store.read().entries.filter(e => e.fingerprint === "cockpit::R-03").length, 1);
  assert.equal((await post({ id: "", titulo: "" })).status, 400);
});

test("cockpit fora do ar responde 503 com a mensagem para a tela", async t => {
  const cockpit = { get: async () => { throw Object.assign(new Error("Copiloto sem o comando cockpit"), { status: 503 }); } };
  const { base } = await abrir(t, cockpit);
  const resposta = await fetch(base + "/api/cockpit");
  assert.equal(resposta.status, 503);
  assert.equal((await resposta.json()).error, "Copiloto sem o comando cockpit");
});
