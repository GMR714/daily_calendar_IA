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
  // tarefa: responder com texto. O que ja foi respondido espera o ciclo do Copiloto: nenhum botao, so o aviso.
  function acoesDoItem(item) {
    if (!item || item.resposta) return [];
    if (item.tipo === "dar ok") return ["aprovar", "ajuste", "descartar"];
    return /^T-/.test(String(item.id || "")) ? ["responder"] : [];
  }
  function rotuloDaResposta(item) {
    const r = item && item.resposta;
    if (!r) return "";
    const feito = r.acao === "aprovar" ? "Aprovado" : r.acao === "descartar" ? "Descartado" : item.tipo === "dar ok" ? "Ajuste pedido" : "Respondido";
    return `${feito} ${r.origem === "dm" ? "na DM" : "na tela"} · espera o ciclo`;
  }
  // A nota da tarefa no Obsidian, onde esta o que decidir. So o esquema do Obsidian vira link.
  const linkObsidian = item => (item && /^obsidian:\/\/open\?/.test(String(item.obsidian || "")) ? item.obsidian : "");

  // Mapa de trabalho (29/10): cada projeto numa celula da grade, com as tarefas em orbita. Mais de `maxTarefas` vira
  // "+N" no lugar da ultima. O nome do projeto fica embaixo da orbita, dentro da celula.
  function layoutTrabalho(projetos, caixa, { maxTarefas = 10 } = {}) {
    const lista = projetos || [];
    if (!lista.length) return { celulas: [] };
    const cols = Math.max(1, Math.min(lista.length, Math.round(Math.sqrt((lista.length * caixa.w) / caixa.h))));
    const cw = caixa.w / cols, ch = caixa.h / Math.ceil(lista.length / cols);
    const rotulo = 30;
    const orbita = Math.max(18, Math.min(cw, ch - rotulo) / 2 - 12);
    const rTarefa = Math.max(4, Math.min(8, orbita / 6));
    return { celulas: lista.map((p, i) => {
      const x = caixa.x + ((i % cols) + 0.5) * cw;
      const y = caixa.y + (Math.floor(i / cols) + 0.5) * ch - rotulo / 2;
      const corte = p.tarefas.length > maxTarefas ? maxTarefas - 1 : p.tarefas.length;
      const vagas = p.tarefas.length > corte ? corte + 1 : corte;
      const ponto = k => {
        const a = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(vagas, 1);
        return { x: x + orbita * Math.cos(a), y: y + orbita * Math.sin(a) };
      };
      return {
        nome: p.nome, cor: p.cor, x, y, orbita, largura: cw, rotuloY: y + orbita + rTarefa + 16,
        r: Math.max(10, Math.min(orbita - rTarefa - 6, 10 + 1.5 * (p.abertas || p.tarefas.length))),
        tarefas: p.tarefas.slice(0, corte).map((t, k) => ({ id: t.id, titulo: t.titulo, status: t.status, cor: t.cor, pasta: t.pasta, r: rTarefa, ...ponto(k) })),
        mais: p.tarefas.length > corte ? { n: p.tarefas.length - corte, ...ponto(corte) } : null,
      };
    }) };
  }

  // Grafo de um projeto ou de uma tarefa (29/10), em camadas da esquerda para a direita: projeto → tarefas → sessoes →
  // subsessoes. Cada folha ganha uma faixa de altura e o pai fica no meio dos filhos; o rotulo vai a direita do no.
  const RAIO_NO = { projeto: 22, tarefa: 12, pasta: 12, sessao: 10, sub: 6, mais: 5 };
  function grafoDoItem(trabalho, alvo, caixa = { w: 1100, h: 660 }, { maxSub, maxTarefas = 14 } = {}) {
    if (!trabalho || !alvo) return null;
    const sessoes = trabalho.sessoes || {};
    const projetos = trabalho.projetos || [];
    const vistas = new Map();
    const chave = base => { const n = (vistas.get(base) || 0) + 1; vistas.set(base, n); return n > 1 ? `${base}#${n}` : base; };
    const mais = (id, n, oque) => ({ chave: chave(`mais:${id}`), tipo: "mais", id, rotulo: `+${n} ${oque}`, cor: "sem_sinal", filhos: [] });
    const noSessao = (s, limite) => {
      const sub = s.subsessoes || { total: 0, itens: [] };
      const mostradas = (sub.itens || []).slice(0, limite);
      const filhos = mostradas.map(x => ({ chave: chave(`sub:${s.sessao}:${x.id}`), tipo: "sub", id: x.id, sessao: s.sessao,
        rotulo: x.descricao || x.tipo || x.id, cor: x.cor, dica: x.estado, filhos: [] }));
      if ((sub.total || 0) > mostradas.length) filhos.push({ ...mais(s.sessao, sub.total - mostradas.length, "subsessões"), sessao: s.sessao });
      return { chave: chave(`sessao:${s.sessao}`), tipo: "sessao", id: s.sessao, sessao: s.sessao, rotulo: s.nome, cor: s.cor, dica: s.estado, filhos };
    };
    const noTarefa = (t, limite) => ({ chave: chave(`tarefa:${t.id}`), tipo: t.pasta ? "pasta" : "tarefa", id: t.id,
      rotulo: t.pasta ? `Sem tarefa · ${t.titulo}` : t.titulo, cor: t.cor, dica: t.pasta ? "sessões sem tarefa nesta pasta" : `${t.id} · ${t.status}`,
      filhos: t.sessoes.filter(sid => sessoes[sid]).map(sid => noSessao(sessoes[sid], limite)) });
    let raiz, titulo;
    if (alvo.tipo === "projeto") {
      const p = projetos.find(x => x.nome === alvo.id);
      if (!p) return null;
      const corte = p.tarefas.length > maxTarefas ? maxTarefas - 1 : p.tarefas.length;
      const filhos = p.tarefas.slice(0, corte).map(t => noTarefa(t, maxSub || 3));
      if (p.tarefas.length > corte) filhos.push(mais(p.nome, p.tarefas.length - corte, "tarefas"));
      raiz = { chave: chave(`projeto:${p.nome}`), tipo: "projeto", id: p.nome, rotulo: p.nome, cor: p.cor, filhos };
      titulo = p.nome;
    } else if (alvo.tipo === "tarefa") {
      const t = projetos.flatMap(p => p.tarefas).find(x => x.id === alvo.id);
      if (!t) return null;
      raiz = noTarefa(t, maxSub || 8);
      titulo = t.pasta ? `Sem tarefa · ${t.titulo}` : `${t.id} · ${t.titulo}`;
    } else return null;

    const altura = no => 1 + Math.max(0, ...no.filhos.map(altura));
    const folhas = no => (no.filhos.length ? no.filhos.reduce((n, f) => n + folhas(f), 0) : 1);
    const niveis = altura(raiz), margem = 40;
    const passo = (caixa.h - 2 * margem) / folhas(raiz);
    const colX = nivel => 60 + (nivel * (caixa.w - 320)) / Math.max(niveis - 1, 1);
    const nos = [], arestas = [];
    let vaga = 0;
    const posicionar = (no, nivel) => {
      const filhos = no.filhos.map(f => posicionar(f, nivel + 1));
      const y = filhos.length ? (filhos[0].y + filhos[filhos.length - 1].y) / 2 : margem + (vaga++ + 0.5) * passo;
      const item = { chave: no.chave, tipo: no.tipo, id: no.id, sessao: no.sessao || null, rotulo: no.rotulo, cor: no.cor, dica: no.dica || "",
        x: colX(nivel), y, r: Math.min(RAIO_NO[no.tipo], passo / 2), nivel };
      nos.push(item);
      for (const f of filhos) arestas.push({ de: item.chave, para: f.chave });
      return item;
    };
    posicionar(raiz, 0);
    return { titulo, tipo: alvo.tipo, nos, arestas };
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

  return { idade, medidorContexto, gruposAgentes, filtrar, posicaoNoDia, mudancas, semAcento, semMarkdown, legivel, acoesDoItem, rotuloDaResposta, linkObsidian,
    layoutTrabalho, grafoDoItem, agruparFalas, trechosDaFala, acoesDaSessao, escolherVoz, frasesParaFalar, juntarDitado, suporteDitado, erroDoDitado, ORDEM_COR };
});
