// Menu lateral unico da agenda e do cockpit (docs/specs/navegacao-e-telas.md).
// Mesmo esquema do planner-core.js: os itens valem no navegador e nos testes.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NavRail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ICONES = {
    agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    checklist: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5L7.5 17"/>',
    cockpit: '<path d="M3.5 15a8.5 8.5 0 1 1 17 0"/><path d="m12 15 4.5-4.5"/><path d="M5 19.5h14"/>',
    cantinho: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="12" y="11" width="7" height="7" rx="1"/>',
    planos: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
    ajustes: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'
  };
  const ITENS = [
    { chave: "agenda", rotulo: "Agenda", href: "/#agenda" },
    { chave: "checklist", rotulo: "Checklist", href: "/#checklist" },
    { chave: "cockpit", rotulo: "Cockpit", href: "/cockpit" },
    { chave: "cantinho", rotulo: "Cantinho", acao: "cantinho", separar: true, dica: "Abre o painel compacto, sempre por cima das outras janelas" },
    { chave: "planos", rotulo: "Planos", href: "/#planos", dica: "Metas, todas as tarefas e o historico" },
    { chave: "ajustes", rotulo: "Ajustes", href: "/#ajustes", dica: "Disponibilidade, motor de IA e backup" }
  ];
  const TELAS_DA_AGENDA = ["agenda", "checklist", "planos", "ajustes"];

  function itensDoMenu(ativo) {
    return ITENS.map(item => ({ ...item, icone: ICONES[item.chave], ativo: item.chave === ativo }));
  }

  function telaDoHash(hash) {
    const tela = String(hash || "").replace(/^#/, "");
    return TELAS_DA_AGENDA.includes(tela) ? tela : "agenda";
  }

  // ---------------------------------------------------------------- navegador
  function montar(nav, { ativo } = {}) {
    nav.classList.add("rail");
    nav.setAttribute("aria-label", "Menu");
    nav.innerHTML = itensDoMenu(ativo).map(item => {
      const conteudo = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${item.icone}</svg><span>${item.rotulo}</span>`;
      const classe = `rail-item${item.ativo ? " ativo" : ""}${item.separar ? " separar" : ""}`;
      const dica = item.dica ? ` title="${item.dica}"` : "";
      return item.href
        ? `<a class="${classe}" href="${item.href}" data-chave="${item.chave}"${item.ativo ? ' aria-current="page"' : ""}${dica}>${conteudo}</a>`
        : `<button class="${classe}" type="button" data-chave="${item.chave}"${dica}>${conteudo}</button>`;
    }).join("") + '<div class="rail-rodape"><span id="syncStatus" role="status"></span></div>';
    nav.querySelector('[data-chave="cantinho"]').addEventListener("click", abrirCantinho);
  }

  function marcar(nav, ativo) {
    nav.querySelectorAll(".rail-item").forEach(item => {
      const sim = item.dataset.chave === ativo;
      item.classList.toggle("ativo", sim);
      if (item.tagName === "A") { if (sim) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); }
    });
  }

  async function abrirCantinho(evento) {
    const botao = evento.currentTarget;
    botao.disabled = true;
    try {
      const resposta = await fetch("/api/overlay/abrir", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(corpo.error || `O servidor respondeu ${resposta.status}.`);
      aviso(corpo.jaAberto ? "O painel já está aberto no canto da tela." : "Painel aberto no canto da tela.");
    } catch (erro) {
      aviso(`Não consegui abrir o painel: ${erro.message}`, true);
    } finally {
      botao.disabled = false;
    }
  }

  let timerAviso = null;
  function aviso(texto, erro = false) {
    let caixa = document.querySelector(".rail-aviso");
    if (!caixa) {
      caixa = document.createElement("div");
      caixa.className = "rail-aviso";
      caixa.setAttribute("role", "status");
      document.body.append(caixa);
    }
    caixa.textContent = texto;
    caixa.classList.toggle("erro", erro);
    caixa.hidden = false;
    clearTimeout(timerAviso);
    timerAviso = setTimeout(() => { caixa.hidden = true; }, 4500);
  }

  return { itensDoMenu, telaDoHash, montar, marcar, aviso };
});
