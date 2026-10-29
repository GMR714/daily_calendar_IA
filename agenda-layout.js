// Escala do calendario: o horario do dia cabe na altura util da tela (docs/specs/navegacao-e-telas.md).
// Mesmo esquema do planner-core.js: vale no navegador e nos testes.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgendaLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ESCALA_PADRAO = 1.3; // px por minuto de antes, para quando a tela esta escondida e nao tem altura
  const MINIMA = 34 / 60;    // abaixo de 34 px por hora o texto nao cabe; o calendario passa a rolar por dentro
  const MAXIMA = 96 / 60;

  function escalaDoDia({ altura, minutos }) {
    if (!(altura > 0) || !(minutos > 0)) return ESCALA_PADRAO;
    return Math.min(MAXIMA, Math.max(MINIMA, altura / minutos));
  }

  // Com a hora encolhendo, um bloco de 1 h pode ter 40 px: a densidade sai da altura em px, nao dos minutos.
  // tiny: hora e titulo numa linha; compact: horario e titulo em ate 2 linhas; comfortable: titulo em 3 e a meta.
  function densidadeDoBloco(px) {
    return px < 56 ? "tiny" : px < 100 ? "compact" : "comfortable";
  }

  return { escalaDoDia, densidadeDoBloco };
});
