// O cockpit no visual do painel do Bill (docs/specs/cockpit-billverso.md): as regras puras da faixa de números, do mapa
// dos times, das entregas, das ideias e das prioridades.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const P = require("../cockpit-painel");

test("tokens curtos, como no painel do Bill", () => {
  assert.equal(P.tokensCurto(0), "0");
  assert.equal(P.tokensCurto(950), "950");
  assert.equal(P.tokensCurto(431000), "431 k");
  assert.equal(P.tokensCurto(2589661), "2,6 M");
  assert.equal(P.tokensCurto(43959066), "44,0 M");
  assert.equal(P.tokensCurto(1660507599), "1,7 B");
  assert.equal(P.tokensCurto(null), "—");
});

test("o gasto conta entrada, saída e cache criado, sem o cache lido", () => {
  assert.equal(P.gasto({ entrada: 10, saida: 20, cache_criado: 30, cache_lido: 1000, total: 1060 }), 60);
  assert.equal(P.gasto({ total: 500 }), 500);
  assert.equal(P.gasto(null), 0);
});

const NUMEROS = {
  realizadas_hoje: 38, pendentes: 24, paradas_8h: 10, criadas_hoje: 36, geradas_sem_voce: 16,
  geradas: { rotina: 4, trabalho: 12, sem_origem: 8 }, aceites_hoje: 36, validadas_sem_voce: 30, esperando_voce: 6,
  mais_velho_h: 5, energia: { tokens: 43959066, top: "copiloto ciclo" }, cadeiras: { problema: 0, atencao: 5, bem: 4, sem_sinal: 4 },
  menor_saldo: { nome: "Claude · 7 dias", disponivel: 67, cor: "bem", detalhe: "33% usado · lido há 29 min" }
};

test("faixa de números: as duas linhas do topo, com o número antes do rótulo", () => {
  const { linha1, linha2 } = P.cartoesTopo(NUMEROS);
  assert.deepEqual(linha1.map(c => [c.chave, c.numero, c.rotulo]), [["realizadas", "38", "Realizadas hoje"], ["pendentes", "24", "Pendentes"],
    ["geradas", "16", "Geradas sem você"], ["validadas", "30", "Validadas sem você"], ["esperando", "6", "Esperando você"]]);
  assert.equal(linha1[1].sub, "10 paradas há +8 h");
  assert.equal(linha1[1].cor, "atencao");
  assert.equal(linha1[2].sub, "44% das 36 de hoje · rotina 4 · trabalho 12 · sem origem 8");
  assert.equal(linha1[3].sub, "83% dos 36 aceites");
  assert.equal(linha1[4].sub, "mais velho há 5 h");
  assert.equal(linha1[4].cor, "voce");
  assert.deepEqual(linha1.map(c => c.destino), ["entregas", "tarefas", "tarefas", "entregas", "voce"]);
  assert.deepEqual(linha2.map(c => c.chave), ["saldo", "energia", "cadeiras"]);
  assert.equal(linha2[0].titulo, "Claude · 7 dias · 67% disponível");
  assert.deepEqual([linha2[0].rotulo, linha2[0].sub], ["Menor saldo", "33% usado · lido há 29 min"]);
  assert.equal(linha2[0].cor, "bem");
  assert.equal(linha2[1].numero, "44,0 M");
  assert.deepEqual([linha2[1].rotulo, linha2[1].sub], ["Energia", "top: copiloto ciclo"]);
  assert.deepEqual(linha2[2].cores, { problema: 0, atencao: 5, bem: 4, sem_sinal: 4 });
});

test("faixa de números: no singular, e sem dado nenhum não quebra", () => {
  const um = P.cartoesTopo({ ...NUMEROS, paradas_8h: 1, aceites_hoje: 0, validadas_sem_voce: 0, criadas_hoje: 0, mais_velho_h: null });
  assert.equal(um.linha1[1].sub, "1 parada há +8 h");
  assert.equal(um.linha1[2].sub, "nenhuma criada hoje · rotina 4 · trabalho 12 · sem origem 8");
  assert.equal(um.linha1[3].sub, "nenhum aceite hoje");
  assert.equal(um.linha1[4].sub, "");
  const vazio = P.cartoesTopo(undefined);
  assert.equal(vazio.linha1.length, 5);
  assert.equal(vazio.linha1[0].numero, "0");
  assert.equal(vazio.linha1[1].sub, "nenhuma parada há +8 h");
  assert.equal(vazio.linha2[0].titulo, "sem leitura do switcher");
  assert.equal(vazio.linha2[0].cor, "sem_sinal");
  assert.deepEqual(vazio.linha2[2].cores, { problema: 0, atencao: 0, bem: 0, sem_sinal: 0 });
});

const NOS = [
  { id: "voce", nome: "Você", time: "voce", tipo: "voce", cor: "atencao", selo: 2 },
  { id: "agente:ab12cd34", nome: "Mestra", time: "comando", tipo: "agente", cor: "bem", estado: "trabalhando", contexto: 120000, agente: "ab12cd34" },
  { id: "agente:f65e46aa", nome: "orquestradora", time: "comando", tipo: "agente", cor: "sem_sinal", estado: "terminou", agente: "f65e46aa" },
  { id: "agente:397e51c0", nome: "Ligar o que a série", time: "fabrica", tipo: "agente", cor: "bem", estado: "trabalhando", agente: "397e51c0", tarefa: "T-20261104-21" },
  { id: "agente:d7d542d1", nome: "Fazer o cockpit não cair", time: "fabrica", tipo: "agente", cor: "atencao", estado: "esperando você", agente: "d7d542d1" },
  { id: "agente:14383b98", nome: "Formatos de vídeo", time: "outras", tipo: "agente", cor: "bem", estado: "trabalhando", agente: "", sessao: "14383b98-2e7c" },
  { id: "funcao:verificadora", nome: "Verificadora", time: "governanca", tipo: "funcao", cor: "bem", estado: "confere as feitas", selo: 4 },
  { id: "funcao:revisora", nome: "Revisora", time: "governanca", tipo: "funcao", cor: "bem", estado: "confere as mensagens" },
  { id: "funcao:ronda", nome: "Ronda", time: "governanca", tipo: "funcao", cor: "problema", estado: "acha o que parou" },
  { id: "rotina:Copiloto - ciclo", nome: "ciclo", time: "rotinas", tipo: "rotina", cor: "bem", estado: "rodou às 22:00", rotina: "Copiloto - ciclo" },
  { id: "rotina:Copiloto - ronda", nome: "ronda", time: "rotinas", tipo: "rotina", cor: "problema", estado: "falhou às 21:55", rotina: "Copiloto - ronda" },
  { id: "entregas", nome: "Entregas hoje", time: "entregas", tipo: "entregas", cor: "bem", selo: 38 }
];
const LIGACOES = [
  { de: "voce", para: "agente:ab12cd34", tipo: "delega" }, { de: "agente:ab12cd34", para: "agente:f65e46aa", tipo: "delega" },
  { de: "agente:f65e46aa", para: "agente:397e51c0", tipo: "delega" }, { de: "agente:f65e46aa", para: "agente:d7d542d1", tipo: "delega" },
  { de: "agente:d7d542d1", para: "voce", tipo: "escala" }, { de: "rotina:Copiloto - ciclo", para: "agente:f65e46aa", tipo: "rotinas" },
  { de: "rotina:Copiloto - ronda", para: "funcao:ronda", tipo: "rotinas" }, { de: "funcao:verificadora", para: "agente:397e51c0", tipo: "observa" },
  { de: "funcao:revisora", para: "agente:f65e46aa", tipo: "observa" }, { de: "agente:sumiu", para: "voce", tipo: "escala" }
];
const dentro = (n, c) => n.x >= c.x && n.y >= c.y && n.x + n.w <= c.x + c.w && n.y + n.h <= c.y + c.h;
const separados = (a, b) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

test("mapa dos times: cada time numa caixa, ninguém em cima de ninguém, tudo dentro do desenho", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  assert.deepEqual(L.caixas.map(c => c.time).sort(), ["comando", "fabrica", "governanca", "outras", "rotinas"]);
  assert.equal(L.nos.length, NOS.length);
  for (const n of L.nos) assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= L.largura && n.y + n.h <= L.altura, n.id);
  for (const a of L.nos) for (const b of L.nos) if (a !== b) assert.ok(separados(a, b), `${a.id} × ${b.id}`);
  for (const a of L.caixas) for (const b of L.caixas) if (a !== b) assert.ok(separados(a, b), `${a.time} × ${b.time}`);
  for (const n of L.nos.filter(x => !["voce", "entregas"].includes(x.time))) assert.ok(dentro(n, L.caixas.find(c => c.time === n.time)), n.id);
});

test("mapa dos times: Você à esquerda, a Fábrica no meio e as Entregas de hoje no fim da esteira", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  const no = id => L.nos.find(n => n.id === id);
  const caixa = time => L.caixas.find(c => c.time === time);
  assert.ok(L.nos.every(n => n.x >= no("voce").x));
  assert.ok(caixa("comando").x >= no("voce").x + no("voce").w);
  assert.ok(caixa("fabrica").x >= caixa("comando").x + caixa("comando").w);
  assert.ok(no("entregas").x >= caixa("fabrica").x + caixa("fabrica").w);
  assert.equal(caixa("fabrica").nome, "Fábrica");
});

test("mapa dos times: a esteira sai da Fábrica e termina nas Entregas de hoje", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  const fabrica = L.caixas.find(c => c.time === "fabrica");
  const entregas = L.nos.find(n => n.id === "entregas");
  const [x1, y1] = L.esteira.match(/-?[\d.]+/g).map(Number);
  assert.equal(x1, fabrica.x + fabrica.w);
  assert.ok(y1 >= fabrica.y && y1 <= fabrica.y + fabrica.h);
  assert.match(L.esteira, new RegExp(`${entregas.x},[\\d.]+$`));
  assert.equal(P.layoutTimes(NOS.filter(n => n.time !== "fabrica"), LIGACOES).esteira, "");
});

test("mapa dos times: dentro da caixa, o que precisa de você vem primeiro; no Comando, a Mestra", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  assert.deepEqual(L.nos.filter(n => n.time === "fabrica").map(n => n.id), ["agente:d7d542d1", "agente:397e51c0"]);
  assert.deepEqual(L.nos.filter(n => n.time === "comando").map(n => n.id), ["agente:ab12cd34", "agente:f65e46aa"]);
});

test("mapa dos times: o Padrão esconde quem observa, e a ligação para um nó que não existe não aparece", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  assert.deepEqual(L.arestas.map(a => `${a.de}>${a.para}`), ["voce>agente:ab12cd34", "agente:ab12cd34>agente:f65e46aa",
    "agente:f65e46aa>agente:397e51c0", "agente:f65e46aa>agente:d7d542d1", "agente:d7d542d1>voce", "rotina:Copiloto - ciclo>agente:f65e46aa",
    "rotina:Copiloto - ronda>funcao:ronda"]);
  assert.deepEqual(L.tipos, ["delega", "escala", "rotinas"]);
  const O = P.layoutTimes(NOS, LIGACOES, { observa: true });
  assert.equal(O.arestas.filter(a => a.tipo === "observa").length, 2);
  assert.deepEqual(O.tipos, ["delega", "escala", "rotinas", "observa"]);
  for (const a of O.arestas) assert.match(a.d, /^M-?[\d.]+,-?[\d.]+ C/);
});

test("mapa dos times: a escala sobe por cima das caixas até Você", () => {
  const L = P.layoutTimes(NOS, LIGACOES);
  const escala = L.arestas.find(a => a.tipo === "escala");
  const ys = escala.d.match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1);
  assert.ok(Math.min(...ys) < Math.min(...L.caixas.map(c => c.y)));
  assert.ok(Math.min(...ys) >= 0);
});

test("mapa dos times: time sem ninguém não tem caixa, e sem nada o desenho fica vazio", () => {
  const sem = P.layoutTimes(NOS.filter(n => n.time !== "outras"), LIGACOES);
  assert.ok(!sem.caixas.some(c => c.time === "outras"));
  const nada = P.layoutTimes([], []);
  assert.deepEqual([nada.nos, nada.caixas, nada.arestas], [[], [], []]);
  assert.ok(nada.largura > 0 && nada.altura > 0);
});

test("o resumo do time em uma linha, como no Bill", () => {
  assert.equal(P.subtituloTime({ membros: 7, cores: { problema: 0, atencao: 4, bem: 1, sem_sinal: 2 }, trabalhando: 1 }), "7 cadeiras · 4 atenção · 1 trabalhando");
  assert.equal(P.subtituloTime({ membros: 1, cores: { problema: 1, atencao: 0, bem: 0, sem_sinal: 0 }, trabalhando: 0 }), "1 cadeira · 1 problema");
  assert.equal(P.linhaTime({ trabalhando: 1, fila: 3, tokens: 2589661 }), "1 trab · 3 fila · 2,6 M tok");
  assert.equal(P.linhaTime({}), "0 trab · 0 fila · 0 tok");
});

test("entrega: o link https abre em outra aba; o resto aparece como texto", () => {
  const v = P.entregaVista({ links: ["https://github.com/x/pull/76", "javascript:alert(1)"], arquivos: ["C:\\a\\relatorio.md"], prints: ["C:\\a\\p.png"] });
  assert.deepEqual(v.evidencias, [{ tipo: "link", texto: "https://github.com/x/pull/76", href: "https://github.com/x/pull/76" }, { tipo: "texto", texto: "javascript:alert(1)" }]);
  assert.deepEqual(v.artefatos, [{ tipo: "texto", texto: "C:\\a\\relatorio.md" }, { tipo: "print", texto: "C:\\a\\p.png" }]);
  assert.deepEqual(P.entregaVista({}), { evidencias: [], artefatos: [] });
});

test("ideias: a seção mais nova primeiro, e a busca sem acento", () => {
  const ideias = [{ secao: "Do cockpit", texto: "Mostrar a lista" }, { secao: "Do vigia", texto: "Medir os limiares" }, { secao: "Do cockpit", texto: "Tráfego 24 h" }];
  assert.deepEqual(P.ideiasPorSecao(ideias), [{ secao: "Do vigia", itens: ["Medir os limiares"] }, { secao: "Do cockpit", itens: ["Mostrar a lista", "Tráfego 24 h"] }]);
  assert.deepEqual(P.ideiasPorSecao(ideias, "TRAFEGO"), [{ secao: "Do cockpit", itens: ["Tráfego 24 h"] }]);
  assert.deepEqual(P.ideiasPorSecao(ideias, "vigia"), [{ secao: "Do vigia", itens: ["Medir os limiares"] }]);  // a busca vale para a seção
  assert.deepEqual(P.ideiasPorSecao([{ secao: "", texto: "solta" }]), [{ secao: "Sem seção", itens: ["solta"] }]);
  assert.deepEqual(P.ideiasPorSecao(undefined), []);
});

test("prioridades: as abertas na ordem dele, depois as feitas", () => {
  const lista = [{ id: "p1", texto: "a", feita: true }, { id: "p2", texto: "b", feita: false }, { id: "p3", texto: "c", feita: false }];
  assert.deepEqual(P.prioridadesEmOrdem(lista).map(p => p.id), ["p2", "p3", "p1"]);
  assert.deepEqual(P.prioridadesEmOrdem(undefined), []);
});

test("gasto por sessão: quem mais gastou primeiro, sem o cache lido e sem quem não gastou", () => {
  const agentes = [{ nome: "a", tokens_hoje: { entrada: 1, saida: 1, cache_criado: 1, cache_lido: 999 } }, { nome: "b", tokens_hoje: { total: 50 } }, { nome: "c" }];
  assert.deepEqual(P.gastoPorSessao(agentes), [{ nome: "b", tokens: 50 }, { nome: "a", tokens: 3 }]);
});

test("a escolha mais nova vale sobre a leitura que começou antes dela", () => {
  // a leitura do Copiloto leva ~10 s: a que começou antes de mexer nas prioridades ainda traz a lista velha
  assert.equal(P.valeOLocal({ em: 1000 }, "1970-01-01T00:00:00.500Z"), true);
  assert.equal(P.valeOLocal({ em: 1000 }, "1970-01-01T00:00:01.500Z"), false);
  assert.equal(P.valeOLocal(null, "1970-01-01T00:00:00.500Z"), false);
  assert.equal(P.valeOLocal({ em: 1000 }, undefined), true);
});
