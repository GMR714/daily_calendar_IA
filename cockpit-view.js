// Regras da tela do Cockpit da IA que valem no navegador e nos testes (mesmo esquema do planner-core.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CockpitView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CONTEXTO_TETO = 600000;
  const ORDEM_COR = { problema: 0, atencao: 1, bem: 2, sem_sinal: 3 };
  const GRUPOS = [
    { chave: "voce", titulo: "Precisam de você", cores: ["problema", "atencao"] },
    { chave: "trabalhando", titulo: "Trabalhando", cores: ["bem"] },
    { chave: "parados", titulo: "Parados", cores: ["sem_sinal"] }
  ];

  function idade(segundos) {
    const s = Math.max(0, Math.round(Number(segundos) || 0));
    if (s < 10) return "agora";
    if (s < 60) return `há ${s} s`;
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    return `há ${Math.round(s / 3600)} h`;
  }

  function medidorContexto(tokens) {
    if (tokens === null || tokens === undefined || Number.isNaN(Number(tokens))) return { pct: 0, cor: "sem_sinal", rotulo: "sem dado" };
    const n = Number(tokens);
    return {
      pct: Math.min(100, Math.round((n / CONTEXTO_TETO) * 100)),
      cor: n < 200000 ? "bem" : n < 500000 ? "atencao" : "problema",
      rotulo: n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n)
    };
  }

  function gruposAgentes(agentes) {
    return GRUPOS.map(g => ({
      chave: g.chave, titulo: g.titulo,
      itens: (agentes || []).filter(a => g.cores.includes(a.cor)).sort((x, y) => ORDEM_COR[x.cor] - ORDEM_COR[y.cor])
    }));
  }

  const semAcento = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // As falas do Claude chegam com markdown (negrito, crase, link, titulo); na tela vira texto corrido.
  // O que esta entre crases sai como esta: `__main__.py` nao pode virar main.py.
  function semMarkdown(texto) {
    const codigos = [];
    return String(texto || "")
      .replace(/`([^`]*)`/g, (_, codigo) => `\u0000${codigos.push(codigo) - 1}\u0000`)
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/(^|\s)#{2,6}\s+/g, "$1")
      .replace(/\u0000(\d+)\u0000/g, (_, i) => codigos[i])
      .replace(/\s+/g, " ")
      .trim();
  }

  const CAMPOS_FALADOS = ["agora", "pedido", "ultimo_pedido", "titulo", "texto"];
  function limparFalas(item) {
    const saida = { ...item };
    for (const campo of CAMPOS_FALADOS) if (typeof saida[campo] === "string") saida[campo] = semMarkdown(saida[campo]);
    return saida;
  }

  // Copia dos dados do Copiloto com as falas ja legiveis (agentes, Hoje e fila Voce).
  function legivel(dados) {
    if (!dados) return dados;
    const saida = { ...dados };
    if (Array.isArray(dados.agentes)) saida.agentes = dados.agentes.map(limparFalas);
    if (Array.isArray(dados.hoje)) saida.hoje = dados.hoje.map(limparFalas);
    if (dados.voce && Array.isArray(dados.voce.itens)) saida.voce = { ...dados.voce, itens: dados.voce.itens.map(limparFalas) };
    return saida;
  }
  const corDaFila = item => (item.velho ? "atencao" : "bem");

  function filtrar(dados, { busca = "", cor = null, segmento = null } = {}) {
    const termo = semAcento(busca).trim();
    const casa = (...campos) => !termo || campos.some(campo => semAcento(campo).includes(termo));
    return {
      agentes: (dados.agentes || []).filter(a => (!cor || a.cor === cor) && casa(a.nome, a.agora, a.pedido, a.frente, a.estado)),
      rotinas: (dados.rotinas || []).filter(r => (!cor || r.cor === cor) && (!segmento || r.segmento === segmento) && casa(r.nome, r.segmento, r.texto)),
      voce: ((dados.voce && dados.voce.itens) || []).filter(i => (!cor || corDaFila(i) === cor) && casa(i.id, i.titulo, i.texto, i.tipo))
    };
  }

  function posicaoNoDia(iso, dia) {
    if (!iso || !dia) return null;
    const quando = new Date(String(iso).length === 16 ? `${iso}:00` : iso);
    const inicio = new Date(`${dia}T00:00:00`);
    const pct = ((quando - inicio) / 86400000) * 100;
    return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? Math.round(pct * 10) / 10 : null;
  }

  function mudancas(antes, depois) {
    const textos = [];
    const destaques = new Set();
    if (!antes || !depois) return { textos, destaques };
    const antigos = new Map((antes.agentes || []).map(a => [a.id, a]));
    const novos = new Map((depois.agentes || []).map(a => [a.id, a]));
    for (const [id, a] of novos) {
      const velho = antigos.get(id);
      if (!velho) { textos.push(`${a.nome} começou`); destaques.add(id); }
      else if (velho.estado !== a.estado) { textos.push(`${a.nome}: ${velho.estado} → ${a.estado}`); destaques.add(id); }
    }
    for (const [id, a] of antigos) if (!novos.has(id)) textos.push(`${a.nome} saiu`);
    const rotinasAntes = new Map((antes.rotinas || []).map(r => [r.nome, r]));
    for (const r of depois.rotinas || []) {
      const velha = rotinasAntes.get(r.nome);
      if (velha && velha.cor !== r.cor) { textos.push(`${r.nome}: ${velha.texto} → ${r.texto}`); destaques.add(`rotina:${r.nome}`); }
    }
    const totalAntes = antes.voce && antes.voce.total, totalDepois = depois.voce && depois.voce.total;
    if (Number.isInteger(totalAntes) && Number.isInteger(totalDepois) && totalAntes !== totalDepois) textos.push(`Fila Você: ${totalAntes} → ${totalDepois}`);
    return { textos, destaques };
  }

  // Botoes da gaveta de cada item da fila Voce. Rascunho: aprovar (sai em nome do Gabriel), pedir ajuste ou descartar;
  // tarefa: responder com texto ou excluir (fica descartada no vault). O que ja foi respondido espera o ciclo do
  // Copiloto: nenhum botao, so o aviso.
  function acoesDoItem(item) {
    if (!item || item.resposta) return [];
    if (item.tipo === "dar ok") return ["aprovar", "ajuste", "descartar"];
    return /^T-/.test(String(item.id || "")) ? ["responder", "excluir"] : [];
  }
  // A releitura do cockpit leva alguns segundos e pode trazer a leitura de antes: ate o Copiloto mostrar a tarefa
  // fechada, ela sai da fila e fica fechada no Mapa (some, se nao tem sessao viva). `pendentes` e o que ainda falta
  // o Copiloto confirmar. O rascunho ligado a tarefa fica: ele descarta a parte.
  function semExcluidas(dados, ids) {
    if (!dados || !ids || !ids.size) return { dados, pendentes: new Set() };
    const pendentes = new Set();
    const voce = dados.voce || { total: 0, itens: [] };
    const itens = (voce.itens || []).filter(i => {
      const sai = ids.has(i.id) && /^T-/.test(i.id);
      if (sai) pendentes.add(i.id);
      return !sai;
    });
    const t = dados.trabalho || { projetos: [], sessoes: {} };
    const viva = sid => Boolean(((t.sessoes || {})[sid] || {}).viva);
    const abertas = lista => lista.filter(x => x.aberta).length;
    const projetos = (t.projetos || []).map(p => {
      if (!p.tarefas.some(x => ids.has(x.id) && x.aberta)) return p;
      const tarefas = p.tarefas.flatMap(x => {
        if (!ids.has(x.id) || !x.aberta) return [x];
        pendentes.add(x.id);
        return (x.sessoes || []).some(viva) ? [{ ...x, aberta: false, status: "descartada" }] : [];
      });
      return { ...p, tarefas, abertas: Math.max(0, (p.abertas || 0) - (abertas(p.tarefas) - abertas(tarefas))) };
    });
    return { dados: { ...dados, voce: { ...voce, itens, total: Math.max(0, (voce.total || 0) - ((voce.itens || []).length - itens.length)) },
      trabalho: { ...t, projetos } }, pendentes };
  }
  // Rotinas recolhida (30/10): o selo da faixa mostra a pior cor, para um erro nao passar despercebido.
  function resumoRotinas(rotinas) {
    const lista = Array.from(rotinas || []);
    const n = cor => lista.filter(r => r.cor === cor).length;
    if (n("problema")) return { cor: "problema", texto: `${n("problema")} erro` };
    if (n("atencao")) return { cor: "atencao", texto: `${n("atencao")} atenção` };
    return n("bem") ? { cor: "bem", texto: `${n("bem")} ok` } : { cor: "sem_sinal", texto: "nenhuma" };
  }
  // A sessao de uma tarefa excluida continua: o aviso diz qual, para ele parar pela gaveta dela se quiser.
  function avisoDaExclusao(vivas) {
    const nomes = Array.from(vivas || []);
    const base = "Tarefa excluída: fica no vault como descartada.";
    if (!nomes.length) return base;
    if (nomes.length === 1) return `${base} A sessão ${nomes[0]} continua; o Parar está na gaveta dela.`;
    return `${base} As sessões ${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]} continuam; o Parar está na gaveta de cada uma.`;
  }
  // A resposta pela tela pede o ciclo sozinha, 1 min depois (30/10): no primeiro minuto e meio, o rotulo diz isso.
  // A da DM so entra no ciclo de 30 em 30 min. `em` e a hora local que o Copiloto grava.
  function rotuloDaResposta(item, agora = Date.now()) {
    const r = item && item.resposta;
    if (!r) return "";
    const feito = r.acao === "aprovar" ? "Aprovado" : r.acao === "descartar" ? "Descartado" : item.tipo === "dar ok" ? "Ajuste pedido" : "Respondido";
    const logo = r.origem !== "dm" && agora - Date.parse(r.em) < 90000;
    return `${feito} ${r.origem === "dm" ? "na DM" : "na tela"} · ${logo ? "ciclo em ~1 min" : "espera o ciclo"}`;
  }
  // A nota da tarefa no Obsidian, onde esta o que decidir. So o esquema do Obsidian vira link.
  const linkObsidian = item => (item && /^obsidian:\/\/open\?/.test(String(item.obsidian || "")) ? item.obsidian : "");
  // "Failed to fetch" (Chrome), "NetworkError..." (Firefox) e "Load failed" (Safari) sao o navegador sem resposta do
  // servidor da agenda: a janela do iniciar.cmd fechou. Qualquer outro erro segue com o texto dele.
  function mensagemDeFalha(erro) {
    const texto = String((erro && erro.message) || erro || "");
    if (/^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed)$/i.test(texto.trim())) {
      return "O servidor da agenda não está respondendo. Abra o iniciar.cmd e deixe a janela preta aberta; a tela volta sozinha em até 30 s.";
    }
    return texto || "Erro desconhecido.";
  }

  // Historia da tarefa (30/10): o cartao do passo mostra as frases inteiras que cabem em `limite`, sem marcacao nem
  // link; uma frase so, maior que o limite, e cortada com "…". O texto inteiro fica na gaveta do passo. A hora que o
  // Registro repete no comeco ("29/10 19h01: ...", "29/10 16:3x · ...") ja esta no topo do cartao e sai.
  const HORA_NO_COMECO = /^\d{2}\/\d{2}\s+~?\d{1,2}[h:]\d{0,2}x?\s*[:·,–-]\s*/;
  function resumoDoPasso(texto, limite = 220) {
    let limpo = semMarkdown(texto).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().replace(/\s*[:;,]+$/, "");
    if (HORA_NO_COMECO.test(limpo)) {
      limpo = limpo.replace(HORA_NO_COMECO, "");
      limpo = limpo.charAt(0).toUpperCase() + limpo.slice(1);
    }
    const frases = limpo.split(/(?<=[.!?…])\s+/);
    let saida = frases[0] || "";
    if (saida.length > limite) {
      const corte = saida.slice(0, limite - 1), espaco = corte.lastIndexOf(" ");
      return `${(espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
    }
    for (const f of frases.slice(1)) {
      if (saida.length + 1 + f.length > limite) break;
      saida += ` ${f}`;
    }
    return saida;
  }
  // Os passos que aparecem: sem `inicio`, os ultimos que cabem (onde a tarefa esta); com ele, a partir dali.
  function fatiaDaHistoria(total, inicio, cabem) {
    const n = Math.max(0, Math.floor(Number(total) || 0)), vagas = Math.max(1, Math.floor(Number(cabem) || 0));
    const ultimo = Math.max(0, n - vagas);
    const de = inicio === null || inicio === undefined ? ultimo : Math.min(Math.max(0, Math.floor(Number(inicio) || 0)), ultimo);
    const ate = Math.min(n, de + vagas);
    return { de, ate, antes: de, depois: n - ate };
  }
  // Cada sessao da tarefa fica pendurada no primeiro passo que cita o id dela (o Registro cita o id curto, de 8
  // letras); a que nenhum passo cita fica no Agora.
  function sessoesNosPassos(passos, sessoes) {
    const porPasso = {}, noAgora = [];
    for (const s of sessoes || []) {
      const ids = [s.id, s.sessao].filter(x => String(x || "").length >= 8);
      const i = (passos || []).findIndex(p => ids.some(id => String(p.texto || "").includes(id)));
      if (i < 0) noAgora.push(s);
      else (porPasso[i] = porPasso[i] || []).push(s);
    }
    return { porPasso, noAgora };
  }
  // aguardando (30/10, ADR 020 do copiloto): PR, rascunho ou terceiro que o Copiloto acompanha, fora da fila Voce
  const AGORA = { voce: { rotulo: "Precisa de você", cor: "atencao" }, travada: { rotulo: "Travada", cor: "problema" },
    trabalhando: { rotulo: "Trabalhando", cor: "bem" }, fila: { rotulo: "Na fila do Copiloto", cor: "sem_sinal" }, fechada: { rotulo: "Fechada", cor: "sem_sinal" },
    aguardando: { rotulo: "Esperando resposta de fora", cor: "sem_sinal" } };
  function agoraDaHistoria(agora) {
    const tipo = agora && agora.tipo;
    return { ...(Object.prototype.hasOwnProperty.call(AGORA, tipo) ? AGORA[tipo] : { rotulo: "Agora", cor: "sem_sinal" }) };
  }

  // Mapa em arvore (02/11, docs/specs/mapa-arvore.md): de cima para baixo, projeto → tarefas → historia e sessoes. A
  // busca e o semaforo escondem as tarefas que nao batem; com busca, o projeto que tem tarefa achada ja vem aberto.
  const ROTULO_STATUS = { "aguardando-voce": "espera você", aguardando: "espera de fora", bloqueada: "travada", "em-execucao": "trabalhando",
    pronta: "na fila", nova: "nova", feita: "feita", descartada: "descartada" };
  function arvoreDoMapa(trabalho, { busca = "", cor = null } = {}) {
    if (!trabalho) return null;
    const termo = semAcento(busca).trim();
    const sessoes = trabalho.sessoes || {};
    const projetos = [];
    for (const p of trabalho.projetos || []) {
      const peloNome = Boolean(termo) && semAcento(p.nome).includes(termo);
      const tarefas = [];
      for (const t of p.tarefas || []) {
        const achada = !termo || peloNome || [t.id, t.titulo].some(c => semAcento(c).includes(termo));
        if (!achada || (cor && t.cor !== cor)) continue;
        const delas = (t.sessoes || []).map(sid => sessoes[sid]).filter(Boolean);
        const aberta = t.aberta !== false;
        const precisa = aberta && !t.pasta && (t.cor === "atencao" || t.cor === "problema");
        const rotulo = ROTULO_STATUS[t.status] || t.status || "";
        // o selo diz o que ele tem de fazer; o estado ao lado so aparece quando diz mais que o selo
        const selo = !precisa ? "" : t.cor === "problema" ? "travada" : "precisa de você";
        const repete = (selo === "precisa de você" && t.status === "aguardando-voce") || (selo === "travada" && t.status === "bloqueada");
        tarefas.push({ id: t.id, titulo: t.titulo || t.id, status: t.status || "", rotulo, selo, estado: repete ? "" : rotulo,
          cor: t.cor || "sem_sinal", passos: Number(t.passos) || 0, pasta: Boolean(t.pasta), aberta, precisa,
          vivas: delas.filter(x => x.viva).length, sessoes: delas, obsidian: t.obsidian || "" });
      }
      if (!tarefas.length) continue;
      projetos.push({ nome: p.nome, cor: p.cor || "sem_sinal", abertas: Number(p.abertas) || 0, sessoes: Number(p.sessoes) || 0,
        vivas: Number(p.vivas) || 0, semTarefa: p.nome === "Sem tarefa", precisa: tarefas.filter(t => t.precisa).length,
        pelaBusca: Boolean(termo), tarefas });
    }
    return { projetos, total: projetos.reduce((n, p) => n + p.tarefas.length, 0) };
  }
  // Um projeto, uma tarefa e uma sessao abertos por vez (02/11): abrir outro fecha o anterior, para caber em 1536x730.
  const FECHADO = { projeto: null, tarefa: null, sessao: null };
  function alternarNoMapa(aberto, alvo) {
    const a = { ...FECHADO, ...(aberto || {}) };
    if (!alvo) return a;
    if (alvo.tipo === "projeto") return a.projeto === alvo.id ? { ...FECHADO } : { ...FECHADO, projeto: alvo.id };
    if (alvo.tipo === "tarefa") return a.tarefa === alvo.id ? { ...a, tarefa: null, sessao: null } : { projeto: alvo.projeto || a.projeto, tarefa: alvo.id, sessao: null };
    if (alvo.tipo === "sessao") return { ...a, sessao: a.sessao === alvo.id ? null : alvo.id };
    return a;
  }
  // Esc fecha o que abriu por ultimo: a sessao, depois a tarefa, depois o projeto; null quando nada estava aberto.
  function fecharNoMapa(aberto) {
    const a = { ...FECHADO, ...(aberto || {}) };
    if (a.sessao) return { ...a, sessao: null };
    if (a.tarefa) return { ...a, tarefa: null };
    if (a.projeto) return { ...FECHADO };
    return null;
  }
  // "Ver a historia da tarefa" (gaveta): o projeto e a tarefa abertos; null se ela nao esta no Mapa.
  function abrirNoMapa(trabalho, id) {
    const p = ((trabalho && trabalho.projetos) || []).find(x => (x.tarefas || []).some(t => t.id === id));
    return p ? { projeto: p.nome, tarefa: id, sessao: null } : null;
  }

  // Ferramentas seguidas viram um item so na conversa (29/10): 6 em cada 10 linhas de uma sessao sao ferramenta.
  function agruparFalas(falas) {
    const saida = [];
    for (const f of falas || []) {
      const ultimo = saida[saida.length - 1];
      if (f.quem === "ferramenta" && ultimo && ultimo.quem === "ferramentas") ultimo.itens.push(f);
      else if (f.quem === "ferramenta" && ultimo && ultimo.quem === "ferramenta") saida[saida.length - 1] = { quem: "ferramentas", hora: ultimo.hora, itens: [ultimo, f] };
      else saida.push(f);
    }
    return saida.map(x => (x.quem === "ferramentas" ? { ...x, texto: `${x.itens.length} ferramentas` } : x));
  }

  // Markdown leve da conversa (29/10): titulo e negrito, codigo e link http(s) viram trechos; o resto fica como texto.
  // A tela monta cada trecho como texto, <b>, <code> ou <a>: nada dos dados vira HTML.
  function trechosDaFala(texto) {
    const s = String(texto || "").replace(/^#{1,6}[ \t]+(.+)$/gm, "**$1**");
    const re = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>"]+)/g;
    const saida = [];
    const solto = t => { if (t) saida.push({ tipo: "texto", texto: t }); };
    let ultimo = 0, m;
    while ((m = re.exec(s))) {
      solto(s.slice(ultimo, m.index));
      if (m[1] !== undefined) saida.push({ tipo: "negrito", texto: m[1] });
      else if (m[2] !== undefined) saida.push({ tipo: "codigo", texto: m[2] });
      else if (m[3] !== undefined) saida.push({ tipo: "link", texto: m[3], href: m[4] });
      else {
        const url = m[5].replace(/[.,;:!?]+$/, "");
        saida.push({ tipo: "link", texto: url, href: url });
        solto(m[5].slice(url.length));
      }
      ultimo = re.lastIndex;
    }
    solto(s.slice(ultimo));
    return saida;
  }

  // O que a gaveta da sessao oferece (entrega 2): sessao de terminal so se le; trabalhando, a resposta espera ela parar;
  // com o processo vivo, da para parar (a conversa fica e a resposta seguinte a retoma).
  function acoesDaSessao(s) {
    if (!s) return { pode: false, motivo: "", enviar: "", parar: false, fila: 0 };
    if (s.tipo === "interativa") return { pode: false, motivo: "Aberta num terminal: responda por lá.", enviar: "", parar: false, fila: 0 };
    return { pode: true, motivo: "", enviar: s.estado === "trabalhando" ? "Mandar quando parar" : "Enviar", parar: Boolean(s.viva), fila: s.na_fila || 0 };
  }

  // Ouvir (entrega 3): a voz pt-BR do navegador. A natural do Edge soa melhor; depois a do Google; depois qualquer pt.
  function escolherVoz(vozes) {
    const lista = Array.from(vozes || []);
    const lingua = v => String(v.lang || "").replace("_", "-").toLowerCase();
    const br = lista.filter(v => lingua(v) === "pt-br");
    return br.find(v => /natural/i.test(v.name)) || br.find(v => /google/i.test(v.name)) || br[0]
      || lista.find(v => lingua(v).startsWith("pt")) || null;
  }
  // Uma fala por frase: a voz do Google no Chrome para no meio de falas longas (~15 s).
  function frasesParaFalar(texto) {
    return String(texto || "").split(/(?<=[.!?…])\s+/).map(f => f.trim()).filter(Boolean);
  }

  // Ditar: o texto ditado (final e provisorio) entra depois do que ja estava na caixa. Nada e enviado sozinho.
  function juntarDitado(base, partes) {
    return [String(base || "").trim(), ...Array.from(partes || [], p => String(p || "").trim())].filter(Boolean).join(" ");
  }
  function suporteDitado(janela) {
    return (janela && (janela.SpeechRecognition || janela.webkitSpeechRecognition)) || null;
  }
  function erroDoDitado(codigo) {
    if (codigo === "aborted") return "";
    if (["not-allowed", "service-not-allowed", "audio-capture"].includes(codigo)) return "O ditado não conseguiu usar o microfone. Libere o microfone para esta página no cadeado da barra de endereço.";
    if (codigo === "no-speech") return "Não ouvi nada. Clique em Ditar e fale de novo.";
    if (codigo === "network") return "O ditado precisa de internet: o navegador manda o áudio para o serviço de voz dele.";
    return `O ditado parou (${codigo}).`;
  }

  return { idade, medidorContexto, gruposAgentes, filtrar, posicaoNoDia, mudancas, semAcento, semMarkdown, legivel, acoesDoItem, avisoDaExclusao, semExcluidas, resumoRotinas, rotuloDaResposta, linkObsidian,
    resumoDoPasso, fatiaDaHistoria, sessoesNosPassos, agoraDaHistoria, arvoreDoMapa, alternarNoMapa, fecharNoMapa, abrirNoMapa, agruparFalas, trechosDaFala, acoesDaSessao, mensagemDeFalha, escolherVoz, frasesParaFalar, juntarDitado, suporteDitado, erroDoDitado, ORDEM_COR };
});
