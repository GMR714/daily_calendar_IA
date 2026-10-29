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

test("fila Voce: rascunho aprova, ajusta ou descarta; tarefa responde; o que ja foi respondido espera o ciclo", () => {
  assert.deepEqual(V.acoesDoItem({ tipo: "dar ok", id: "R-07" }), ["aprovar", "ajuste", "descartar"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "decidir", id: "T-20261029-03" }), ["responder"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "travada", id: "T-20261027-01" }), ["responder"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "aguardando terceiros", id: "T-20261027-02" }), ["responder"]);
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

test("fila Voce: so link do Obsidian vira link clicavel na gaveta", () => {
  const ok = "obsidian://open?vault=Obsidian%20Vault&file=Seazone%2FTarefas%2FT-20261023-05.md";
  assert.equal(V.linkObsidian({ obsidian: ok }), ok);
  assert.equal(V.linkObsidian({ obsidian: "javascript:alert(1)" }), "");
  assert.equal(V.linkObsidian({ obsidian: "https://site.example" }), "");
  assert.equal(V.linkObsidian({}), "");
});
