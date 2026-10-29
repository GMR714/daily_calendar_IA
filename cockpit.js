"use strict";
// Tela /cockpit: o que a IA esta fazendo agora, a partir do `cli.py cockpit --json` do Copiloto (rota /api/cockpit).
(() => {
  const V = window.CockpitView;
  const CORES = ["problema", "atencao", "bem", "sem_sinal"];
  const ROTULO = { problema: "Problema", atencao: "Atenção", bem: "Bem", sem_sinal: "Sem sinal" };
  const DESC = { problema: "caiu, parou ou falhou", atencao: "vivo, com algo a olhar", bem: "rodando e respondendo", sem_sinal: "parado ou sem dados" };
  const ZONA = { bem: "tranquilo", atencao: "grande; vale um /compact quando fechar a etapa", problema: "acima de ~500 mil, onde o Claude começa a errar mais", sem_sinal: "sem dado" };
  const TIPOS = ["dar ok", "decidir", "aguardando terceiros", "travada"];
  const NOME_TIPO = { "dar ok": "Dar ok", decidir: "Decidir", "aguardando terceiros": "Terceiros", travada: "Travadas" };
  const PREFIXOS = ["Copiloto - ", "Seazone Uso IA ", "claude-switcher-"];

  const ui = lerPreferencias();
  let resposta = null;
  let recebidoEm = 0;
  let destaques = new Set();
  let naAgenda = new Set();
  let timer = null;
  let toastTimer = null;
  let carregandoAgora = false;
  let gaveta = null;
  const $ = id => document.getElementById(id);

  function lerPreferencias() {
    const padrao = { aba: "painel", cor: null, segmento: null, tipoFila: null, frente: null, coluna: "agentes" };
    let lido = { ...padrao };
    try { lido = { ...padrao, ...JSON.parse(localStorage.getItem("cockpit:ui") || "{}") }; } catch { /* sem armazenamento */ }
    const aba = location.hash.slice(1);  // /cockpit#mapa abre direto no mapa
    if (["painel", "mapa", "hoje"].includes(aba)) lido.aba = aba;
    return { ...lido, busca: "" };
  }
  function salvarPreferencias() {
    try { const { busca, ...resto } = ui; localStorage.setItem("cockpit:ui", JSON.stringify(resto)); } catch { /* sem armazenamento: só não lembra */ }
    history.replaceState(null, "", `#${ui.aba}`);
  }

  // Elementos sempre montados com texto (nunca HTML vindo dos dados).
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const f of filhos.flat(Infinity)) if (f !== null && f !== undefined && f !== false && f !== "") el.append(f instanceof Node ? f : String(f));
    return el;
  }
  function s(tag, attrs, ...filhos) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const f of filhos.flat(Infinity)) if (f !== null && f !== undefined) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
    return el;
  }
  const bolinha = cor => h("span", { class: `bolinha ${cor}`, title: ROTULO[cor] });
  const curto = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const doisDigitos = n => String(n).padStart(2, "0");
  const hojeChave = () => { const d = new Date(); return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`; };
  const agoraLocal = () => { const d = new Date(); return `${hojeChave()}T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:00`; };
  const horaDe = iso => (iso ? String(iso).replace("T", " ").slice(0, 16) : "");
  const linha = (rotulo, valor) => (valor ? h("div", {}, h("dt", {}, rotulo), h("dd", {}, valor)) : null);
  const rotuloCurto = nome => { const p = PREFIXOS.find(x => nome.startsWith(x)); return p ? nome.slice(p.length) : nome; };
  function debounce(fn, ms) { let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

  // ------------------------------------------------------------------ dados
  async function carregar(force = false) {
    if (carregandoAgora && !force) return;
    carregandoAgora = true;
    marcarVivo();
    try {
      const r = await fetch("/api/cockpit" + (force ? "?force=1" : ""), { cache: "no-store" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || `O servidor respondeu ${r.status}.`);
      const anterior = resposta && resposta.dados;
      corpo.dados = V.legivel(corpo.dados);
      resposta = corpo;
      recebidoEm = Date.now();
      const m = V.mudancas(anterior, corpo.dados);
      if (m.textos.length) {
        destaques = m.destaques;
        toast("O que mudou desde a última leitura", m.textos.slice(0, 6));
        setTimeout(() => { destaques = new Set(); renderizar(); }, 15000);
      }
      aviso(corpo.erro ? `Mostrando a última leitura. ${corpo.erro}` : "");
      renderizar();
    } catch (erro) {
      if (!resposta) mostrarFalha(V.mensagemDeFalha(erro));
      else aviso(`Não consegui atualizar: ${V.mensagemDeFalha(erro)}`);
    } finally {
      carregandoAgora = false;
      marcarVivo();
      clearTimeout(timer);
      timer = setTimeout(() => carregar(false), resposta && resposta.atualizando ? 6000 : 30000);
    }
  }
  async function carregarAgenda() {
    try {
      const d = await (await fetch("/api/state", { cache: "no-store" })).json();
      naAgenda = new Set((d.entries || []).map(e => String(e.fingerprint || "")).filter(f => f.startsWith("cockpit::")).map(f => f.slice(9)));
    } catch { /* sem agenda: os botões só não sabem o que já foi levado */ }
  }
  async function levarParaAgenda(item, botao) {
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Levando…";
    const titulo = item.tipo === "dar ok" ? `Copiloto: revisar e dar ${item.comando} (${item.titulo})` : `Copiloto: ${NOME_TIPO[item.tipo] || item.tipo} · ${item.titulo}`;
    try {
      const r = await fetch("/api/cockpit/agenda", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, titulo: curto(titulo, 200), texto: item.texto || "", tipo: item.tipo }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui criar a tarefa.");
      naAgenda.add(item.id);
      toast(corpo.alreadyExists ? "Esse item já estava na agenda." : "Tarefa de 30 min criada na agenda, com prazo hoje.");
      renderizar();
    } catch (erro) {
      botao.disabled = false;
      botao.textContent = rotulo;
      toast(erro.message);
    }
  }
  function copiar(texto, mensagem) {
    navigator.clipboard.writeText(texto).then(() => toast(mensagem), () => toast("Não consegui copiar; selecione o texto e copie."));
  }

  // Resposta a um item da fila Voce: vai para a caixa de entrada do Copiloto, que o proximo ciclo trata
  // (o mesmo caminho do "ok R-NN" da DM). Nada sai daqui direto para ninguem.
  const digitado = new Map();
  async function responder(item, acao, texto, botao) {
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Gravando…";
    try {
      const r = await fetch("/api/copiloto/responder", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, item: item.id, texto }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "O Copiloto não aceitou a resposta.");
      item.resposta = { acao, em: new Date().toISOString(), origem: "tela" };
      digitado.delete(item.id);
      toast(corpo.entrada && corpo.entrada.repetida ? "Essa resposta já estava gravada." : "Resposta gravada: o Copiloto trata no próximo ciclo.",
        ["Para ser agora, use Rodar agora, no topo."]);
      renderizar();
    } catch (erro) {
      botao.disabled = false;
      botao.textContent = rotulo;
      toast(erro.message);
    }
  }
  async function rodarAgora() {
    const botao = $("rodarAgora");
    botao.disabled = true;
    botao.textContent = "Pedindo…";
    try {
      const r = await fetch("/api/copiloto/rodar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui pedir o ciclo.");
      toast(corpo.texto || "Ciclo pedido.");
    } catch (erro) {
      toast(erro.message);
    } finally {
      botao.disabled = false;
      marcarRodar();
    }
  }
  function marcarRodar() {
    const n = ((resposta && resposta.dados && resposta.dados.voce && resposta.dados.voce.itens) || []).filter(i => i.resposta).length;
    $("rodarAgora").textContent = n ? `Rodar agora · ${n}` : "Rodar agora";
    $("rodarAgora").title = `${n ? `${n} resposta${n > 1 ? "s" : ""} esperando o ciclo. ` : ""}Pede um ciclo do Copiloto agora: ele espera a vez e nunca derruba o que está rodando.`;
  }
  // Aprovar sai em nome do Gabriel: so na gaveta, com a mensagem inteira a vista. Com um ajuste escrito, aprovar fica
  // travado (o texto seria ignorado); descartar pede um segundo clique no proprio botao.
  function painelResposta(i, acoes) {
    const rascunho = i.tipo === "dar ok";
    const caixa = h("textarea", { class: "resposta-texto", rows: "3", maxlength: "4000",
      placeholder: rascunho ? "Para pedir ajuste: o que mudar na mensagem" : "Sua resposta para o Copiloto (ex.: pode seguir com a opção B)" });
    caixa.value = digitado.get(i.id) || "";
    const aprovar = acoes.includes("aprovar") ? h("button", { class: "botao pequeno", type: "button", title: "Envia a mensagem como está, em seu nome",
      onclick: ev => responder(i, "aprovar", "", ev.currentTarget) }, "Aprovar e enviar") : null;
    const dica = aprovar ? h("p", { class: "dica-resposta", hidden: true }, "Com um ajuste escrito, a mensagem não sai como está: use Pedir ajuste ou apague o texto.") : null;
    const travarAprovar = () => { if (aprovar) { aprovar.disabled = Boolean(caixa.value.trim()); dica.hidden = !aprovar.disabled; } };
    caixa.addEventListener("input", () => { digitado.set(i.id, caixa.value); travarAprovar(); });
    travarAprovar();
    const comTexto = (acao, ev) => {
      const texto = caixa.value.trim();
      if (!texto) { caixa.focus(); return toast(rascunho ? "Escreva o que mudar na mensagem." : "Escreva a resposta."); }
      responder(i, acao, texto, ev.currentTarget);
    };
    const descartar = acoes.includes("descartar") ? h("button", { class: "botao pequeno perigo", type: "button", onclick: ev => {
      const b = ev.currentTarget;
      if (b.dataset.confirmar) return responder(i, "descartar", "", b);
      b.dataset.confirmar = "1";
      b.textContent = "Confirmar descarte";
      setTimeout(() => { if (b.isConnected && !b.disabled) { delete b.dataset.confirmar; b.textContent = "Descartar"; } }, 4000);
    } }, "Descartar") : null;
    return h("div", { class: "resposta-painel" }, caixa, dica, h("div", { class: "acoes" },
      aprovar,
      acoes.includes("ajuste") ? h("button", { class: "botao pequeno secundario", type: "button", onclick: ev => comTexto("responder", ev) }, "Pedir ajuste") : null,
      acoes.includes("responder") ? h("button", { class: "botao pequeno", type: "button", onclick: ev => comTexto("responder", ev) }, "Responder") : null,
      descartar));
  }

  // ------------------------------------------------------------------ estado geral
  function marcarVivo() {
    const vivo = $("vivo");
    vivo.classList.toggle("atualizando", carregandoAgora || Boolean(resposta && resposta.atualizando));
    vivo.classList.toggle("erro", Boolean(resposta && resposta.erro));
    $("atualizar").disabled = carregandoAgora;
    $("atualizar").textContent = carregandoAgora ? "Lendo…" : "Atualizar";
    if (!resposta) { $("vivoTexto").textContent = carregandoAgora ? "lendo o Copiloto…" : "sem dados"; return; }
    const idade = (resposta.idadeSegundos || 0) + (Date.now() - recebidoEm) / 1000;
    $("vivoTexto").textContent = `${carregandoAgora || resposta.atualizando ? "atualizando" : "ao vivo"} · dados ${V.idade(idade)}`;
  }
  function aviso(texto) {
    $("aviso").hidden = !texto;
    $("aviso").textContent = texto;
    $("aviso").className = "aviso erro";
  }
  function toast(titulo, linhas = []) {
    const el = $("toast");
    el.replaceChildren(h("b", {}, titulo), linhas.length ? h("ul", {}, linhas.map(l => h("li", {}, l))) : null);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, linhas.length ? 8000 : 3500);
  }
  function mostrarCarregando() {
    $("alertas").replaceChildren(h("div", { class: "carregando" }, h("span", { class: "giro" }),
      "Lendo o Copiloto: agentes, rotinas e a sua fila. A primeira leitura leva uns 10 segundos."));
  }
  function mostrarFalha(mensagem) {
    $("alertas").replaceChildren(h("div", { class: "falha" }, h("h2", {}, "Não consegui ler o Copiloto"), h("p", {}, mensagem),
      h("button", { class: "botao", type: "button", onclick: () => { mostrarCarregando(); carregar(true); } }, "Tentar de novo")));
  }
  function botaoSegmento(rotulo, n, ativo, onclick) {
    return h("button", { type: "button", "aria-pressed": String(ativo), onclick }, rotulo, h("span", { class: "n" }, n));
  }

  // ------------------------------------------------------------------ desenho
  function renderizar() {
    if (!resposta) return;
    const d = resposta.dados;
    const f = V.filtrar(d, { busca: ui.busca, cor: ui.cor });
    document.querySelectorAll(".abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === ui.aba)));
    for (const aba of ["painel", "mapa", "hoje"]) $("aba-" + aba).hidden = ui.aba !== aba;
    document.body.dataset.coluna = ui.coluna; // em tela estreita, as colunas viram abas
    document.querySelectorAll(".colunas-abas button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.coluna === ui.coluna)));
    $("alertas").replaceChildren();
    renderKpis(d);
    if (ui.aba === "painel") {
      renderAgentes(f.agentes);
      renderFila(f.voce, d);
      renderRotinas(V.filtrar(d, { busca: ui.busca, cor: ui.cor, segmento: ui.segmento }).rotinas, f.rotinas);
    } else if (ui.aba === "mapa") renderMapa(d, f);
    else renderHoje(d);
    marcarRodar();
    // redesenhar a gaveta no meio de uma resposta apagaria o que ele esta digitando
    const digitando = document.activeElement && document.activeElement.tagName === "TEXTAREA" && $("gaveta").contains(document.activeElement);
    if (gaveta && !digitando) abrirGaveta(gaveta.tipo, gaveta.id, true);
  }

  function renderKpis(d) {
    const p = d.placar || {};
    // Uma linha de chips: o numero de cada cor filtra a tela inteira.
    const cartoes = CORES.map(c => h("button", { class: `kpi ${c}${ui.cor === c ? " ativo" : ""}`, type: "button", "aria-pressed": String(ui.cor === c),
      title: `${DESC[c]}. ${ui.cor === c ? "Clique para tirar o filtro." : "Clique para mostrar só isso."}`,
      onclick: () => { ui.cor = ui.cor === c ? null : c; salvarPreferencias(); renderizar(); } },
      h("span", { class: "numero" }, p[c] || 0), h("span", { class: "nome" }, bolinha(c), ROTULO[c])));
    const v = d.voce || {};
    cartoes.push(h("button", { class: "kpi voce", type: "button", title: v.total ? `O mais antigo espera há ${v.mais_antigo_dias} dias. Clique para ver a fila.` : "Nada na fila",
      onclick: () => { ui.aba = "painel"; ui.tipoFila = null; ui.coluna = "voce"; salvarPreferencias(); renderizar(); } },
      h("span", { class: "numero" }, v.total || 0), h("span", { class: "nome" }, "Esperando você")));
    const m = d.maquina || {};
    const nota = d.nota;
    const gb = x => (x === null || x === undefined ? "—" : `${Number(x).toFixed(1).replace(".", ",")} GB`);
    cartoes.push(h("div", { class: "kpi maquina", title: "Memória e disco livres; organização do workspace pela auditoria" },
      h("span", { class: "nome" }, "Máquina"),
      h("span", { class: "desc" }, bolinha(m.memoria_livre_gb < 2 ? "atencao" : "bem"), ` memória ${gb(m.memoria_livre_gb)}`),
      h("span", { class: "desc" }, bolinha(m.disco_livre_gb < 20 ? "atencao" : "bem"), ` disco ${m.disco_livre_gb == null ? "—" : Math.round(m.disco_livre_gb) + " GB"}`),
      nota ? h("span", { class: "desc" }, bolinha(nota.nota >= 75 ? "bem" : nota.nota >= 50 ? "atencao" : "problema"), ` organização ${nota.nota}/100`) : null));
    $("kpis").replaceChildren(...cartoes);
  }

  function renderAgentes(agentes) {
    $("n-agentes").textContent = `${agentes.length} ${agentes.length === 1 ? "sessão viva" : "sessões vivas"}`;
    const grupos = V.gruposAgentes(agentes).filter(g => g.itens.length);
    if (!grupos.length) {
      $("agentes").replaceChildren(h("p", { class: "vazio" }, ui.busca || ui.cor ? "Nenhum agente com esse filtro." : "Nenhuma sessão viva agora."));
      return;
    }
    $("agentes").replaceChildren(...grupos.flatMap(g => [h("div", { class: "grupo-titulo" }, h("span", {}, g.titulo), h("span", {}, g.itens.length)), ...g.itens.map(linhaAgente)]));
  }
  // Linha compacta (2 linhas): nome e hora; estado e contexto. O resto fica na gaveta.
  function linhaAgente(a) {
    const ctx = V.medidorContexto(a.contexto);
    const abrir = () => abrirGaveta("agente", a.id);
    return h("article", { class: `linha cor-${a.cor}${destaques.has(a.id) ? " mudou" : ""}`, tabindex: "0", role: "button", title: a.agora || a.estado,
      onclick: abrir, onkeydown: e => { if (e.key === "Enter") abrir(); } },
      h("div", { class: "linha-1" }, bolinha(a.cor), h("b", {}, a.nome), a.papel && a.papel !== "sessão" ? h("span", { class: `chip ${a.papel}` }, a.papel) : null,
        h("span", { class: "quando" }, a.atualizado ? `às ${a.atualizado}` : "")),
      h("div", { class: "linha-2" }, h("span", { class: `texto estado-${a.cor}` }, a.estado),
        h("span", { class: "mini-medidor", title: `Contexto: ${ctx.rotulo} tokens, ${ZONA[ctx.cor]}` }, h("span", { class: `medidor-preench ${ctx.cor}`, style: `width:${ctx.pct}%` })),
        h("span", { class: "medidor-rotulo" }, ctx.rotulo)));
  }

  function renderFila(itens, d) {
    const v = d.voce || {};
    $("n-voce").textContent = v.total ? `${v.total} itens · o mais antigo há ${v.mais_antigo_dias} d` : "nada esperando";
    const conta = t => itens.filter(i => i.tipo === t).length;
    $("voce-filtros").replaceChildren(
      botaoSegmento("Todos", itens.length, !ui.tipoFila, () => { ui.tipoFila = null; salvarPreferencias(); renderizar(); }),
      ...TIPOS.filter(conta).map(t => botaoSegmento(NOME_TIPO[t], conta(t), ui.tipoFila === t,
        () => { ui.tipoFila = ui.tipoFila === t ? null : t; salvarPreferencias(); renderizar(); })));
    const lista = itens.filter(i => !ui.tipoFila || i.tipo === ui.tipoFila);
    $("voce").replaceChildren(...(lista.length ? lista.map(linhaFila) : [h("p", { class: "vazio" }, v.total ? "Nada com esse filtro." : "Nada esperando você.")]));
  }
  const idadeDoItem = i => (i.dias === null || i.dias === undefined ? "" : i.dias === 0 ? "hoje" : `há ${i.dias} d`);
  // Linha compacta (2 linhas): tipo, titulo e idade; o texto e as acoes. As acoes ficam sempre embaixo, para o titulo
  // ter a linha inteira. Responder abre a gaveta, com o texto inteiro.
  function linhaFila(i) {
    const levado = naAgenda.has(i.id);
    const abrir = () => abrirGaveta("voce", i.id);
    const espera = V.rotuloDaResposta(i);
    const acoes = [
      espera ? h("span", { class: "espera-ciclo", title: "O Copiloto trata no próximo ciclo; Rodar agora, no topo, adianta" }, espera)
        : V.acoesDoItem(i).length ? h("button", { class: "mini principal", type: "button",
          title: i.tipo === "dar ok" ? "Ler a mensagem inteira e aprovar, pedir ajuste ou descartar" : "Responder ao Copiloto",
          onclick: e => { e.stopPropagation(); abrir(); } }, i.tipo === "dar ok" ? "Revisar" : "Responder") : null,
      h("button", { class: `mini${levado ? " feito" : ""}`, type: "button", disabled: levado, title: "Cria uma tarefa de 30 min, com prazo hoje, na sua agenda",
        onclick: e => { e.stopPropagation(); levarParaAgenda(i, e.currentTarget); } }, levado ? "✓ agenda" : "+ agenda")];
    return h("article", { class: `linha${i.velho ? " cor-atencao" : ""}`, tabindex: "0", role: "button", title: i.texto || i.titulo,
      onclick: abrir, onkeydown: e => { if (e.key === "Enter" && e.target === e.currentTarget) abrir(); } },
      h("div", { class: "linha-1" }, h("span", { class: "tipo" }, NOME_TIPO[i.tipo] || i.tipo), h("b", {}, i.titulo),
        h("span", { class: `quando${i.velho ? " velha" : ""}` }, idadeDoItem(i))),
      h("div", { class: "linha-2" }, h("span", { class: "texto" }, i.texto || ""), acoes));
  }

  function renderRotinas(rotinas, semSegmento) {
    const conta = Object.fromEntries(CORES.map(c => [c, rotinas.filter(r => r.cor === c).length]));
    $("n-rotinas").textContent = `${conta.bem} ok · ${conta.atencao} atenção · ${conta.problema} erro`;
    const segmentos = [...new Set(semSegmento.map(r => r.segmento))].sort((a, b) => a.localeCompare(b));
    $("rotinas-filtros").replaceChildren(
      botaoSegmento("Todas", semSegmento.length, !ui.segmento, () => { ui.segmento = null; salvarPreferencias(); renderizar(); }),
      ...segmentos.map(sg => botaoSegmento(sg, semSegmento.filter(r => r.segmento === sg).length, ui.segmento === sg,
        () => { ui.segmento = ui.segmento === sg ? null : sg; salvarPreferencias(); renderizar(); })));
    const dia = hojeChave();
    const pAgora = V.posicaoNoDia(agoraLocal(), dia);
    $("linha-dia").replaceChildren(...[0, 6, 12, 18, 24].map(hh => h("span", { style: `left:${(hh / 24) * 100}%` }, `${hh}h`)));
    const lista = rotinas.slice().sort((a, b) => V.ORDEM_COR[a.cor] - V.ORDEM_COR[b.cor] || a.nome.localeCompare(b.nome));
    $("rotinas").replaceChildren(...(lista.length ? lista.map(r => linhaRotina(r, dia, pAgora)) : [h("p", { class: "vazio" }, "Nenhuma rotina com esse filtro.")]));
  }
  function linhaRotina(r, dia, pAgora) {
    const pu = V.posicaoNoDia(r.ultima, dia);
    const pp = V.posicaoNoDia(r.proxima, dia);
    const abrir = () => abrirGaveta("rotina", r.nome);
    return h("article", { class: `linha linha-rotina${destaques.has("rotina:" + r.nome) ? " mudou" : ""}`, tabindex: "0", role: "button",
      title: `${r.nome} · ${r.agenda || r.onde} · ${r.texto}`, onclick: abrir, onkeydown: e => { if (e.key === "Enter") abrir(); } },
      h("div", { class: "linha-1" }, bolinha(r.cor), h("b", {}, r.nome), h("span", { class: `situ t-${r.cor}` }, r.texto)),
      h("div", { class: "trilho", title: "Hoje, de 0h a 24h: ponto cheio = última execução, ponto vazado = próxima, traço vermelho = agora" },
        pu !== null ? h("i", { class: `ult ${r.cor}`, style: `left:${pu}%`, title: `última: ${horaDe(r.ultima)}` }) : null,
        pp !== null ? h("i", { class: "prox", style: `left:${pp}%`, title: `próxima: ${horaDe(r.proxima)}` }) : null,
        pAgora !== null ? h("i", { class: "agora", style: `left:${pAgora}%` }) : null));
  }

  function grupoMapa(svg, x, y, w, hh, titulo) {
    svg.append(s("rect", { x, y, width: w, height: hh, rx: 18, class: "mapa-grupo" }), s("text", { x: x + 18, y: y + 24, class: "mapa-grupo-titulo" }, titulo));
  }
  function noMapa(svg, [x, y], cor, rotulo, onclick, { r = 10, apagado = false, acima = false, max = 28 } = {}) {
    const g = s("g", { class: "no", transform: `translate(${x},${y})`, opacity: apagado ? 0.22 : 1, tabindex: "0", role: "button" },
      s("title", {}, rotulo), s("circle", { r: r + 7, class: `aura ${cor}` }), s("circle", { r, class: `bola ${cor}` }),
      s("text", { y: acima ? -(r + 11) : r + 18, "text-anchor": "middle" }, curto(rotulo, max)));
    g.addEventListener("click", onclick);
    g.addEventListener("keydown", e => { if (e.key === "Enter") onclick(); });
    svg.append(g);
  }
  function irParaFila(tipo) {
    ui.aba = "painel"; ui.tipoFila = tipo; ui.coluna = "voce"; salvarPreferencias(); renderizar();
  }
  function renderMapa(d, f) {
    const svg = $("mapa");
    svg.replaceChildren();
    const visiveis = new Set(f.agentes.map(a => a.id));
    const filtrando = Boolean(ui.busca || ui.cor);
    const ag = d.agentes;
    const nuvem = d.rotinas.filter(r => String(r.onde).startsWith("nuvem"));
    const locais = d.rotinas.filter(r => !String(r.onde).startsWith("nuvem"));
    grupoMapa(svg, 20, 20, 700, 290, `NOTEBOOK · ${ag.length} ${ag.length === 1 ? "AGENTE VIVO" : "AGENTES VIVOS"}`);
    grupoMapa(svg, 740, 20, 340, 290, `NUVEM · ${nuvem.length} ${nuvem.length === 1 ? "ROTINA" : "ROTINAS"}`);
    const pos = {};
    const orqs = ag.filter(a => a.papel === "orquestradora");
    const outros = ag.filter(a => a.papel !== "orquestradora");
    orqs.forEach((a, i) => { pos[a.id] = [100, 100 + i * 76]; });
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(outros.length * 1.6))));
    outros.forEach((a, i) => { pos[a.id] = [230 + ((i % cols) + 0.5) * (470 / cols), 92 + Math.floor(i / cols) * 66]; });
    for (const o of orqs) for (const w of outros.filter(a => a.papel === "worker"))
      svg.append(s("line", { x1: pos[o.id][0], y1: pos[o.id][1], x2: pos[w.id][0], y2: pos[w.id][1], class: "aresta" }));
    for (const a of ag) noMapa(svg, pos[a.id], a.cor, a.nome, () => abrirGaveta("agente", a.id), { r: a.papel === "orquestradora" ? 15 : 11, apagado: filtrando && !visiveis.has(a.id), max: 18 });
    nuvem.forEach((r, i) => noMapa(svg, [830 + (i % 2) * 165, 100 + Math.floor(i / 2) * 66], r.cor, r.nome, () => abrirGaveta("rotina", r.nome)));

    const v = d.voce || {};
    const cx = 550, cy = 405;
    const tipos = Object.entries(v.por_tipo || {});
    tipos.forEach(([t, n], i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(tipos.length, 1);
      const x = cx + 190 * Math.cos(ang), y = cy + 74 * Math.sin(ang);
      const velho = (v.itens || []).some(it => it.tipo === t && it.velho);
      svg.append(s("line", { x1: cx, y1: cy, x2: x, y2: y, class: "aresta voce" }));
      noMapa(svg, [x, y], velho ? "atencao" : "bem", `${NOME_TIPO[t] || t} · ${n}`, () => irParaFila(t), { r: 9, acima: y < cy - 1 });
    });
    const corVoce = v.total ? (v.mais_antigo_dias >= 3 ? "atencao" : "bem") : "bem";
    const g = s("g", { class: "no", transform: `translate(${cx},${cy})`, tabindex: "0", role: "button" },
      s("title", {}, "O que espera a sua decisão"), s("circle", { r: 50, class: `aura ${corVoce}` }), s("circle", { r: 40, class: `bola ${corVoce}` }),
      s("text", { y: 2, "text-anchor": "middle", class: "voce-num" }, String(v.total || 0)), s("text", { y: 18, "text-anchor": "middle", class: "voce-rot" }, "VOCÊ"));
    g.addEventListener("click", () => irParaFila(null));
    svg.append(g);

    grupoMapa(svg, 20, 505, 1060, 140, `ROTINAS NO NOTEBOOK · ${locais.length}`);
    const grupos = {};
    for (const r of locais) (grupos[r.segmento] = grupos[r.segmento] || []).push(r);
    const nomes = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
    let larguras = nomes.map(k => Math.max(160, (1020 * grupos[k].length) / Math.max(locais.length, 1)));
    const soma = larguras.reduce((a, b) => a + b, 0);
    larguras = larguras.map(w => (w * 1020) / soma);
    let x0 = 40;
    nomes.forEach((k, gi) => {
      const lista = grupos[k].sort((a, b) => a.nome.localeCompare(b.nome));
      const w = larguras[gi];
      const colunas = lista.length > 2 ? Math.ceil(lista.length / 2) : lista.length;
      if (gi > 0) svg.append(s("line", { x1: x0, y1: 540, x2: x0, y2: 632, class: "aresta voce" }));
      svg.append(s("text", { x: x0 + 10, y: 552, class: "mapa-grupo-titulo" }, `${k.toUpperCase()} · ${lista.length}`));
      lista.forEach((r, i) => noMapa(svg, [x0 + ((i % colunas) + 0.5) * (w / colunas), 578 + Math.floor(i / colunas) * 44], r.cor, rotuloCurto(r.nome),
        () => abrirGaveta("rotina", r.nome), { r: 8, apagado: ui.segmento && r.segmento !== ui.segmento, max: Math.max(10, Math.floor(w / colunas / 6.6)) }));
      x0 += w;
    });
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "tracejado azul: a orquestradora e os workers dela"), h("span", {}, "clique num ponto para ver o detalhe"));
  }

  function renderHoje(d) {
    const vivos = d.agentes.filter(a => a.atualizado).map(a => ({ hora: a.atualizado, titulo: a.nome, frente: a.frente, pedido: a.pedido, agora: a.agora, viva: true, id: a.id, cor: a.cor }));
    const itens = [...vivos, ...(d.hoje || []).map(x => ({ ...x, viva: false }))].sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
    const frentes = [...new Set(itens.map(x => x.frente).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const termo = V.semAcento(ui.busca).trim();
    const lista = itens.filter(x => (!ui.frente || x.frente === ui.frente) && (!termo || [x.titulo, x.pedido, x.agora, x.frente].some(c => V.semAcento(c).includes(termo))));
    $("hoje").replaceChildren(
      h("div", { class: "segmentos hoje-filtros" },
        botaoSegmento("Todas as frentes", itens.length, !ui.frente, () => { ui.frente = null; salvarPreferencias(); renderizar(); }),
        ...frentes.map(fr => botaoSegmento(fr, itens.filter(x => x.frente === fr).length, ui.frente === fr, () => { ui.frente = ui.frente === fr ? null : fr; salvarPreferencias(); renderizar(); }))),
      lista.length
        ? h("div", { class: "tempo" }, lista.map(x => h("div", { class: `marco${x.viva ? " viva" : ""}` }, h("span", { class: "hora" }, x.hora),
          h("article", { class: `cartao cor-${x.viva ? x.cor : "sem_sinal"}`, style: x.viva ? "cursor:pointer" : null, onclick: x.viva ? () => abrirGaveta("agente", x.id) : null },
            h("div", { class: "cartao-topo" }, h("div", { class: "cartao-titulo" }, h("b", {}, x.titulo || x.frente || "sessão"), h("div", { class: "sub" }, x.frente || "", x.viva ? " · viva agora" : ""))),
            x.pedido ? h("p", {}, h("b", {}, "Pediram: "), x.pedido) : null,
            x.agora ? h("p", {}, h("b", {}, "Disse por último: "), x.agora) : null))))
        : h("p", { class: "vazio" }, "Nenhuma sessão com esse filtro hoje."));
  }

  // ------------------------------------------------------------------ gaveta de detalhe
  function abrirGaveta(tipo, id, silencioso = false) {
    const d = resposta && resposta.dados;
    if (!d) return;
    let corpo = null;
    if (tipo === "agente") {
      const a = d.agentes.find(x => x.id === id);
      if (!a) return fecharGaveta();
      const ctx = V.medidorContexto(a.contexto);
      corpo = [h("p", { class: "eyebrow" }, `${a.papel} · ${a.tipo}`), h("h3", {}, a.nome), h("p", { class: `estado estado-${a.cor}` }, a.estado),
        h("dl", { class: "detalhes" }, linha("O que disse por último", a.agora), linha("O que pediram", a.pedido),
          linha("Último pedido", a.ultimo_pedido !== a.pedido ? a.ultimo_pedido : ""), linha("Ferramenta em uso", a.ferramenta),
          linha("Contexto", `${ctx.rotulo} tokens: ${ZONA[ctx.cor]}`), linha("Pasta", a.pasta + (a.branch ? ` (branch ${a.branch})` : "")),
          linha("Atualizado", a.atualizado), linha("Abrir a sessão", a.comando ? h("code", {}, a.comando) : "")),
        a.comando ? h("div", { class: "acoes" }, h("button", { class: "botao pequeno", type: "button", onclick: () => copiar(a.comando, "Comando copiado.") }, "Copiar attach")) : null];
    } else if (tipo === "rotina") {
      const r = d.rotinas.find(x => x.nome === id);
      if (!r) return fecharGaveta();
      corpo = [h("p", { class: "eyebrow" }, r.segmento), h("h3", {}, r.nome), h("p", { class: `estado estado-${r.cor}` }, r.texto),
        h("dl", { class: "detalhes" }, linha("Agenda", r.agenda), linha("Onde roda", r.onde), linha("Última execução", horaDe(r.ultima)),
          linha("Próxima", horaDe(r.proxima)), linha("Execuções", r.link ? h("a", { href: r.link, target: "_blank", rel: "noopener" }, "abrir no GitHub") : ""))];
    } else if (tipo === "voce") {
      const i = ((d.voce && d.voce.itens) || []).find(x => x.id === id);
      if (!i) return fecharGaveta();
      const levado = naAgenda.has(i.id);
      const acoes = V.acoesDoItem(i);
      const espera = V.rotuloDaResposta(i);
      corpo = [h("p", { class: "eyebrow" }, `${NOME_TIPO[i.tipo] || i.tipo} · ${i.id}`), h("h3", {}, i.titulo),
        espera ? h("p", { class: "estado estado-atencao" }, espera) : null,
        i.mensagem ? h("div", { class: "mensagem-completa", tabindex: "0", "aria-label": "Mensagem que vai sair em seu nome" }, i.mensagem) : null,
        h("dl", { class: "detalhes" }, i.mensagem ? null : linha("O que é", i.texto), linha("Esperando", idadeDoItem(i)),
          linha("Tarefa", i.tarefa && i.tarefa !== i.id ? i.tarefa : ""), linha("Pela DM", i.comando ? h("code", {}, i.comando) : ""),
          linha("Nota", V.linkObsidian(i) ? h("a", { href: V.linkObsidian(i) }, "Abrir a nota no Obsidian") : "")),
        acoes.length ? painelResposta(i, acoes) : null,
        h("div", { class: "acoes" },
          h("button", { class: `botao pequeno secundario${levado ? " feito" : ""}`, type: "button", disabled: levado, title: "Cria uma tarefa de 30 min, com prazo hoje, na sua agenda",
            onclick: ev => levarParaAgenda(i, ev.currentTarget) }, levado ? "✓ Na agenda" : "Levar para a agenda"))];
    }
    if (!corpo) return;
    gaveta = { tipo, id };
    $("gavetaCorpo").replaceChildren(...corpo.filter(Boolean));
    $("gaveta").classList.add("aberta");
    $("gaveta").setAttribute("aria-hidden", "false");
    $("veu").hidden = false;
    if (!silencioso) $("fecharGaveta").focus();
  }
  function fecharGaveta() {
    gaveta = null;
    $("gaveta").classList.remove("aberta");
    $("gaveta").setAttribute("aria-hidden", "true");
    $("veu").hidden = true;
  }

  // ------------------------------------------------------------------ eventos
  NavRail.montar($("rail"), { ativo: "cockpit" });
  document.querySelectorAll(".abas button").forEach(b => b.addEventListener("click", () => { ui.aba = b.dataset.aba; salvarPreferencias(); renderizar(); }));
  document.querySelectorAll(".colunas-abas button").forEach(b => b.addEventListener("click", () => { ui.coluna = b.dataset.coluna; salvarPreferencias(); renderizar(); }));
  $("busca").addEventListener("input", debounce(e => { ui.busca = e.target.value; renderizar(); }, 120));
  $("atualizar").addEventListener("click", () => carregar(true));
  $("rodarAgora").addEventListener("click", rodarAgora);
  $("fecharGaveta").addEventListener("click", fecharGaveta);
  $("veu").addEventListener("click", fecharGaveta);
  document.addEventListener("keydown", e => {
    const digitando = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !digitando) { e.preventDefault(); $("busca").focus(); }
    else if (e.key === "Escape") {
      if (gaveta) fecharGaveta();
      else if (digitando) { $("busca").value = ""; ui.busca = ""; $("busca").blur(); renderizar(); }
    } else if ((e.key === "r" || e.key === "R") && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) carregar(true);
  });
  setInterval(marcarVivo, 1000);

  document.querySelectorAll(".abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === ui.aba)));
  for (const aba of ["painel", "mapa", "hoje"]) $("aba-" + aba).hidden = ui.aba !== aba;
  mostrarCarregando();
  carregarAgenda().then(renderizar);
  carregar(false);
})();
