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

  return { idade, medidorContexto, gruposAgentes, filtrar, posicaoNoDia, mudancas, semAcento, ORDEM_COR };
});
