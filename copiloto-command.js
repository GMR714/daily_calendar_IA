// Ordens da tela para o Copiloto. A tela nao manda mensagem nem mexe em tarefa: grava a resposta na
// caixa de entrada do Copiloto (`cli.py entrada gravar`), que o ciclo le pelo mesmo caminho do
// "ok R-NN" da DM. "Rodar agora" pede um ciclo (`cli.py ciclo agora`) sem derrubar o que estiver rodando.
// O texto vai pela entrada padrao, nunca pela linha de comando.
const { execFile } = require("node:child_process");
const { commandFor, childEnv } = require("./cockpit-source");

const ACOES = ["aprovar", "descartar", "responder"];
const LIMITE_TEXTO = 4000;

function validarResposta(body = {}) {
  const acao = String(body.acao || "");
  const item = String(body.item || "").trim();
  const texto = String(body.texto || "").trim();
  if (!ACOES.includes(acao)) throw Object.assign(new Error("Acao desconhecida."), { status: 400 });
  if (!/^[A-Z]{1,3}-[0-9A-Za-z-]{1,40}$/.test(item)) throw Object.assign(new Error("Item invalido."), { status: 400 });
  if (acao === "responder" && !texto) throw Object.assign(new Error("Escreva a resposta."), { status: 400 });
  if (texto.length > LIMITE_TEXTO) throw Object.assign(new Error("Resposta longa demais: ate 4 mil caracteres."), { status: 400 });
  return { acao, item, texto };
}

function erroDoComando(error) {
  const texto = `${error?.stderr || ""} ${error?.message || ""}`;
  if (/invalid choice: '(entrada|ciclo)'/i.test(texto)) {
    return "O Copiloto instalado ainda nao tem a caixa de entrada. Mescle o PR dela no copiloto e rode git pull em C:\\Dev\\Dev Seazone\\copiloto.";
  }
  if (error?.code === "ENOENT") return "Nao achei o Python. Confira COCKPIT_PYTHON no .env (padrao: py -3).";
  if (error?.killed || error?.signal) return "O Copiloto demorou demais para responder. Tente de novo em instantes.";
  const linha = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).pop() || "erro desconhecido";
  return `O Copiloto nao aceitou: ${linha.slice(0, 300)}`;
}

// O "rodar agora" sobe sessoes do Claude Code: uma chave de API do .env da agenda faria o ciclo cobrar pela API
// em vez da assinatura. Fora isso, o mesmo ambiente do cockpit (sem TZ, saida em UTF-8).
function envDoCopiloto(env = process.env, platform = process.platform) {
  return Object.fromEntries(Object.entries(childEnv(env, platform)).filter(([nome]) => !nome.startsWith("ANTHROPIC_")));
}

function runCli(argumentos, { entrada, env = process.env, platform = process.platform, timeoutMs = 60000 } = {}) {
  const { file, args } = commandFor(env, platform, argumentos);
  return new Promise((resolve, reject) => {
    const filho = execFile(file, args, { timeout: timeoutMs, windowsHide: true, env: envDoCopiloto(env, platform) }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(new Error(erroDoComando(Object.assign(error, { stderr: String(stderr || "") }))), { status: 503 }));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(Object.assign(new Error("A resposta do Copiloto nao veio em JSON."), { status: 503 })); }
    });
    filho.stdin.end(entrada === undefined ? "" : JSON.stringify(entrada));
  });
}

function createCopilotoCommands({ run = runCli } = {}) {
  return {
    responder: resposta => run(["entrada", "gravar"], { entrada: { ...resposta, origem: "tela" } }),
    rodar: () => run(["ciclo", "agora"]),
  };
}

module.exports = { createCopilotoCommands, validarResposta, erroDoComando, envDoCopiloto, runCli };
