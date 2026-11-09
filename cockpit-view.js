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

  // Mapa de bolas (30/10, docs/specs/mapa-historia.md): cada tarefa e uma bola. O raio cresce com os passos do
  // Registro, com as sessoes vivas e quando ela precisa dele; a pseudotarefa das sessoes sem tarefa fica menor.
  function raioDaTarefa(t, vivas = 0) {
    if (t && t.pasta) return Math.min(29, 22 + 2 * (t.sessoes || []).length);
    const passos = Math.max(0, Number(t && t.passos) || 0);
    const precisa = t && (t.cor === "atencao" || t.cor === "problema") ? 8 : 0;
    return Math.min(84, Math.round(30 + 6 * Math.sqrt(passos) + precisa + 5 * Math.min(2, Number(vivas) || 0)));
  }

  // Cada circulo entra no lugar livre mais perto do centro, encostado num ja posto (36 angulos em volta de cada um):
  // nada se sobrepoe e os mesmos dados dao sempre o mesmo desenho. `aspecto` > 1 barateia a distancia na horizontal.
  function empacotar(circulos, folga, aspecto = 1) {
    const postos = [];
    const livre = (x, y, r) => postos.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + r + folga - 1e-6);
    for (const c of circulos) {
      let melhor = postos.length ? null : { x: 0, y: 0 };
      for (const p of postos) {
        const d = p.r + c.r + folga;
        for (let k = 0; k < 36; k++) {
          const x = p.x + d * Math.cos((Math.PI * k) / 18), y = p.y + d * Math.sin((Math.PI * k) / 18);
          const custo = (x / aspecto) ** 2 + y ** 2;
          if ((!melhor || custo < melhor.custo) && livre(x, y, c.r)) melhor = { x, y, custo };
        }
      }
      if (!melhor) melhor = { x: Math.max(...postos.map(p => p.x + p.r)) + folga + c.r, y: 0 };  // a direita de tudo, sempre livre
      postos.push({ ...c, x: melhor.x, y: melhor.y });
    }
    return postos;
  }

  // As bolas de cada projeto formam um cacho; os cachos se arrumam do centro para fora (o projeto mais urgente, que vem
  // primeiro, no meio). Tudo cresce ou encolhe por igual para caber, com uma faixa em cima de cada cacho para o nome
  // dele; a largura que sobra afasta os cachos na horizontal (afastar nunca faz dois se encostarem).
  // `itens`: [{ id, grupo, r }], na ordem do Copiloto.
  const FOLGA_BOLA = 6, FOLGA_CACHO = 10, FAIXA_NOME = 18, ESCALA_MAX = 1.5, AFASTAR_MAX = 1.8;
  function layoutBolhas(itens, caixa) {
    const lista = Array.from(itens || []);
    if (!lista.length) return { bolhas: [], grupos: [] };
    const nomes = [...new Set(lista.map(i => i.grupo))];
    const aspecto = caixa.w / caixa.h;
    const limites = bs => ({ x0: Math.min(...bs.map(b => b.x - b.r)), x1: Math.max(...bs.map(b => b.x + b.r)),
      y0: Math.min(...bs.map(b => b.y - b.r)), y1: Math.max(...bs.map(b => b.y + b.r)) });
    const cachos = nomes.map(nome => {
      // um projeto so: o cacho dele se espalha na largura
      const bs = empacotar(lista.filter(i => i.grupo === nome).map(i => ({ id: i.id, grupo: nome, r: i.r })), FOLGA_BOLA, nomes.length === 1 ? aspecto : 1);
      const l = limites(bs), cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
      return { nome, r: Math.max(...bs.map(b => Math.hypot(b.x - cx, b.y - cy) + b.r)), bolhas: bs.map(b => ({ ...b, x: b.x - cx, y: b.y - cy })) };
    });
    const postos = empacotar(cachos.map(c => ({ r: c.r + FAIXA_NOME })), FOLGA_CACHO, aspecto);
    const montar = f => {
      const bolhas = [], grupos = [];
      cachos.forEach((c, i) => {
        const x = f * postos[i].x, y = postos[i].y;
        grupos.push({ nome: c.nome, x, y, r: c.r, topo: Math.min(...c.bolhas.map(b => y + b.y - b.r)) });
        for (const b of c.bolhas) bolhas.push({ ...b, x: x + b.x, y: y + b.y });
      });
      return { bolhas, grupos, l: limites(bolhas), y0: Math.min(...grupos.map(g => g.topo)) };
    };
    const largura = f => { const l = montar(f).l; return l.x1 - l.x0; };
    const juntos = montar(1);
    const s = Math.min(ESCALA_MAX, caixa.w / largura(1), (caixa.h - FAIXA_NOME) / (juntos.l.y1 - juntos.y0));
    let f = 1;
    for (let passo = 0.4; passo > 0.01; passo /= 2) if (f + passo <= AFASTAR_MAX && s * largura(f + passo) <= caixa.w) f += passo;
    const { bolhas, grupos, l, y0 } = montar(f);
    const dx = caixa.x + (caixa.w - s * (l.x1 - l.x0)) / 2 - s * l.x0;
    const dy = caixa.y + FAIXA_NOME + (caixa.h - FAIXA_NOME - s * (l.y1 - y0)) / 2 - s * y0;
    const um = v => Math.round(v * 10) / 10;
    const ordem = new Map(lista.map((item, i) => [item.id, i]));
    return {
      bolhas: bolhas.sort((a, b) => ordem.get(a.id) - ordem.get(b.id)).map(b => ({ id: b.id, grupo: b.grupo, r: um(s * b.r), x: um(dx + s * b.x), y: um(dy + s * b.y) })),
      grupos: grupos.map(g => ({ nome: g.nome, x: um(dx + s * g.x), y: um(dy + s * g.y), r: um(s * g.r), rotuloY: um(dy + s * g.topo - 6) })),
    };
  }

  // O titulo dentro da bola: linhas de ate 1,55 r (6,4 por letra na fonte de 12), tantas quantas cabem em 1,4 r de
  // altura; o que sobra vira "…". O titulo inteiro fica na dica da bola e na historia.
  function textoNaBola(titulo, r, { letra = 6.4, altura = 14 } = {}) {
    const inteiro = String(titulo || "").split(/\s+/).filter(Boolean).join(" ");
    if (inteiro && inteiro.length <= Math.floor((1.85 * r) / letra)) return [inteiro];  // uma linha so, no meio da bola, onde ela e mais larga
    const cabe = Math.max(2, Math.floor((1.55 * r) / letra));
    const maximo = Math.max(1, Math.floor((1.4 * r) / altura));
    const linhas = [];
    for (const p of String(titulo || "").split(/\s+/).filter(Boolean)) {
      const u = linhas.length - 1;
      if (u >= 0 && linhas[u].length + 1 + p.length <= cabe) linhas[u] += ` ${p}`;
      else linhas.push(p);
    }
    const saida = linhas.slice(0, maximo).map(l => (l.length > cabe ? `${l.slice(0, cabe - 1)}…` : l));
    if (linhas.length > maximo) {
      const u = saida[maximo - 1];
      saida[maximo - 1] = u.endsWith("…") ? u : u.length < cabe ? `${u}…` : `${u.slice(0, cabe - 1)}…`;
    }
    return saida;
  }

  // Arvore de decisao da tarefa (docs/specs/mapa-bolas-arvore.md): a raiz em cima e, embaixo, um nivel por linha. A
  // arvore mostra um caminho por vez (sanfona): abrir uma parte fecha a vizinha, e cada linha sao os filhos da parte
  // aberta na de cima. Assim, abrir nao mexe no que esta em cima, e a largura e a da maior linha, nunca a soma das
  // subarvores, que em 1536x730 so cabia em letra miuda. A chave do no e o caminho: "r", "r.0", "r.0.1".
  const ARVORE = { raiz: { w: 260, porLinha: 36, maxLinhas: 2 }, no: { w: 172, porLinha: 24, maxLinhas: 4 },
    decisao: { w: 216, porLinha: 18, maxLinhas: 4 }, linha: 15, pad: 10, id: 14, vaoX: 16, vaoY: 46, margem: 16 };
  function quebrarTexto(texto, porLinha, maxLinhas) {
    const linhas = [];
    let atual = "";
    for (const palavra of String(texto || "").split(/\s+/).filter(Boolean)) {
      let resto = palavra;
      while (resto.length > porLinha) {  // palavra maior que a linha: corta
        if (atual) { linhas.push(atual); atual = ""; }
        linhas.push(resto.slice(0, porLinha));
        resto = resto.slice(porLinha);
      }
      if (!resto) continue;
      if (!atual) atual = resto;
      else if (atual.length + 1 + resto.length <= porLinha) atual += ` ${resto}`;
      else { linhas.push(atual); atual = resto; }
    }
    if (atual) linhas.push(atual);
    if (linhas.length <= maxLinhas) return linhas;
    return [...linhas.slice(0, maxLinhas - 1), `${linhas[maxLinhas - 1].slice(0, porLinha - 1).trimEnd()}…`];
  }
  // A raiz abre sempre; embaixo, abre o caminho que a nota manda (a primeira parte marcada aberta em cada nivel).
  function abertosIniciais(raiz) {
    const abertos = new Set(["r"]);
    for (let no = raiz || {}, chave = "r"; ;) {
      const i = (no.filhos || []).findIndex(f => f.aberto && (f.filhos || []).length > 0);
      if (i < 0) return abertos;
      chave = `${chave}.${i}`;
      abertos.add(chave);
      no = no.filhos[i];
    }
  }
  // Abre ou fecha a parte. Abrir fecha a vizinha aberta e o que estava aberto dentro dela; fechar leva junto o que
  // estava aberto dentro. A raiz nao fecha.
  function alternarNo(abertos, chave) {
    const novo = new Set(abertos);
    if (chave === "r") return novo.add("r");
    const dentro = k => k === chave || k.startsWith(`${chave}.`);
    if (novo.has(chave)) {
      for (const k of [...novo]) if (dentro(k)) novo.delete(k);
      return novo;
    }
    const pai = chave.slice(0, chave.lastIndexOf("."));
    const nivel = chave.split(".").length;
    for (const k of [...novo]) if (k.startsWith(`${pai}.`) && !dentro(k) && k.split(".").length >= nivel) novo.delete(k);
    return novo.add(chave);
  }
  // `largura` e a do quadro: a linha centrada embaixo do pai que passaria da borda encosta nela. A linha mais larga que
  // o quadro alarga a arvore (o quadro rola por dentro).
  function layoutArvore(raiz, abertos, largura = 0) {
    const A = ARVORE;
    const medir = (no, chave, prof) => {
      const tipo = prof === 0 ? "raiz" : no.estado === "decisao" ? "decisao" : "no";
      const T = A[tipo];
      const comId = prof > 0 && (no.tarefas || []).length > 0;
      // o id vira a ligacao embaixo da caixa: no texto ele so ocupava linha
      const semId = comId ? String(no.texto || "").replace(/\s*[·,]?\s*\bT-\d{8}-\d{1,3}\b/g, "").trim() : "";
      const linhas = quebrarTexto(semId || no.texto, T.porLinha, T.maxLinhas);
      const h = tipo === "decisao" ? Math.max(84, linhas.length * A.linha + 46)
        : A.pad * 2 + Math.max(1, linhas.length) * A.linha + (comId ? A.id : 0);
      return { chave, no, prof, w: T.w, h, linhas, decisao: tipo === "decisao", temFilhos: (no.filhos || []).length > 0, aberto: false };
    };
    const r = medir(raiz || { texto: "", filhos: [] }, "r", 0);
    r.aberto = r.temFilhos;
    const niveis = [[r]];
    for (let pai = r.aberto ? r : null; pai;) {
      const linha = (pai.no.filhos || []).map((f, i) => medir(f, `${pai.chave}.${i}`, pai.prof + 1));
      niveis.push(linha);
      pai = linha.find(it => it.temFilhos && abertos.has(it.chave));  // vizinhas abertas: vale a primeira
      if (pai) pai.aberto = true;
    }
    const larguraDe = linha => linha.reduce((t, it) => t + it.w, 0) + A.vaoX * (linha.length - 1);
    const W = Math.max(largura, ...niveis.map(linha => larguraDe(linha) + 2 * A.margem));
    const nos = [], arestas = [];
    let y = A.margem, pai = null;
    for (const linha of niveis) {
      const lw = larguraDe(linha);
      const centro = pai ? pai.x + pai.w / 2 : W / 2;
      let x = Math.min(Math.max(centro - lw / 2, A.margem), W - A.margem - lw);
      for (const it of linha) {
        Object.assign(it, { x, y });
        x += it.w + A.vaoX;
        nos.push(it);
        if (pai) arestas.push({ de: pai.chave, para: it.chave, rotulo: it.no.rotulo || "", x1: pai.x + pai.w / 2, y1: pai.y + pai.h, x2: it.x + it.w / 2, y2: y });
      }
      y += Math.max(...linha.map(it => it.h)) + A.vaoY;
      pai = linha.find(it => it.aberto) || null;
    }
    return { nos, arestas, largura: W, altura: y - A.vaoY + A.margem };
  }
  // A pasta "Sem tarefa" nao tem nota: a arvore dela sao as sessoes, montadas aqui com o que o Mapa ja tem.
  function arvoreDaPasta(x, sessoes = {}) {
    return { tipo: "pasta", texto: `Sem tarefa · ${x.titulo}`, estado: "nota", tarefas: [],
      filhos: (x.sessoes || []).filter(sid => sessoes[sid]).map(sid => ({ texto: sessoes[sid].nome || sid.slice(0, 8),
        estado: sessoes[sid].viva ? "andando" : "feito", sessao: sid, tarefas: [], filhos: [] })) };
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
  // Sessao de outra maquina (copiloto T-20261108-40): a resposta vai na hora pelo Herdr e o Claude guarda ate o fim da
  // vez; parar e ouvir continuam pelo attach, porque o processo e a conversa estao la.
  function sessaoRemota(s) {
    return Boolean(s && /^remota-/.test(String(s.sessao || "")));
  }
  function acoesDaSessao(s) {
    if (!s) return { pode: false, motivo: "", enviar: "", parar: false, fila: 0 };
    if (s.tipo === "interativa") return { pode: false, motivo: "Aberta num terminal: responda por lá.", enviar: "", parar: false, fila: 0 };
    if (sessaoRemota(s)) {
      const nao = motivo => ({ pode: false, motivo, enviar: "", parar: false, fila: 0 });
      if (!s.viva) return nao("A máquina não responde agora: tente quando ela voltar, ou abra pelo attach.");
      if (/^esperando você/.test(String(s.estado || ""))) return nao("Pedido de aprovação na tela da outra máquina: responda pelo attach.");
      return { pode: true, motivo: "", enviar: "Enviar", parar: false, fila: 0 };
    }
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
    raioDaTarefa, layoutBolhas, textoNaBola, ARVORE, quebrarTexto, abertosIniciais, alternarNo, layoutArvore, arvoreDaPasta, agruparFalas, trechosDaFala, sessaoRemota, acoesDaSessao, mensagemDeFalha, escolherVoz, frasesParaFalar, juntarDitado, suporteDitado, erroDoDitado, ORDEM_COR };
});
