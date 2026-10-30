const { test } = require("node:test");
const assert = require("node:assert/strict");
const V = require("../cockpit-view");

test("idade curta e medidor de contexto na regua do Bill", () => {
  assert.equal(V.idade(5), "agora");
  assert.equal(V.idade(42), "há 42 s");
  assert.equal(V.idade(180), "há 3 min");
  assert.equal(V.idade(7200), "há 2 h");
  assert.deepEqual(V.medidorContexto(211322), { pct: 35, cor: "atencao", rotulo: "211 mil" });
  assert.deepEqual(V.medidorContexto(150000), { pct: 25, cor: "bem", rotulo: "150 mil" });
  assert.deepEqual(V.medidorContexto(null), { pct: 0, cor: "sem_sinal", rotulo: "sem dado" });
  assert.equal(V.medidorContexto(900000).pct, 100);
  assert.equal(V.medidorContexto(900000).cor, "problema");
});

test("agentes em grupos: precisam de voce, trabalhando e parados", () => {
  const grupos = V.gruposAgentes([
    { id: "a", cor: "atencao", estado: "esperando você" },
    { id: "b", cor: "bem", estado: "trabalhando" },
    { id: "c", cor: "sem_sinal", estado: "parada" },
    { id: "d", cor: "problema", estado: "parou no limite de uso" }
  ]);
  assert.deepEqual(grupos.map(g => [g.chave, g.itens.map(i => i.id)]), [["voce", ["d", "a"]], ["trabalhando", ["b"]], ["parados", ["c"]]]);
  assert.equal(grupos[0].titulo, "Precisam de você");
});

const DADOS = {
  agentes: [
    { id: "a", nome: "Desafio do Marios", agora: "Revisando a skill", cor: "bem" },
    { id: "b", nome: "copiloto ciclo", agora: "Coleta", cor: "atencao" }
  ],
  rotinas: [
    { nome: "Lifeshub", segmento: "Pessoal", cor: "problema", texto: "falhou" },
    { nome: "Copiloto - ciclo", segmento: "Copiloto", cor: "bem", texto: "rodou" }
  ],
  voce: { itens: [{ id: "R-03", titulo: "Acessos", texto: "Os acessos que precisei", tipo: "dar ok", velho: true }] }
};

test("filtro por busca ignora acento e caixa; por cor e por segmento", () => {
  const porBusca = V.filtrar(DADOS, { busca: "ACESSOS" });
  assert.equal(porBusca.agentes.length, 0);
  assert.equal(porBusca.voce.length, 1);
  assert.deepEqual(V.filtrar(DADOS, { busca: "désafio" }).agentes.map(a => a.id), ["a"]);
  const porCor = V.filtrar(DADOS, { cor: "problema" });
  assert.deepEqual(porCor.rotinas.map(r => r.nome), ["Lifeshub"]);
  assert.equal(porCor.agentes.length, 0);
  assert.equal(porCor.voce.length, 0);
  assert.equal(V.filtrar(DADOS, { cor: "atencao" }).voce.length, 1, "item velho da fila conta como atencao");
  assert.deepEqual(V.filtrar(DADOS, { segmento: "Copiloto" }).rotinas.map(r => r.nome), ["Copiloto - ciclo"]);
});

test("fala do Claude sem markdown cru", () => {
  assert.equal(V.semMarkdown("**O que deu errado:** use `npm test` e veja [o PR #5](https://github.com/x/pull/5). # Fim"),
    "O que deu errado: use npm test e veja o PR #5. # Fim");
  assert.equal(V.semMarkdown("## Resumo\n- item __um__"), "Resumo - item um");
  assert.equal(V.semMarkdown("feito. ## Proximo passo rodar"), "feito. Proximo passo rodar", "titulo que ficou no meio da linha");
  assert.equal(V.semMarkdown("edite o `__main__.py` e o `**kwargs`"), "edite o __main__.py e o **kwargs", "dentro da crase fica como esta");
  assert.equal(V.semMarkdown(null), "");
});

test("dados legiveis: limpa as falas de agentes, Hoje e fila Voce sem mexer no original", () => {
  const dados = {
    agentes: [{ id: "a", nome: "A", agora: "**Pronto:** veja `x`", pedido: "## Faça", ultimo_pedido: "[aqui](http://y)", contexto: 10 }],
    hoje: [{ titulo: "`t`", pedido: "**p**", agora: "a ## B", pasta: "C:\\x" }],
    voce: { total: 1, itens: [{ id: "R-01", titulo: "**T**", texto: "use `npm`", tipo: "dar ok" }] },
    rotinas: [{ nome: "R", texto: "rodou" }]
  };
  const l = V.legivel(dados);
  assert.deepEqual(l.agentes, [{ id: "a", nome: "A", agora: "Pronto: veja x", pedido: "Faça", ultimo_pedido: "aqui", contexto: 10 }]);
  assert.deepEqual(l.hoje, [{ titulo: "t", pedido: "p", agora: "a B", pasta: "C:\\x" }]);
  assert.deepEqual(l.voce, { total: 1, itens: [{ id: "R-01", titulo: "T", texto: "use npm", tipo: "dar ok" }] });
  assert.equal(l.rotinas, dados.rotinas);
  assert.equal(dados.agentes[0].agora, "**Pronto:** veja `x`");
  assert.deepEqual(V.legivel({ placar: 1 }), { placar: 1 });
  assert.equal(V.legivel(null), null);
});

test("linha do dia: posicao em porcentagem dentro das 24 h", () => {
  assert.equal(V.posicaoNoDia("2026-10-29T12:00:00", "2026-10-29"), 50);
  assert.equal(V.posicaoNoDia("2026-10-29T06:00", "2026-10-29"), 25);
  assert.equal(V.posicaoNoDia("2026-10-28T23:00:00", "2026-10-29"), null);
  assert.equal(V.posicaoNoDia("", "2026-10-29"), null);
});

test("o que mudou entre duas leituras", () => {
  const antes = {
    agentes: [{ id: "a", nome: "A", cor: "bem", estado: "trabalhando" }, { id: "b", nome: "B", cor: "bem", estado: "trabalhando" }],
    rotinas: [{ nome: "R", cor: "bem", texto: "rodou" }],
    voce: { total: 27 }
  };
  const depois = {
    agentes: [{ id: "a", nome: "A", cor: "atencao", estado: "esperando você" }, { id: "c", nome: "C", cor: "bem", estado: "trabalhando" }],
    rotinas: [{ nome: "R", cor: "problema", texto: "falhou" }],
    voce: { total: 25 }
  };
  const m = V.mudancas(antes, depois);
  assert.deepEqual(m.textos, ["A: trabalhando → esperando você", "C começou", "B saiu", "R: rodou → falhou", "Fila Você: 27 → 25"]);
  assert.deepEqual([...m.destaques].sort(), ["a", "c", "rotina:R"]);
  assert.deepEqual(V.mudancas(null, depois).textos, []);
});

test("fila Voce: rascunho aprova, ajusta ou descarta; tarefa responde ou e excluida; o que ja foi respondido espera o ciclo", () => {
  assert.deepEqual(V.acoesDoItem({ tipo: "dar ok", id: "R-07" }), ["aprovar", "ajuste", "descartar"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "decidir", id: "T-20261029-03" }), ["responder", "excluir"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "travada", id: "T-20261027-01" }), ["responder", "excluir"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "aguardando terceiros", id: "T-20261027-02" }), ["responder", "excluir"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "dar ok", id: "R-07", resposta: { acao: "aprovar", origem: "tela" } }), []);
  assert.deepEqual(V.acoesDoItem(null), []);
});

test("fila Voce: rotulo da resposta que espera o ciclo", () => {
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "tela" } }), "Aprovado na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "dm" } }), "Aprovado na DM · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "descartar", origem: "tela" } }), "Descartado na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "responder", origem: "tela" } }), "Ajuste pedido na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "decidir", resposta: { acao: "responder", origem: "tela" } }), "Respondido na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "decidir" }), "");
});

test("fila Voce: resposta pela tela pede o ciclo em ~1 min; passados 90 s, ou pela DM, espera o ciclo", () => {
  const em = "2026-10-30T14:00:00";  // o Copiloto grava a hora local, sem fuso
  const aos = segundos => new Date(2026, 9, 30, 14, 0, segundos).getTime();
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "tela", em } }, aos(5)), "Aprovado na tela · ciclo em ~1 min");
  assert.equal(V.rotuloDaResposta({ tipo: "decidir", resposta: { acao: "responder", origem: "tela", em } }, aos(89)), "Respondido na tela · ciclo em ~1 min");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "tela", em } }, aos(91)), "Aprovado na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "dm", em } }, aos(5)), "Aprovado na DM · espera o ciclo");
});

test("fila Voce: so link do Obsidian vira link clicavel na gaveta", () => {
  const ok = "obsidian://open?vault=Obsidian%20Vault&file=Seazone%2FTarefas%2FT-20261023-05.md";
  assert.equal(V.linkObsidian({ obsidian: ok }), ok);
  assert.equal(V.linkObsidian({ obsidian: "javascript:alert(1)" }), "");
  assert.equal(V.linkObsidian({ obsidian: "https://site.example" }), "");
  assert.equal(V.linkObsidian({}), "");
});

test("cockpit: servidor da agenda fora do ar vira instrucao clara, nao 'Failed to fetch'", () => {
  assert.match(V.mensagemDeFalha(new TypeError("Failed to fetch")), /iniciar\.cmd/);
  assert.match(V.mensagemDeFalha(new TypeError("NetworkError when attempting to fetch resource.")), /servidor da agenda/);
  assert.match(V.mensagemDeFalha(new TypeError("Load failed")), /servidor da agenda/);
  // erro de codigo da propria tela nao pode virar "servidor fora do ar"
  assert.equal(V.mensagemDeFalha(new TypeError("Cannot read properties of undefined (reading 'itens')")), "Cannot read properties of undefined (reading 'itens')");
  assert.equal(V.mensagemDeFalha(new Error("O servidor respondeu 503.")), "O servidor respondeu 503.");
});

// ------------------------------------------------------------------ Mapa de trabalho (29/10)
const tarefa = (id, cor = "atencao", sessoes = [], extra = {}) => ({ id, titulo: `tarefa ${id}`, status: "aguardando-voce", cor, aberta: true, pasta: false, sessoes, obsidian: "", ...extra });
const subs = (total, n = Math.min(total, 8)) => ({ total, ativas: 0, itens: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, descricao: `passo ${i}`, tipo: "general-purpose", cor: "sem_sinal", estado: "terminou" })) });
const sessaoFalsa = (sid, nome, sub = subs(0)) => ({ id: sid.slice(0, 8), sessao: sid, nome, cor: "atencao", estado: "esperando você", tipo: "em segundo plano", viva: false, subsessoes: sub });
const TRABALHO = {
  projetos: [
    { nome: "setup-com-prova", cor: "problema", abertas: 12, vivas: 0, sessoes: 1,
      tarefas: Array.from({ length: 12 }, (_, i) => tarefa(`T-202610${String(i + 10)}-01`, i ? "problema" : "atencao", i ? [] : ["s1"])) },
    { nome: "copiloto", cor: "atencao", abertas: 2, vivas: 0, sessoes: 0, tarefas: [tarefa("T-20261023-11"), tarefa("T-20261026-03")] },
    { nome: "Sem tarefa", cor: "bem", abertas: 0, vivas: 1, sessoes: 2,
      tarefas: [tarefa("pasta:gabri", "bem", ["s2", "s3"], { titulo: "gabri", status: "", pasta: true })] },
  ],
  sessoes: { s1: sessaoFalsa("s1", "Desafio do Marios", subs(12)), s2: sessaoFalsa("s2", "transcricao"), s3: sessaoFalsa("s3", "tasks jornada", subs(2)) },
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ------------------------------------------------------------------ Mapa de bolas e historia da tarefa (30/10)
// 18 tarefas abertas em 5 projetos e 3 pastas com sessoes sem tarefa, como em 30/10
function tarefasDoMapa() {
  const lista = [];
  let n = 0;
  for (const [grupo, k] of [["setup-com-prova", 6], ["Homologação", 4], ["copiloto", 4], ["Jornada", 2], ["Hito", 2]]) {
    for (let i = 0; i < k; i++, n++) lista.push({ id: `T-202610${10 + n}-01`, grupo, r: V.raioDaTarefa({ passos: (n * 7) % 55, cor: n % 3 ? "atencao" : "problema" }, n % 2) });
  }
  for (const pasta of ["copiloto", "gabri", "e2e"]) lista.push({ id: `pasta:${pasta}`, grupo: "Sem tarefa", r: V.raioDaTarefa({ pasta: true, sessoes: ["a", "b"] }) });
  return lista;
}
const MAPA = { x: 16, y: 12, w: 1618, h: 636 };  // o quadro do Mapa em 1536x730

function conferirBolhas({ bolhas, grupos }, caixa) {
  for (const b of bolhas) {
    assert.ok(b.x - b.r >= caixa.x - 0.5 && b.x + b.r <= caixa.x + caixa.w + 0.5 && b.y - b.r >= caixa.y - 0.5 && b.y + b.r <= caixa.y + caixa.h + 0.5, `${b.id} fora da area`);
    for (const o of bolhas) if (o !== b) assert.ok(dist(b, o) >= b.r + o.r - 0.5, `${b.id} encosta em ${o.id}`);
    const g = grupos.find(x => x.nome === b.grupo);
    assert.ok(dist(b, g) + b.r <= g.r + 0.5, `${b.id} fora do cacho de ${g.nome}`);
  }
  for (const g of grupos) {
    assert.ok(g.rotuloY - 12 >= caixa.y - 0.5, `nome de ${g.nome} fora da area`);
    for (const o of grupos) if (o !== g) assert.ok(dist(g, o) >= g.r + o.r - 0.5, `${g.nome} invade ${o.nome}`);
  }
}

test("mapa de bolas: o raio cresce com os passos, com as sessoes vivas e quando precisa dele, ate um teto", () => {
  const base = V.raioDaTarefa({ passos: 0, cor: "bem" }, 0);
  assert.ok(V.raioDaTarefa({ passos: 9, cor: "bem" }, 0) > base);
  assert.ok(V.raioDaTarefa({ passos: 0, cor: "bem" }, 2) > base);
  assert.ok(V.raioDaTarefa({ passos: 0, cor: "atencao" }, 0) > base);
  assert.ok(V.raioDaTarefa({ passos: 0, cor: "problema" }, 0) > base);
  assert.equal(V.raioDaTarefa({ passos: 500, cor: "problema" }, 9), 84);
  assert.equal(V.raioDaTarefa({ cor: "bem" }), base);  // Copiloto antigo, sem a contagem de passos
  assert.ok(V.raioDaTarefa({ pasta: true, sessoes: ["a"] }) < base);
});

test("mapa de bolas: cada projeto vira um cacho; nada se sobrepoe nem sai da area", () => {
  const r = V.layoutBolhas(tarefasDoMapa(), MAPA);
  assert.equal(r.bolhas.length, 21);
  assert.deepEqual(r.grupos.map(g => g.nome), ["setup-com-prova", "Homologação", "copiloto", "Jornada", "Hito", "Sem tarefa"]);
  conferirBolhas(r, MAPA);
  const xs = r.bolhas.map(b => b.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 0.5 * MAPA.w, "os cachos se espalham na largura da tela");
  for (const outra of [{ x: 10, y: 10, w: 1080, h: 640 }, { x: 0, y: 0, w: 600, h: 400 }]) conferirBolhas(V.layoutBolhas(tarefasDoMapa(), outra), outra);
});

test("mapa de bolas: muitas tarefas encolhem para caber; poucas nao viram bolas gigantes", () => {
  conferirBolhas(V.layoutBolhas(Array.from({ length: 60 }, (_, i) => ({ id: `T-${i}`, grupo: `p${i % 7}`, r: 60 })), MAPA), MAPA);
  const uma = V.layoutBolhas([{ id: "T-1", grupo: "copiloto", r: 40 }], MAPA);
  conferirBolhas(uma, MAPA);
  assert.ok(uma.bolhas[0].r <= 60, String(uma.bolhas[0].r));
});

test("mapa de bolas: os mesmos dados dao o mesmo desenho, para a releitura de 30 s nao mexer nas bolas", () => {
  assert.deepEqual(V.layoutBolhas(tarefasDoMapa(), MAPA), V.layoutBolhas(tarefasDoMapa(), MAPA));
  assert.deepEqual(V.layoutBolhas([], MAPA), { bolhas: [], grupos: [] });
});

test("mapa de bolas: o titulo cabe dentro da bola, e o que sobra vira '…'", () => {
  assert.deepEqual(V.textoNaBola("Pôr o apelido", 60), ["Pôr o apelido"]);
  const linhas = V.textoNaBola("Responder o formulário de baseline do recrutamento com os dados da planilha que o Xande mandou ontem", 44);
  assert.ok(linhas.length >= 2 && linhas.length <= Math.floor((1.4 * 44) / 14), JSON.stringify(linhas));
  assert.ok(linhas.every(l => l.length <= Math.floor((1.55 * 44) / 6.4)), JSON.stringify(linhas));
  assert.ok(linhas[linhas.length - 1].endsWith("…"));
  assert.ok(V.textoNaBola("Supercalifragilisticexpialidocious", 30)[0].endsWith("…"));
  assert.deepEqual(V.textoNaBola("", 40), []);
  // uma linha so fica no meio da bola, onde ela e mais larga: o nome curto da pasta cabe inteiro
  assert.deepEqual(V.textoNaBola("copiloto", 26, { letra: 5.6, altura: 12 }), ["copiloto"]);
});

test("historia: o cartao do passo mostra as frases inteiras que cabem, sem marcacao nem link", () => {
  assert.equal(V.resumoDoPasso("Rascunho **R-69** na thread. O resto fica na gaveta.", 30), "Rascunho R-69 na thread.");
  assert.equal(V.resumoDoPasso("Rascunho **R-69** na thread. O resto fica na gaveta."), "Rascunho R-69 na thread. O resto fica na gaveta.");
  assert.equal(V.resumoDoPasso("Veja https://x.example/a e o `cli.py`"), "Veja e o cli.py");
  assert.equal(V.resumoDoPasso("3.000 caracteres e nada mais. Fim.", 30), "3.000 caracteres e nada mais.");
  const longo = V.resumoDoPasso("palavra ".repeat(60), 50);
  assert.ok(longo.length <= 50 && longo.endsWith("…"), longo);
  // a hora que o texto repete no comeco ja esta no topo do cartao; o ":" que sobrou do link sai
  assert.equal(V.resumoDoPasso("29/10 19h01: o Xande respondeu ao R-81."), "O Xande respondeu ao R-81.");
  assert.equal(V.resumoDoPasso("29/10 16:3x · Você mandou ao Samuel."), "Você mandou ao Samuel.");
  assert.equal(V.resumoDoPasso("29/10 ~16h40, com o 'sim' do Gabriel."), "Com o 'sim' do Gabriel.");
  assert.equal(V.resumoDoPasso("recebido enviado ao Mario na thread: https://x.example/p1"), "recebido enviado ao Mario na thread");
  assert.equal(V.resumoDoPasso("30/10 é o prazo."), "30/10 é o prazo.");
});

test("historia: mostra os ultimos passos que cabem e navega para tras e para frente", () => {
  assert.deepEqual(V.fatiaDaHistoria(54, null, 5), { de: 49, ate: 54, antes: 49, depois: 0 });
  assert.deepEqual(V.fatiaDaHistoria(54, 0, 5), { de: 0, ate: 5, antes: 0, depois: 49 });
  assert.deepEqual(V.fatiaDaHistoria(54, 52, 5), { de: 49, ate: 54, antes: 49, depois: 0 });
  assert.deepEqual(V.fatiaDaHistoria(3, null, 5), { de: 0, ate: 3, antes: 0, depois: 0 });
  assert.deepEqual(V.fatiaDaHistoria(54, null, 0), { de: 53, ate: 54, antes: 53, depois: 0 });  // sempre ao menos um passo
  assert.deepEqual(V.fatiaDaHistoria(0, null, 5), { de: 0, ate: 0, antes: 0, depois: 0 });
});

test("historia: a sessao fica no primeiro passo que cita o id dela; sem citacao, fica no agora", () => {
  const passos = [{ texto: "criada" }, { texto: "despachada para a sessão 6422da15" }, { texto: "a sessão 6422da15 terminou" }];
  const r = V.sessoesNosPassos(passos, [{ id: "6422da15", sessao: "6422da15-aaaa", nome: "Pendências" }, { id: "b5ee32c9", sessao: "b5ee32c9-bbbb", nome: "Revisão" }]);
  assert.deepEqual(Object.keys(r.porPasso), ["1"]);
  assert.equal(r.porPasso[1][0].nome, "Pendências");
  assert.deepEqual(r.noAgora.map(s => s.nome), ["Revisão"]);
  assert.deepEqual(V.sessoesNosPassos([], []), { porPasso: {}, noAgora: [] });
});

test("historia: o agora diz se precisa dele, se travou ou quem cuida", () => {
  assert.deepEqual(V.agoraDaHistoria({ tipo: "voce" }), { rotulo: "Precisa de você", cor: "atencao" });
  assert.deepEqual(V.agoraDaHistoria({ tipo: "travada" }), { rotulo: "Travada", cor: "problema" });
  assert.deepEqual(V.agoraDaHistoria({ tipo: "trabalhando" }), { rotulo: "Trabalhando", cor: "bem" });
  assert.deepEqual(V.agoraDaHistoria({ tipo: "fila" }), { rotulo: "Na fila do Copiloto", cor: "sem_sinal" });
  assert.deepEqual(V.agoraDaHistoria({ tipo: "fechada" }), { rotulo: "Fechada", cor: "sem_sinal" });
  assert.deepEqual(V.agoraDaHistoria(undefined), { rotulo: "Agora", cor: "sem_sinal" });
});

function conferirGrafo(g, caixa) {
  const chaves = new Set(g.nos.map(n => n.chave));
  assert.equal(chaves.size, g.nos.length, "chave repetida");
  for (const a of g.arestas) assert.ok(chaves.has(a.de) && chaves.has(a.para), `${a.de} -> ${a.para}`);
  for (const n of g.nos) assert.ok(n.x - n.r >= 0 && n.x + n.r <= caixa.w && n.y - n.r >= 0 && n.y + n.r <= caixa.h, n.chave);
  const colunas = {};
  for (const n of g.nos) (colunas[n.x] ||= []).push(n);
  for (const col of Object.values(colunas)) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) assert.ok(col[i].y - col[i - 1].y >= col[i].r + col[i - 1].r, `${col[i - 1].chave} encosta em ${col[i].chave}`);
  }
}

test("grafo do projeto: tarefas, sessoes e ate 3 subsessoes por sessao, com '+N' no resto", () => {
  const caixa = { w: 1100, h: 660 };
  const g = V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "setup-com-prova" }, caixa);
  conferirGrafo(g, caixa);
  assert.equal(g.titulo, "setup-com-prova");
  const tipos = g.nos.reduce((m, n) => ({ ...m, [n.tipo]: (m[n.tipo] || 0) + 1 }), {});
  assert.deepEqual(tipos, { projeto: 1, tarefa: 12, sessao: 1, sub: 3, mais: 1 });
  assert.ok(g.arestas.some(a => a.de === "tarefa:T-20261010-01" && a.para === "sessao:s1"));
  assert.equal(g.nos.find(n => n.tipo === "mais").rotulo, "+9 subsessões");
  assert.equal(g.nos.find(n => n.tipo === "sub").sessao, "s1");
});

test("grafo da tarefa: as sessoes dela e ate 8 subsessoes; 'Sem tarefa' mostra as pastas", () => {
  const caixa = { w: 1100, h: 660 };
  const g = V.grafoDoItem(TRABALHO, { tipo: "tarefa", id: "T-20261010-01" }, caixa);
  conferirGrafo(g, caixa);
  assert.equal(g.nos.filter(n => n.tipo === "sub").length, 8);
  assert.equal(g.nos.find(n => n.tipo === "mais").rotulo, "+4 subsessões");
  const sem = V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "Sem tarefa" }, caixa);
  conferirGrafo(sem, caixa);
  assert.deepEqual(sem.nos.filter(n => n.tipo === "pasta").map(n => n.rotulo), ["Sem tarefa · gabri"]);
  assert.deepEqual(sem.nos.filter(n => n.tipo === "sessao").map(n => n.rotulo).sort(), ["tasks jornada", "transcricao"]);
});

test("grafo: alvo que nao existe (ou sem dados) nao desenha nada", () => {
  assert.equal(V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "nao existe" }), null);
  assert.equal(V.grafoDoItem(TRABALHO, { tipo: "tarefa", id: "T-1" }), null);
  assert.equal(V.grafoDoItem(null, { tipo: "projeto", id: "copiloto" }), null);
});

test("conversa: ferramentas seguidas viram um item so; o resto fica como esta", () => {
  const f = (quem, texto) => ({ quem, texto, hora: "29/10 17:00" });
  const g = V.agruparFalas([f("voce", "Revise"), f("claude", "Vou ler."), f("ferramenta", "Bash: a"), f("ferramenta", "Read: b"),
    f("ferramenta", "Grep: c"), f("claude", "Pronto."), f("ferramenta", "Bash: d")]);
  assert.deepEqual(g.map(x => [x.quem, x.texto]), [["voce", "Revise"], ["claude", "Vou ler."], ["ferramentas", "3 ferramentas"],
    ["claude", "Pronto."], ["ferramenta", "Bash: d"]]);
  assert.deepEqual(g[2].itens.map(x => x.texto), ["Bash: a", "Read: b", "Grep: c"]);
  assert.deepEqual(V.agruparFalas([]), []);
});

test("conversa: negrito, codigo, titulo e link http viram trechos; outro esquema fica como texto", () => {
  assert.deepEqual(V.trechosDaFala("## Onde estão\nVeja **isto** e `cli.py` em [mensagem](https://x.example/a?b=1) ou https://y.example/c."), [
    { tipo: "negrito", texto: "Onde estão" }, { tipo: "texto", texto: "\nVeja " }, { tipo: "negrito", texto: "isto" }, { tipo: "texto", texto: " e " },
    { tipo: "codigo", texto: "cli.py" }, { tipo: "texto", texto: " em " }, { tipo: "link", texto: "mensagem", href: "https://x.example/a?b=1" },
    { tipo: "texto", texto: " ou " }, { tipo: "link", texto: "https://y.example/c", href: "https://y.example/c" }, { tipo: "texto", texto: "." }]);
  assert.deepEqual(V.trechosDaFala("[x](javascript:alert(1))"), [{ tipo: "texto", texto: "[x](javascript:alert(1))" }]);
  assert.deepEqual(V.trechosDaFala(""), []);
});

test("sessao: terminal nao responde pela tela; trabalhando manda quando parar; viva pode parar", () => {
  assert.deepEqual(V.acoesDaSessao({ tipo: "interativa", estado: "parada", viva: true }),
    { pode: false, motivo: "Aberta num terminal: responda por lá.", enviar: "", parar: false, fila: 0 });
  assert.deepEqual(V.acoesDaSessao({ tipo: "em segundo plano", estado: "trabalhando", viva: true, na_fila: 2 }),
    { pode: true, motivo: "", enviar: "Mandar quando parar", parar: true, fila: 2 });
  assert.deepEqual(V.acoesDaSessao({ tipo: "em segundo plano", estado: "esperando você: R-77", viva: false }),
    { pode: true, motivo: "", enviar: "Enviar", parar: false, fila: 0 });
  assert.equal(V.acoesDaSessao(null).pode, false);
});

// ------------------------------------------------------------------ entrega 3: Ouvir e Ditar
test("ouvir: a voz e pt-BR, preferindo a natural (Edge) e depois a do Google", () => {
  const maria = { name: "Microsoft Maria - Portuguese (Brazil)", lang: "pt-BR" };
  const google = { name: "Google português do Brasil", lang: "pt-BR" };
  const francisca = { name: "Microsoft Francisca Online (Natural) - Portuguese (Brazil)", lang: "pt-BR" };
  const david = { name: "Microsoft David - English (United States)", lang: "en-US" };
  assert.equal(V.escolherVoz([david, maria, google, francisca]), francisca);
  assert.equal(V.escolherVoz([david, maria, google]), google);
  assert.equal(V.escolherVoz([david, { name: "Joana", lang: "pt_BR" }]).name, "Joana");
  assert.equal(V.escolherVoz([david, { name: "Joana", lang: "pt-PT" }]).name, "Joana");
  assert.equal(V.escolherVoz([david]), null);
  assert.equal(V.escolherVoz(undefined), null);
});

test("ouvir: cada frase vira uma fala, para a voz do Google nao cortar no meio", () => {
  assert.deepEqual(V.frasesParaFalar("Você pediu o mapa. Terminou?  Falta aprovar!"), ["Você pediu o mapa.", "Terminou?", "Falta aprovar!"]);
  assert.deepEqual(V.frasesParaFalar("Sem ponto no fim"), ["Sem ponto no fim"]);
  assert.deepEqual(V.frasesParaFalar("   "), []);
});

test("ditar: o que ele dita entra depois do que ja estava na caixa, junto com o trecho ainda provisorio", () => {
  assert.equal(V.juntarDitado("", ["revise o PR"]), "revise o PR");
  assert.equal(V.juntarDitado("Pode seguir.", [" e depois", " mescle "]), "Pode seguir. e depois mescle");
  assert.equal(V.juntarDitado("Pode seguir.  ", []), "Pode seguir.");
});

test("ditar: sem reconhecimento de voz no navegador nao ha ditado", () => {
  const R = function Reconhecer() {};
  assert.equal(V.suporteDitado({}), null);
  assert.equal(V.suporteDitado(undefined), null);
  assert.equal(V.suporteDitado({ webkitSpeechRecognition: R }), R);
  assert.equal(V.suporteDitado({ SpeechRecognition: R }), R);
});

test("ditar: o erro do reconhecimento vira um aviso que ele entende", () => {
  assert.match(V.erroDoDitado("not-allowed"), /microfone/);
  assert.match(V.erroDoDitado("service-not-allowed"), /microfone/);
  assert.match(V.erroDoDitado("audio-capture"), /microfone/);
  assert.match(V.erroDoDitado("no-speech"), /Não ouvi/);
  assert.match(V.erroDoDitado("network"), /internet/);
  assert.equal(V.erroDoDitado("aborted"), "");
  assert.match(V.erroDoDitado("bad-grammar"), /bad-grammar/);
});

// ------------------------------------------------------------------ excluir tarefa (29/10)
test("excluir: o aviso diz que a nota fica no vault e cita a sessao que continua viva", () => {
  assert.equal(V.avisoDaExclusao([]), "Tarefa excluída: fica no vault como descartada.");
  assert.equal(V.avisoDaExclusao(["Revisão do PR"]),
    "Tarefa excluída: fica no vault como descartada. A sessão Revisão do PR continua; o Parar está na gaveta dela.");
  assert.equal(V.avisoDaExclusao(["A", "B"]),
    "Tarefa excluída: fica no vault como descartada. As sessões A e B continuam; o Parar está na gaveta de cada uma.");
  assert.equal(V.avisoDaExclusao(undefined), "Tarefa excluída: fica no vault como descartada.");
});

test("excluir: a tarefa excluida sai da fila e do Mapa ate o Copiloto confirmar", () => {
  const dados = {
    voce: { total: 3, itens: [{ tipo: "decidir", id: "T-20261029-01" }, { tipo: "dar ok", id: "R-07", tarefa: "T-20261029-01" }, { tipo: "decidir", id: "T-20261029-02" }] },
    trabalho: { projetos: [{ nome: "p", abertas: 2, tarefas: [
      { id: "T-20261029-01", aberta: true, status: "aguardando-voce", sessoes: [] },
      { id: "T-20261029-02", aberta: true, status: "aguardando-voce", sessoes: ["s1"] }] }],
    sessoes: { s1: { nome: "Revisão", viva: true } } } };
  const r = V.semExcluidas(dados, new Set(["T-20261029-01", "T-20261029-02"]));
  assert.deepEqual(r.dados.voce.itens.map(i => i.id), ["R-07"]);  // o rascunho ligado a tarefa fica: ele descarta a parte
  assert.equal(r.dados.voce.total, 1);
  // com sessao viva a tarefa fica no Mapa, fechada, como o Copiloto mostra
  assert.deepEqual(r.dados.trabalho.projetos[0].tarefas.map(t => [t.id, t.aberta, t.status]), [["T-20261029-02", false, "descartada"]]);
  assert.equal(r.dados.trabalho.projetos[0].abertas, 0);
  assert.deepEqual([...r.pendentes].sort(), ["T-20261029-01", "T-20261029-02"]);
  assert.equal(dados.voce.itens.length, 3, "nao mexe nos dados recebidos");
  const confirmada = { voce: { total: 1, itens: [{ tipo: "dar ok", id: "R-07" }] },
    trabalho: { projetos: [{ nome: "p", abertas: 0, tarefas: [{ id: "T-20261029-02", aberta: false, status: "descartada", sessoes: ["s1"] }] }], sessoes: {} } };
  assert.deepEqual([...V.semExcluidas(confirmada, new Set(["T-20261029-01", "T-20261029-02"])).pendentes], []);
  assert.equal(V.semExcluidas(dados, new Set()).dados, dados);
});

// ------------------------------------------------------------------ Rotinas recolhivel (30/10)
test("rotinas recolhidas: o selo mostra a pior cor, para um erro nao passar despercebido", () => {
  const r = cor => ({ nome: cor, cor });
  assert.deepEqual(V.resumoRotinas([r("bem"), r("bem"), r("problema"), r("atencao")]), { cor: "problema", texto: "1 erro" });
  assert.deepEqual(V.resumoRotinas([r("bem"), r("atencao"), r("atencao")]), { cor: "atencao", texto: "2 atenção" });
  assert.deepEqual(V.resumoRotinas([r("bem"), r("bem"), r("sem_sinal")]), { cor: "bem", texto: "2 ok" });
  assert.deepEqual(V.resumoRotinas([]), { cor: "sem_sinal", texto: "nenhuma" });
});
