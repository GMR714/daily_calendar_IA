const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Planner = require("./planner-core");
const { createStore } = require("./agenda-store");
const Overlay = require("./overlay-core");
const { createCockpitSource } = require("./cockpit-source");
const { hostPermitido, origemPermitida, pedidoLocal, listaDeHosts } = require("./request-guard");
const { execFile } = require("node:child_process");

// Botao "Cantinho": abre o painel flutuante (overlay.ps1) ligado a este servidor, como o duplo clique no
// iniciar-painel.cmd. O Start-Process da ao painel um console proprio, que o overlay.ps1 esconde: com
// `detached` o PowerShell sai na hora (fica sem console), e preso ao console do servidor ele esconderia a
// janela do iniciar.cmd. Os caminhos vao por variavel de ambiente porque podem ter espaco ("New project").
// O PID devolvido evita empilhar paineis a cada clique.
let painelPid = null;
const processoVivo = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function abrirPainelFlutuante({ serverUrl }) {
  if (process.platform !== "win32") throw Object.assign(new Error("O painel flutuante so existe no Windows."), { status: 501 });
  if (painelPid && processoVivo(painelPid)) return { jaAberto: true };
  const comando = "(Start-Process -FilePath powershell.exe -WorkingDirectory $env:PAINEL_DIR -PassThru -ArgumentList @('-Sta','-NoProfile','-ExecutionPolicy','Bypass','-File',([char]34 + $env:PAINEL_PS1 + [char]34),'-ServerUrl',$env:PAINEL_URL)).Id";
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", comando],
      { windowsHide: true, timeout: 20000, env: { ...process.env, PAINEL_DIR: __dirname, PAINEL_PS1: path.join(__dirname, "overlay.ps1"), PAINEL_URL: serverUrl } },
      (erro, saida) => {
        if (erro) return reject(Object.assign(new Error("Nao consegui abrir o painel flutuante."), { status: 500 }));
        painelPid = Number(String(saida).trim()) || null;
        resolve({ jaAberto: false });
      });
  });
}

function createApp({ interpret, aiStatus, cockpit, launchOverlay = abrirPainelFlutuante, file = process.env.AGENDA_DATA_FILE || path.join(__dirname, "agenda-data.json"), hosts = process.env.AGENDA_HOSTS }) {
  const store = createStore(file);
  const hostsExtras = listaDeHosts(hosts);
  const proposals = new Map();
  let cockpitSource = cockpit;
  const publicFiles = { "/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/styles.css": "styles.css", "/planner-core.js": "planner-core.js", "/product-ui.js": "product-ui.js", "/product.css": "product.css", "/checklist.js": "checklist.js",
    "/cockpit": "cockpit.html", "/cockpit.js": "cockpit.js", "/cockpit.css": "cockpit.css", "/cockpit-view.js": "cockpit-view.js",
    "/nav-rail.js": "nav-rail.js", "/nav-rail.css": "nav-rail.css", "/agenda-layout.js": "agenda-layout.js" };
  // Item da fila "Voce" do Copiloto vira tarefa de 30 min para hoje; a impressao digital evita duplicar.
  function cockpitParaAgenda(body) {
    const id = String(body.id || "").trim().slice(0, 80);
    const titulo = String(body.titulo || "").trim().slice(0, 200);
    if (!id || !titulo) throw Object.assign(new Error("Item sem identificacao ou titulo."), { status: 400 });
    const current = store.read();
    const fingerprint = `cockpit::${id}`;
    const existente = current.entries.find(entry => entry.fingerprint === fingerprint);
    if (existente) return { alreadyExists: true, entry: existente };
    const entry = { id: `cockpit-${randomUUID()}`, type: "task", source: "cockpit", text: titulo, context: String(body.texto || "").slice(0, 2000),
      duration: 30, priority: 3, deadline: Planner.dateKey(new Date()), fingerprint,
      origin: { area: "Copiloto", item: id, tipo: String(body.tipo || "").slice(0, 40) }, createdAt: new Date().toISOString() };
    const data = store.write({ ...current, entries: [...current.entries, entry] });
    return { created: true, entry, revision: data.revision };
  }
  async function propose(payload) {
    const current = store.read();
    if (!String(payload.message || "").trim()) throw new Error("Escreva uma mensagem.");
    if (payload.message.length > 24000) throw new Error("Divida a mensagem em partes de ate 24 mil caracteres.");
    const context = { goals: current.goals, entries: current.entries.filter(entry => !Planner.isSyncTask(entry)), recentReports: current.reports.slice(-10), preferences: current.preferences };
    const result = await interpret({ ...payload, context });
    if (result.mode !== "ai") throw new Error(result.message || "Ollama indisponivel. Sua agenda nao foi alterada.");
    const allowDelete = /\b(exclu|apag|remov|delet)/i.test(payload.message);
    const applied = Planner.applyInterpretation(current, result, { allowDelete });
    const today = Planner.dateKey(new Date());
    const preview = Planner.schedule(applied.data, { from: today, to: Planner.addDays(today, 7) });
    const id = randomUUID();
    for (const [key, item] of proposals) if (Date.now() - item.created > 1800000) proposals.delete(key);
    proposals.set(id, { created: Date.now(), revision: current.revision, data: applied.data, changes: applied.changes });
    return { ...result, proposalId: id, revision: current.revision, changes: applied.changes, warnings: preview.warnings, preview: preview.blocks };
  }
  function apply(id) {
    const proposal = proposals.get(id);
    if (!proposal || Date.now() - proposal.created > 1800000) throw Object.assign(new Error("Proposta expirada. Envie a mensagem novamente."), { status: 409 });
    if (proposal.applied) return { data: store.read(), changes: proposal.changes, alreadyApplied: true };
    if (store.read().revision !== proposal.revision) throw Object.assign(new Error("A agenda mudou depois desta proposta. Gere uma nova para preservar as alteracoes mais recentes."), { status: 409 });
    const data = store.write(proposal.data);
    proposal.applied = true;
    return { data, changes: proposal.changes };
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!hostPermitido(req.headers.host, hostsExtras)) return reply(res, 403, { error: "Endereco nao permitido. Abra a agenda por localhost ou 127.0.0.1, ou inclua o nome em AGENDA_HOSTS." });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!origemPermitida({ method: req.method, origin: req.headers.origin, host: req.headers.host })) return reply(res, 403, { error: "Origem nao permitida." });
      if (url.pathname === "/api/overlay/abrir" && !pedidoLocal(req.socket.remoteAddress)) return reply(res, 403, { error: "Esta acao so vale neste computador." });
      if (req.method === "GET" && publicFiles[url.pathname]) {
        const name = publicFiles[url.pathname];
        const type = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript" }[path.extname(name)];
        return reply(res, 200, fs.readFileSync(path.join(__dirname, name)), `${type};charset=utf-8`);
      }
      if (req.method === "GET" && url.pathname === "/api/state") return reply(res, 200, store.read());
      if (req.method === "GET" && url.pathname === "/api/cockpit") {
        cockpitSource ||= createCockpitSource();
        try { return reply(res, 200, await cockpitSource.get({ force: url.searchParams.get("force") === "1" })); }
        catch (error) { return reply(res, error.status || 503, { error: error.message }); }
      }
      if (req.method === "POST" && url.pathname === "/api/cockpit/agenda") return reply(res, 200, cockpitParaAgenda(await readJson(req)));
      if (req.method === "GET" && url.pathname === "/api/overlay") return reply(res, 200, Overlay.checklist(store.read()));
      if (req.method === "POST" && url.pathname === "/api/overlay/abrir") {
        await readJson(req);
        const aberto = await launchOverlay({ serverUrl: `http://127.0.0.1:${req.socket.localPort}` });
        return reply(res, 200, { ok: true, jaAberto: Boolean(aberto && aberto.jaAberto) });
      }
      if (req.method === "GET" && url.pathname === "/api/status") {
        if (aiStatus) {
          const ai = await aiStatus();
          return reply(res, 200, { ...ai, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_CHAT_ID && process.env.TELEGRAM_POLLING !== "false"), revision: store.read().revision });
        }
        let ai = false;
        try {
          const headers = process.env.OLLAMA_API_KEY ? { Authorization: `Bearer ${process.env.OLLAMA_API_KEY}` } : {};
          const response = await fetch(`${(process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "")}/api/tags`, { headers, signal: AbortSignal.timeout(3000) });
          ai = response.ok;
        } catch {}
        return reply(res, 200, { ai, model: process.env.OLLAMA_MODEL || "gemma4:31b-cloud", defaultProvider: "ollama", providers: { ollama: { configured: true, available: ai, model: process.env.OLLAMA_MODEL || "gemma4:31b-cloud" }, claude: { configured: false, available: false, model: "claude-sonnet-5" } }, telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ALLOWED_CHAT_ID && process.env.TELEGRAM_POLLING !== "false"), revision: store.read().revision });
      }
      if (req.method === "GET" && url.pathname === "/api/plan") {
        const from = url.searchParams.get("from") || Planner.dateKey(new Date());
        const to = url.searchParams.get("to") || Planner.addDays(from, 7);
        if (!Planner.validDate(from) || !Planner.validDate(to) || to <= from || (+new Date(to) - +new Date(from)) / 86400000 > 366) throw new Error("Periodo invalido (maximo de um ano).");
        return reply(res, 200, Planner.schedule(store.read(), { from, to }));
      }
      if (req.method === "POST" && url.pathname === "/api/state/merge") {
        const body = await readJson(req);
        if (!body.base || !body.incoming) return reply(res, 409, { error: "Atualize a pagina para usar a sincronizacao protegida." });
        const result = store.merge(body.base, body.incoming);
        return reply(res, result.conflicts.length ? 409 : 200, result);
      }
      if (req.method === "POST" && url.pathname === "/api/interpret") return reply(res, 200, await propose(await readJson(req)));
      if (req.method === "POST" && url.pathname === "/api/overlay/complete") {
        const result = Overlay.complete(store.read(), await readJson(req));
        const data = result.alreadyCompleted ? store.read() : store.write(result.data);
        return reply(res, 200, { ...result, data: undefined, revision: data.revision });
      }
      const match = /^\/api\/proposals\/([a-f0-9-]+)\/apply$/.exec(url.pathname);
      if (req.method === "POST" && match) { await readJson(req); return reply(res, 200, apply(match[1])); }
      return reply(res, 404, { error: "Rota inexistente." });
    } catch (error) { reply(res, error.status || 400, { error: error.message || "Nao foi possivel concluir. Nenhum dado foi apagado." }); }
  });
  return { server, store, propose, apply, file };
}
function reply(res, status, payload, type = "application/json;charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  res.end(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw Object.assign(new Error("Mensagem muito grande."), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("JSON invalido."); }
}
module.exports = { createApp };
