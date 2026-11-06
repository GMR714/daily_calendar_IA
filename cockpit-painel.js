// O cockpit no visual do painel do Bill (docs/specs/cockpit-billverso.md): as regras puras da faixa de numeros, do mapa
// dos times, das entregas, das ideias e das prioridades. Vale no navegador (CockpitPainel) e nos testes, como o
// cockpit-view.js. Os dados vem prontos do `cockpit --json` do Copiloto; aqui so se arruma e se desenha.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CockpitPainel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const CORES = ["problema", "atencao", "bem", "sem_sinal"];
  const ORDEM_COR = { problema: 0, atencao: 1, bem: 2, sem_sinal: 3 };
  const NOME_COR = { problema: "problema", atencao: "atenção", bem: "bem", sem_sinal: "sem sinal" };
  const GASTO = ["entrada", "saida", "cache_criado"];  // o cache lido custa pouco e inflava a Energia para bilhoes
  const virgula = texto => String(texto).replace(".", ",");
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const semAcento = texto => String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const inteiro = v => Number(v) || 0;

  function tokensCurto(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const v = Math.max(0, Number(n));
    if (v >= 999950000) return `${virgula((v / 1e9).toFixed(1))} B`;
    if (v >= 999500) return `${virgula((v / 1e6).toFixed(1))} M`;
    if (v >= 1000) return `${Math.round(v / 1000)} k`;
    return String(Math.round(v));
  }

  function gasto(tokens) {
    if (!tokens || typeof tokens !== "object") return 0;
    if (GASTO.some(k => k in tokens)) return GASTO.reduce((soma, k) => soma + inteiro(tokens[k]), 0);
    return inteiro(tokens.total);
  }

  // A faixa de numeros do topo, em duas linhas, como no painel do Bill: o numero grande antes do rotulo. `destino` e a
  // aba (ou a fila Voce) que o clique abre.
  function cartoesTopo(numeros) {
    const x = numeros || {};
    const pct = (a, b) => (b ? Math.round((100 * inteiro(a)) / b) : 0);
    const g = x.geradas || {};
    const paradas = inteiro(x.paradas_8h);
    const criadas = inteiro(x.criadas_hoje);
    const aceites = inteiro(x.aceites_hoje);
    const origens = [`rotina ${inteiro(g.rotina)}`, `trabalho ${inteiro(g.trabalho)}`, ...(g.sem_origem ? [`sem origem ${g.sem_origem}`] : [])];
    const velho = x.mais_velho_h === null || x.mais_velho_h === undefined ? "" : `mais velho há ${x.mais_velho_h} h`;
    const linha1 = [
      { chave: "realizadas", numero: String(inteiro(x.realizadas_hoje)), rotulo: "Realizadas hoje", sub: "", cor: null, destino: "entregas" },
      { chave: "pendentes", numero: String(inteiro(x.pendentes)), rotulo: "Pendentes",
        sub: paradas ? `${plural(paradas, "parada", "paradas")} há +8 h` : "nenhuma parada há +8 h", cor: paradas ? "atencao" : null, destino: "tarefas" },
      { chave: "geradas", numero: String(inteiro(x.geradas_sem_voce)), rotulo: "Geradas sem você",
        sub: [criadas ? `${pct(x.geradas_sem_voce, criadas)}% das ${criadas} de hoje` : "nenhuma criada hoje", ...origens].join(" · "), cor: null, destino: "tarefas" },
      { chave: "validadas", numero: String(inteiro(x.validadas_sem_voce)), rotulo: "Validadas sem você",
        sub: aceites ? `${pct(x.validadas_sem_voce, aceites)}% dos ${aceites} aceites` : "nenhum aceite hoje", cor: null, destino: "entregas" },
      { chave: "esperando", numero: String(inteiro(x.esperando_voce)), rotulo: "Esperando você", sub: velho, cor: "voce", destino: "voce" }
    ];
    const s = x.menor_saldo;
    const e = x.energia || {};
    const c = x.cadeiras || {};
    const linha2 = [
      s ? { chave: "saldo", titulo: `${s.nome} · ${s.disponivel}% disponível`, rotulo: "Menor saldo", sub: s.detalhe || "", cor: s.cor || "sem_sinal", destino: "saldos" }
        : { chave: "saldo", titulo: "sem leitura do switcher", rotulo: "Menor saldo", sub: "", cor: "sem_sinal", destino: "saldos" },
      { chave: "energia", numero: tokensCurto(e.tokens || 0), rotulo: "Energia", sub: e.top ? `top: ${e.top}` : "", cor: null, destino: "saldos" },
      { chave: "cadeiras", rotulo: "Cadeiras", cores: Object.fromEntries(CORES.map(k => [k, inteiro(c[k])])), destino: null }
    ];
    return { linha1, linha2 };
  }

  // A fila da direita do Mapa: quatro quadros e as Entregas de hoje embaixo, na largura toda.
  function cartoesFila(fila) {
    const f = fila || {};
    return [
      { chave: "abertas", numero: inteiro(f.abertas), rotulo: "Abertas", destino: "tarefas" },
      { chave: "em_execucao", numero: inteiro(f.em_execucao), rotulo: "Em execução", destino: "pulso" },
      { chave: "entregues_sem_aceite", numero: inteiro(f.entregues_sem_aceite), rotulo: "Entregues sem aceite", destino: "entregas" },
      { chave: "retrabalho_hoje", numero: inteiro(f.retrabalho_hoje), rotulo: "Retrabalho hoje", destino: "tarefas" },
      { chave: "entregas_hoje", numero: inteiro(f.entregas_hoje), rotulo: "Entregas hoje", destino: "entregas", larga: true }
    ];
  }

  // ------------------------------------------------------------------ o mapa dos times
  // Colunas da esquerda para a direita: Voce e as Rotinas; Comando e Governanca; Fabrica e Outras sessoes; Entregas
  // hoje no fim da esteira. Cada time e uma caixa com os agentes em grade. Tudo em coordenadas do desenho: a tela
  // escala o SVG para caber no quadro (e o zoom aproxima).
  // medidas de 05/11: no quadro do meio de uma tela de 1600 px, o desenho cabe a ~0,9 (com 172 px por agente, a 0,8)
  const NO = { w: 160, h: 40 };
  const NO_ROTINA = { w: 140, h: 30 };
  const VAO = { x: 10, y: 8 };
  const CAIXA = { pad: 10, topo: 34 };
  const VOCE = { w: 74, h: 30 };
  const ENTREGAS = { w: 108, h: 62 };
  const ENTRE_COLUNAS = 48;
  const ENTRE_CAIXAS = 26;
  const MARGEM = 16;
  const FAIXA_DE_CIMA = 34;  // por onde a escala corre ate Voce, acima das caixas
  const NOMES = { comando: "Comando", fabrica: "Fábrica", governanca: "Governança", rotinas: "Rotinas", outras: "Outras sessões" };
  const ORDEM_TIPOS = ["delega", "escala", "rotinas", "observa"];

  const pesoNoComando = n => (n.nome === "Mestra" ? 0 : n.nome === "orquestradora" ? 1 : 2);
  function ordenar(time, lista) {
    if (time === "comando") return lista.slice().sort((a, b) => pesoNoComando(a) - pesoNoComando(b));
    if (time === "governanca") return lista.slice();
    if (time === "rotinas") return lista.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
    // o que precisa de voce primeiro, como as linhas do Pulso
    return lista.slice().sort((a, b) => (ORDEM_COR[a.cor] ?? 3) - (ORDEM_COR[b.cor] ?? 3) || String(a.nome).localeCompare(String(b.nome)));
  }
  function colunasDoTime(time, n) {
    if (time === "fabrica") return Math.max(1, Math.min(3, Math.ceil(n / 4)));
    if (time === "outras") return Math.max(1, Math.min(3, Math.ceil(n / 3)));
    if (time === "rotinas") return n > 9 ? 2 : 1;
    return 1;
  }
  function montarCaixa(time, lista, x, y) {
    const tam = time === "rotinas" ? NO_ROTINA : NO;
    const cols = colunasDoTime(time, lista.length);
    const linhas = Math.ceil(lista.length / cols);
    const w = CAIXA.pad * 2 + cols * tam.w + (cols - 1) * VAO.x;
    const h = CAIXA.topo + linhas * tam.h + (linhas - 1) * VAO.y + CAIXA.pad;
    const nos = lista.map((no, i) => ({ ...no, x: x + CAIXA.pad + (i % cols) * (tam.w + VAO.x), y: y + CAIXA.topo + Math.floor(i / cols) * (tam.h + VAO.y), w: tam.w, h: tam.h }));
    return { caixa: { time, nome: NOMES[time] || time, x, y, w, h }, nos };
  }
  const r1 = n => Math.round(n * 10) / 10;
  function caminho(a, b, tipo, faixa) {
    const ya = a.y + a.h / 2;
    const yb = b.y + b.h / 2;
    if (tipo === "escala") {  // sobe do agente, corre por cima das caixas e desce em Voce
      const x1 = a.x + a.w / 2;
      const x2 = b.x + b.w / 2;
      return `M${r1(x1)},${r1(a.y)} C${r1(x1)},${r1(faixa)} ${r1(x2)},${r1(faixa)} ${r1(x2)},${r1(b.y)}`;
    }
    if (b.x >= a.x + a.w) {  // para a direita
      const x1 = a.x + a.w;
      const x2 = b.x;
      const dx = Math.max(24, (x2 - x1) / 2);
      return `M${r1(x1)},${r1(ya)} C${r1(x1 + dx)},${r1(ya)} ${r1(x2 - dx)},${r1(yb)} ${r1(x2)},${r1(yb)}`;
    }
    if (b.x + b.w <= a.x) {  // para a esquerda
      const x1 = a.x;
      const x2 = b.x + b.w;
      const dx = Math.max(24, (x1 - x2) / 2);
      return `M${r1(x1)},${r1(ya)} C${r1(x1 - dx)},${r1(ya)} ${r1(x2 + dx)},${r1(yb)} ${r1(x2)},${r1(yb)}`;
    }
    // na mesma coluna: sai pela esquerda e volta pela esquerda, por fora dos outros da caixa
    const dx = 30 + Math.min(40, Math.abs(yb - ya) / 6);
    return `M${r1(a.x)},${r1(ya)} C${r1(a.x - dx)},${r1(ya)} ${r1(b.x - dx)},${r1(yb)} ${r1(b.x)},${r1(yb)}`;
  }

  function layoutTimes(nos, ligacoes, { observa = false } = {}) {
    const porTime = {};
    for (const n of nos || []) (porTime[n.time] ||= []).push(n);
    const saida = { nos: [], caixas: [], arestas: [], tipos: [], esteira: "" };
    const y0 = MARGEM + FAIXA_DE_CIMA;
    const empilhar = (times, x, yIni) => {
      let y = yIni;
      let largura = 0;
      for (const time of times) {
        const lista = ordenar(time, porTime[time] || []);
        if (!lista.length) continue;
        const { caixa, nos: postos } = montarCaixa(time, lista, x, y);
        saida.caixas.push(caixa);
        saida.nos.push(...postos);
        y = caixa.y + caixa.h + ENTRE_CAIXAS;
        largura = Math.max(largura, caixa.w);
      }
      return largura;
    };
    let x = MARGEM;
    // coluna 1: Voce na altura do primeiro agente do Comando, e as rotinas embaixo
    const voce = (porTime.voce || [])[0];
    let coluna = 0;
    let yRotinas = y0;
    if (voce) {
      saida.nos.push({ ...voce, x, y: y0 + CAIXA.topo + (NO.h - VOCE.h) / 2, w: VOCE.w, h: VOCE.h });
      coluna = VOCE.w;
      yRotinas = y0 + CAIXA.topo + NO.h + 30;
    }
    coluna = Math.max(coluna, empilhar(["rotinas"], x, yRotinas));
    if (coluna) x += coluna + ENTRE_COLUNAS;
    for (const times of [["comando", "governanca"], ["fabrica", "outras"]]) {
      const largura = empilhar(times, x, y0);
      if (largura) x += largura + ENTRE_COLUNAS;
    }
    // as Entregas de hoje no fim da esteira, na altura do meio da Fabrica
    const entregas = (porTime.entregas || [])[0];
    if (entregas) {
      const fabrica = saida.caixas.find(c => c.time === "fabrica");
      const ref = fabrica || saida.caixas.find(c => c.time === "comando");
      const meio = ref ? ref.y + ref.h / 2 : y0 + ENTREGAS.h / 2;
      const no = { ...entregas, x, y: Math.max(y0, meio - ENTREGAS.h / 2), w: ENTREGAS.w, h: ENTREGAS.h };
      saida.nos.push(no);
      // a esteira: o que a Fabrica entrega cai nas Entregas de hoje, como o fim do pipeline do Bill
      if (fabrica) saida.esteira = caminho(fabrica, no, "esteira", 0);
    }
    const coisas = [...saida.nos, ...saida.caixas];
    saida.largura = Math.max(320, ...coisas.map(c => c.x + c.w + MARGEM));
    saida.altura = Math.max(200, ...coisas.map(c => c.y + c.h + MARGEM));
    // as ligacoes: so entre nos que estao no desenho; "quem observa" so quando ele pede
    const porId = new Map(saida.nos.map(n => [n.id, n]));
    const topo = coisas.length ? Math.min(...coisas.map(c => c.y)) : y0;
    const faixa = Math.max(4, topo - FAIXA_DE_CIMA + 8);
    for (const l of ligacoes || []) {
      if (l.tipo === "observa" && !observa) continue;
      const a = porId.get(l.de);
      const b = porId.get(l.para);
      if (!a || !b || a === b) continue;
      saida.arestas.push({ de: l.de, para: l.para, tipo: l.tipo, d: caminho(a, b, l.tipo, faixa) });
    }
    const vistos = [...new Set(saida.arestas.map(a => a.tipo))];
    saida.tipos = [...ORDEM_TIPOS.filter(t => vistos.includes(t)), ...vistos.filter(t => !ORDEM_TIPOS.includes(t))];
    return saida;
  }

  function subtituloTime(time) {
    const x = time || {};
    const c = x.cores || {};
    const partes = [plural(inteiro(x.membros), "cadeira", "cadeiras")];
    for (const cor of ["problema", "atencao"]) if (c[cor]) partes.push(`${c[cor]} ${NOME_COR[cor]}`);
    if (x.trabalhando) partes.push(`${x.trabalhando} trabalhando`);
    return partes.join(" · ");
  }
  const linhaTime = time => {
    const x = time || {};
    return `${inteiro(x.trabalhando)} trab · ${inteiro(x.fila)} fila · ${tokensCurto(x.tokens || 0)} tok`;
  };

  // ------------------------------------------------------------------ entregas, ideias, prioridades e gasto
  // "Entregue nao e aceito": a evidencia que e link https abre em outra aba; o resto aparece como texto.
  const LINK = /^https?:\/\/[^\s<>"']+$/i;
  function entregaVista(entrega) {
    const e = entrega || {};
    const item = texto => (LINK.test(String(texto)) ? { tipo: "link", texto: String(texto), href: String(texto) } : { tipo: "texto", texto: String(texto) });
    return { evidencias: (e.links || []).map(item),
      artefatos: [...(e.arquivos || []).map(t => ({ tipo: "texto", texto: String(t) })), ...(e.prints || []).map(t => ({ tipo: "print", texto: String(t) }))] };
  }

  // O BACKLOG cresce no fim: a secao mais nova vem primeiro. A busca vale para o texto e para a secao.
  function ideiasPorSecao(ideias, busca = "") {
    const termo = semAcento(busca).trim();
    const grupos = new Map();
    for (const i of ideias || []) {
      const secao = i.secao || "Sem seção";
      if (termo && !semAcento(i.texto).includes(termo) && !semAcento(secao).includes(termo)) continue;
      if (!grupos.has(secao)) grupos.set(secao, []);
      grupos.get(secao).push(i.texto);
    }
    return [...grupos].map(([secao, itens]) => ({ secao, itens })).reverse();
  }

  const prioridadesEmOrdem = lista => [...(lista || []).filter(p => !p.feita), ...(lista || []).filter(p => p.feita)];

  function gastoPorSessao(agentes) {
    return (agentes || []).map(a => ({ nome: a.nome || a.id || "sessão", tokens: gasto(a.tokens_hoje) }))
      .filter(x => x.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  }

  // O que ele acabou de mudar (prioridades, aceite) vale sobre a leitura que comecou antes da mudanca: ela ainda traz o
  // dado velho. Sem a hora do comeco (servidor antigo), fica o que ele mudou.
  function valeOLocal(local, iniciadoEm) {
    if (!local) return false;
    const inicio = Date.parse(iniciadoEm || "");
    return Number.isNaN(inicio) || inicio < local.em;
  }

  return { tokensCurto, gasto, cartoesTopo, cartoesFila, layoutTimes, subtituloTime, linhaTime, entregaVista, ideiasPorSecao, prioridadesEmOrdem,
    gastoPorSessao, valeOLocal, NOME_COR, CORES };
});
