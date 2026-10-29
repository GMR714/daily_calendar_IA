// Fonte do Cockpit da IA: roda o `cli.py cockpit --json` do Copiloto e guarda o resultado.
// O Copiloto leva ~10 s (agentes, Agendador, GitHub). A tela recebe na hora o ultimo dado
// lido e, se ele passou do prazo, a leitura nova acontece em segundo plano.
const { execFile } = require("node:child_process");

const DEFAULT_CLI = "C:\\Dev\\Dev Seazone\\copiloto\\cli.py";

function commandFor(env = process.env, platform = process.platform) {
  const cli = env.COCKPIT_CLI || DEFAULT_CLI;
  const python = env.COCKPIT_PYTHON || (platform === "win32" ? "py" : "python3");
  return { file: python, args: [...(python === "py" ? ["-3"] : []), cli, "cockpit", "--json"] };
}

function friendlyError(error) {
  const text = `${error?.stderr || ""} ${error?.message || ""}`;
  if (/invalid choice: 'cockpit'/i.test(text)) {
    return "O Copiloto instalado ainda nao tem o comando cockpit. Mescle o PR #5 do copiloto e rode git pull em C:\\Dev\\Dev Seazone\\copiloto (ou aponte COCKPIT_CLI no .env para a worktree).";
  }
  if (error?.code === "ENOENT") return "Nao achei o Python. Confira COCKPIT_PYTHON no .env (padrao: py -3).";
  if (/can't open file|No such file or directory/i.test(text)) return "Nao achei o cli.py do Copiloto. Confira COCKPIT_CLI no .env.";
  if (error?.killed || error?.signal) return "O Copiloto demorou demais para responder. Tente de novo em instantes.";
  const linha = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || "erro desconhecido";
  return `Nao consegui ler o Copiloto: ${linha.slice(0, 300)}`;
}

// O server.js define TZ=America/Sao_Paulo; no Windows o CRT do Python le esse nome como fuso
// desconhecido com horario de verao e adianta a hora. La o Python fica com o fuso do sistema.
function childEnv(env = process.env, platform = process.platform) {
  const saida = { ...env, PYTHONIOENCODING: "utf-8" };
  if (platform === "win32") delete saida.TZ;
  return saida;
}

function runCopiloto({ env = process.env, platform = process.platform, timeoutMs = 120000 } = {}) {
  const { file, args } = commandFor(env, platform);
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: childEnv(env, platform) },
      (error, stdout, stderr) => {
        if (error) return reject(Object.assign(error, { stderr: String(stderr || "") }));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(Object.assign(new Error("A resposta do Copiloto nao veio em JSON."), { stderr: String(stdout).slice(0, 300) })); }
      });
  });
}

function createCockpitSource({ run = () => runCopiloto(), ttlMs = 45000, now = () => Date.now() } = {}) {
  let cache = null;
  let erro = null;
  let emAndamento = null;
  function refresh() {
    emAndamento ||= Promise.resolve()
      .then(run)
      .then(dados => { cache = { dados, em: now() }; erro = null; return cache; },
        error => { erro = friendlyError(error); throw Object.assign(new Error(erro), { status: 503 }); })
      .finally(() => { emAndamento = null; });
    return emAndamento;
  }
  function view() {
    return { dados: cache.dados, lidoEm: new Date(cache.em).toISOString(), idadeSegundos: Math.round((now() - cache.em) / 1000),
      atualizando: Boolean(emAndamento), erro };
  }
  async function get({ force = false } = {}) {
    if (!cache || force) {
      try { await refresh(); }
      catch (error) { if (!cache) throw error; }
      return view();
    }
    if (now() - cache.em > ttlMs) refresh().catch(() => {});
    return view();
  }
  return { get, refresh };
}

module.exports = { createCockpitSource, commandFor, childEnv, friendlyError, runCopiloto, DEFAULT_CLI };
