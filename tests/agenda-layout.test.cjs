const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../agenda-layout");

test("o horario visivel do dia cabe na altura util do calendario, entre 34 e 96 px por hora", () => {
  assert.equal(Math.round(L.escalaDoDia({ altura: 570, minutos: 780 }) * 1000) / 1000, 0.731, "08-21 em 570 px");
  assert.equal(L.escalaDoDia({ altura: 3000, minutos: 780 }), 96 / 60, "tela alta nao estica sem limite");
  assert.equal(L.escalaDoDia({ altura: 200, minutos: 780 }), 34 / 60, "tela baixa: minimo legivel, o calendario rola por dentro");
  assert.equal(L.escalaDoDia({ altura: 0, minutos: 780 }), 1.3, "tela escondida mantem a escala antiga");
  assert.equal(L.escalaDoDia({ altura: 570, minutos: 0 }), 1.3);
});

test("a densidade do bloco vem da altura que ele ocupa na tela, nao dos minutos", () => {
  assert.equal(L.densidadeDoBloco(22), "tiny");
  assert.equal(L.densidadeDoBloco(41), "tiny", "1 h com a hora encolhida: uma linha so, hora e titulo");
  assert.equal(L.densidadeDoBloco(55), "tiny");
  assert.equal(L.densidadeDoBloco(56), "compact");
  assert.equal(L.densidadeDoBloco(82), "compact", "2 h: horario e titulo em duas linhas");
  assert.equal(L.densidadeDoBloco(99), "compact");
  assert.equal(L.densidadeDoBloco(100), "comfortable");
});
