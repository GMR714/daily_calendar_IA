// Quem e esta maquina na tailnet (docs/specs/cockpit-pela-tailnet.md): o nome, os IPs e o login de quem esta logado no
// Tailscale aqui, lidos do `tailscale status --json`, sem configurar nada no .env.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { lerStatus, descobrirTailnet } = require("../tailnet");
const { createApp } = require("../server-runtime");

// recorte do `tailscale status --json`, com nomes de exemplo
const STATUS = {
  Self: { DNSName: "Notebook-1.tailnet-exemplo.ts.net.", HostName: "Notebook", UserID: 42, TailscaleIPs: ["100.64.0.1", "fd7a:115c:a1e0::1"] },
  User: { 42: { ID: 42, LoginName: "Dono@Exemplo.test" }, 7: { ID: 7, LoginName: "visita@exemplo.test" } },
  Peer: { x: { DNSName: "casa.tailnet-exemplo.ts.net.", UserID: 42 } }
};

test("tailnet: o nome, o nome curto, os IPs e o login de quem esta logado nesta maquina", () => {
  assert.deepEqual(lerStatus(STATUS), {
    hosts: ["notebook-1.tailnet-exemplo.ts.net", "notebook-1", "100.64.0.1", "[fd7a:115c:a1e0::1]"],
    logins: ["dono@exemplo.test"]
  });
  assert.deepEqual(lerStatus({}), { hosts: [], logins: [] });
  assert.deepEqual(lerStatus(null), { hosts: [], logins: [] });
  assert.deepEqual(lerStatus({ Self: { DNSName: "a.b.ts.net.", UserID: 9 }, User: {} }).logins, []);  // sem o dono, ninguem
});

test("tailnet: sem Tailscale, ou com ele desligado, nada muda", async () => {
  assert.deepEqual(await descobrirTailnet({ run: async () => JSON.stringify(STATUS) }), lerStatus(STATUS));
  assert.deepEqual(await descobrirTailnet({ run: async () => { throw new Error("ENOENT"); } }), { hosts: [], logins: [] });
  assert.deepEqual(await descobrirTailnet({ run: async () => "nao e json" }), { hosts: [], logins: [] });
  assert.deepEqual(await descobrirTailnet({ run: async () => JSON.stringify({ BackendState: "Stopped" }) }), { hosts: [], logins: [] });
});

test("tailnet: depois de descoberta, o dono entra pelo nome da maquina e a visita nao", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-tailnet-"));
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async () => ({ mode: "ai", entries: [] }) });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const port = app.server.address().port;
  const pedir = (host, login) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/state", headers: { Host: host, "X-Forwarded-For": "100.64.0.2", "Tailscale-User-Login": login } },
      res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject);
    req.end();
  });
  assert.equal(await pedir("notebook-1.tailnet-exemplo.ts.net", "dono@exemplo.test"), 403);  // antes de descobrir
  app.usarTailnet(lerStatus(STATUS));
  assert.equal(await pedir("notebook-1.tailnet-exemplo.ts.net", "dono@exemplo.test"), 200);
  assert.equal(await pedir("notebook-1", "dono@exemplo.test"), 200);
  assert.equal(await pedir("notebook-1.tailnet-exemplo.ts.net", "visita@exemplo.test"), 403);
});
