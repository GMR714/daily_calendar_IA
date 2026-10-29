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
