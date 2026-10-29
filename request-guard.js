// Quem pode falar com a agenda. O servidor escuta so neste computador, mas um site aberto no
// navegador ainda alcanca 127.0.0.1 de dois jeitos: por DNS rebinding (um nome dele passa a
// apontar para ca, e o Host chega com esse nome) ou mandando um POST de outra origem.
// O Host barra o primeiro; a Origin, o segundo. Rotas que dao ordem a este computador
// (abrir o painel, falar com o Copiloto) aceitam so quem esta nele.
const NOMES_LOCAIS = ["localhost", "127.0.0.1", "[::1]"];
const ENDERECOS_LOCAIS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

function listaDeHosts(texto) {
  return String(texto || "").split(",").map(nome => nome.trim().toLowerCase()).filter(Boolean);
}

// So "nome" ou "[ipv6]", com porta opcional: nada de usuario@, caminho ou espaco.
function nomeDoHost(host) {
  const casou = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/.exec(String(host || "").trim().toLowerCase());
  return casou ? casou[1] : "";
}

function hostPermitido(host, extras = []) {
  const nome = nomeDoHost(host);
  return Boolean(nome) && (NOMES_LOCAIS.includes(nome) || extras.includes(nome));
}

function origemPermitida({ method, origin, host }) {
  if (method === "GET" || method === "HEAD" || !origin) return true;
  return origin === `http://${host}`;
}

function pedidoLocal(endereco) {
  return ENDERECOS_LOCAIS.includes(String(endereco || ""));
}

module.exports = { hostPermitido, origemPermitida, pedidoLocal, listaDeHosts };
