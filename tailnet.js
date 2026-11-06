// Quem e esta maquina na tailnet (docs/specs/cockpit-pela-tailnet.md). Com o `tailscale serve` levando a agenda a outra
// maquina, o servidor aceita o nome e os IPs desta maquina na tailnet e, pelo proxy, so o login de quem esta logado no
// Tailscale aqui: o dono dela. Tudo vem do `tailscale status --json` ao subir, sem configurar nada no .env.
const { execFile } = require("node:child_process");
const fs = require("node:fs");

const VAZIO = { hosts: [], logins: [] };

function lerStatus(status) {
  const self = (status && status.Self) || {};
  const nome = String(self.DNSName || "").replace(/\.$/, "").toLowerCase();
  if (!nome) return { hosts: [], logins: [] };
  const ips = (self.TailscaleIPs || []).map(ip => String(ip).toLowerCase()).map(ip => (ip.includes(":") ? `[${ip}]` : ip));
  const dono = ((status && status.User) || {})[String(self.UserID)] || {};
  const login = String(dono.LoginName || "").trim().toLowerCase();
  return { hosts: [nome, nome.split(".")[0], ...ips], logins: login ? [login] : [] };
}

function comandoTailscale(platform = process.platform) {
  const instalado = "C:\\Program Files\\Tailscale\\tailscale.exe";
  return platform === "win32" && fs.existsSync(instalado) ? instalado : "tailscale";
}

function rodarStatus() {
  return new Promise((resolve, reject) => {
    execFile(comandoTailscale(), ["status", "--json"], { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (erro, saida) => (erro ? reject(erro) : resolve(String(saida))));
  });
}

// Sem Tailscale, desligado ou com resposta estranha: nada muda, e pela tailnet ninguem entra.
async function descobrirTailnet({ run = rodarStatus } = {}) {
  try { return lerStatus(JSON.parse(await run())); }
  catch { return { ...VAZIO }; }
}

module.exports = { lerStatus, descobrirTailnet, comandoTailscale };
