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
  function rotuloDaResposta(item) {
    const r = item && item.resposta;
    if (!r) return "";
    const feito = r.acao === "aprovar" ? "Aprovado" : r.acao === "descartar" ? "Descartado" : item.tipo === "dar ok" ? "Ajuste pedido" : "Respondido";
    return `${feito} ${r.origem === "dm" ? "na DM" : "na tela"} · espera o ciclo`;
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
  const AGORA = { voce: { rotulo: "Precisa de você", cor: "atencao" }, travada: { rotulo: "Travada", cor: "problema" },
    trabalhando: { rotulo: "Trabalhando", cor: "bem" }, fila: { rotulo: "Na fila do Copiloto", cor: "sem_sinal" }, fechada: { rotulo: "Fechada", cor: "sem_sinal" } };
  function agoraDaHistoria(agora) {
    const tipo = agora && agora.tipo;
    return { ...(Object.prototype.hasOwnProperty.call(AGORA, tipo) ? AGORA[tipo] : { rotulo: "Agora", cor: "sem_sinal" }) };
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

  return { idade, medidorContexto, gruposAgentes, filtrar, posicaoNoDia, mudancas, semAcento, semMarkdown, legivel, acoesDoItem, avisoDaExclusao, semExcluidas, resumoRotinas, rotuloDaResposta, linkObsidian,
    raioDaTarefa, layoutBolhas, textoNaBola, resumoDoPasso, fatiaDaHistoria, sessoesNosPassos, agoraDaHistoria, grafoDoItem, agruparFalas, trechosDaFala, acoesDaSessao, mensagemDeFalha, escolherVoz, frasesParaFalar, juntarDitado, suporteDitado, erroDoDitado, ORDEM_COR };
});
