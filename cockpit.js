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
  let alvoMapa = null;  // grafo aberto no Mapa: { tipo: "projeto" | "tarefa", id }
  const conversas = new Map();  // "sessao|subagente" → { falas, antes, carregando, erro }
  const sessoesVistas = new Map();  // ultima leitura de cada sessao aberta na gaveta
  const digitadoSessao = new Map();  // resposta que ele esta escrevendo, por sessao
  const resumos = new Map();  // sessao → { texto, fonte, aviso, carregando, erro } do Ouvir
  let falando = null;  // sessao cujo resumo a voz esta lendo
  let ditado = null;  // { sessao, rec } enquanto o microfone ouve
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
    el.replaceChildren(...[h("b", {}, titulo), linhas.length ? h("ul", {}, linhas.map(l => h("li", {}, l))) : null].filter(Boolean));  // null viraria o texto "null"
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
    if (gaveta && !digitando && !ditado) abrirGaveta(gaveta.tipo, gaveta.id, true);  // nem no meio de um ditado
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
  function noMapa(svg, [x, y], cor, rotulo, onclick, { r = 10, apagado = false, acima = false, max = 28, semRotulo = false, dica = "" } = {}) {
    const g = s("g", { class: "no", transform: `translate(${x},${y})`, opacity: apagado ? 0.22 : 1, tabindex: "0", role: "button" },
      s("title", {}, dica || rotulo), s("circle", { r: r + 7, class: `aura ${cor}` }), s("circle", { r, class: `bola ${cor}` }),
      semRotulo ? null : s("text", { y: acima ? -(r + 11) : r + 18, "text-anchor": "middle" }, curto(rotulo, max)));
    g.addEventListener("click", onclick);
    g.addEventListener("keydown", e => { if (e.key === "Enter") onclick(); });
    svg.append(g);
  }
  function irParaFila(tipo) {
    ui.aba = "painel"; ui.tipoFila = tipo; ui.coluna = "voce"; salvarPreferencias(); renderizar();
  }
  // Mapa de trabalho (docs/specs/mapa-de-trabalho.md): cada bola grande e um projeto, as bolinhas em volta sao as
  // tarefas dele. O clique abre o grafo do projeto ou da tarefa no mesmo quadro; "← Mapa" (ou Esc) volta.
  // A largura do desenho acompanha a da tela (altura fixa de 660): em 1536×730 sobra largura, e e ela que da espaco
  // aos projetos. O SVG continua com 100% do quadro, entao trocar o viewBox nao muda o tamanho dele.
  function larguraDoMapa(svg) {
    const r = svg.getBoundingClientRect();
    const W = r.width > 0 && r.height > 0 ? Math.round(Math.min(1800, Math.max(1100, (660 * r.width) / r.height))) : 1100;
    svg.setAttribute("viewBox", `0 0 ${W} 660`);
    return W;
  }
  function renderMapa(d, f) {
    const svg = $("mapa");
    svg.replaceChildren();
    $("mapaTopo").hidden = !alvoMapa;
    const W = larguraDoMapa(svg);
    if (alvoMapa && d.trabalho) {
      const g = V.grafoDoItem(d.trabalho, alvoMapa, { w: W, h: 660 });
      if (g) return renderGrafo(svg, g, d.trabalho, W);
      alvoMapa = null;  // o item saiu do mapa (tarefa fechada, sessão encerrada): volta ao Mapa
      $("mapaTopo").hidden = true;
    }
    renderTrabalho(svg, d.trabalho, W - 380);
    const nuvem = d.rotinas.filter(r => String(r.onde).startsWith("nuvem"));
    const locais = d.rotinas.filter(r => !String(r.onde).startsWith("nuvem"));
    const xd = W - 340;  // coluna da direita: nuvem e voce
    grupoMapa(svg, xd, 20, 320, 130, `NUVEM · ${nuvem.length} ${nuvem.length === 1 ? "ROTINA" : "ROTINAS"}`);
    const naNuvem = nuvem.slice(0, 3);
    naNuvem.forEach((r, i) => noMapa(svg, [xd + (i + 0.5) * (320 / naNuvem.length), 84], r.cor, r.nome, () => abrirGaveta("rotina", r.nome), { max: 22 }));
    if (nuvem.length > 3) svg.append(s("text", { x: W - 34, y: 140, "text-anchor": "end", class: "mais-rot" }, `+${nuvem.length - 3}`));

    const v = d.voce || {};
    grupoMapa(svg, xd, 165, 320, 325, `VOCÊ · ${v.total || 0} ${v.total === 1 ? "ITEM" : "ITENS"}`);
    const cx = xd + 160, cy = 335;
    const tipos = Object.entries(v.por_tipo || {});
    tipos.forEach(([t, n], i) => {
      const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(tipos.length, 1);
      const x = cx + 105 * Math.cos(ang), y = cy + 100 * Math.sin(ang);
      const velho = (v.itens || []).some(it => it.tipo === t && it.velho);
      svg.append(s("line", { x1: cx, y1: cy, x2: x, y2: y, class: "aresta voce" }));
      noMapa(svg, [x, y], velho ? "atencao" : "bem", `${NOME_TIPO[t] || t} · ${n}`, () => irParaFila(t), { r: 9, acima: y < cy - 1, max: 20 });
    });
    const corVoce = v.total ? (v.mais_antigo_dias >= 3 ? "atencao" : "bem") : "bem";
    const g = s("g", { class: "no", transform: `translate(${cx},${cy})`, tabindex: "0", role: "button" },
      s("title", {}, "O que espera a sua decisão"), s("circle", { r: 50, class: `aura ${corVoce}` }), s("circle", { r: 40, class: `bola ${corVoce}` }),
      s("text", { y: 2, "text-anchor": "middle", class: "voce-num" }, String(v.total || 0)), s("text", { y: 18, "text-anchor": "middle", class: "voce-rot" }, "VOCÊ"));
    g.addEventListener("click", () => irParaFila(null));
    svg.append(g);

    grupoMapa(svg, 20, 505, W - 40, 140, `ROTINAS NO NOTEBOOK · ${locais.length}`);
    const grupos = {};
    for (const r of locais) (grupos[r.segmento] = grupos[r.segmento] || []).push(r);
    const nomes = Object.keys(grupos).sort((a, b) => a.localeCompare(b));
    const util = W - 80;
    let larguras = nomes.map(k => Math.max(160, (util * grupos[k].length) / Math.max(locais.length, 1)));
    const soma = larguras.reduce((a, b) => a + b, 0);
    larguras = larguras.map(w => (w * util) / soma);
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
      h("span", {}, "bola grande: projeto; bolinhas em volta: as tarefas dele"), h("span", {}, "clique para abrir o grafo de sessões"));
  }

  function renderTrabalho(svg, t, largura) {
    if (!t) {
      grupoMapa(svg, 20, 20, largura, 470, "TRABALHO");
      svg.append(s("text", { x: 40, y: 84, class: "mapa-aviso" }, "O Copiloto instalado ainda não manda o mapa de trabalho."),
        s("text", { x: 40, y: 104, class: "mapa-aviso" }, "Mescle o PR dele e rode git pull em C:\\Dev\\Dev Seazone\\copiloto."));
      return;
    }
    const sessoes = Object.values(t.sessoes || {});
    const abertas = t.projetos.reduce((n, p) => n + p.abertas, 0);
    grupoMapa(svg, 20, 20, largura, 470, `TRABALHO · ${t.projetos.length} PROJETOS · ${abertas} TAREFAS ABERTAS · ${sessoes.length} SESSÕES (${sessoes.filter(x => x.viva).length} NA MEMÓRIA)`);
    const termo = V.semAcento(ui.busca).trim();
    const casa = (...campos) => !termo || campos.some(c => V.semAcento(c).includes(termo));
    for (const c of V.layoutTrabalho(t.projetos, { x: 30, y: 44, w: largura - 20, h: 440 }).celulas) {
      const p = t.projetos.find(x => x.nome === c.nome);
      const tarefaApagada = x => Boolean((ui.cor && x.cor !== ui.cor) || !casa(p.nome, x.id, x.titulo));
      const apagado = p.tarefas.every(tarefaApagada);
      for (const x of c.tarefas) svg.append(s("line", { x1: c.x, y1: c.y, x2: x.x, y2: x.y, class: "aresta orbita", opacity: apagado ? 0.25 : 1 }));
      const conta = p.nome === "Sem tarefa" ? `${p.sessoes} ${p.sessoes === 1 ? "sessão" : "sessões"}` : `${p.abertas} ${p.abertas === 1 ? "tarefa" : "tarefas"}`;
      noMapa(svg, [c.x, c.y], c.cor, p.nome, () => abrirGrafo("projeto", p.nome),
        { r: c.r, apagado, semRotulo: true, dica: `${p.nome}: ${conta}, ${p.sessoes} ${p.sessoes === 1 ? "sessão" : "sessões"} (${p.vivas} na memória). Clique para o grafo.` });
      svg.append(s("text", { x: c.x, y: c.rotuloY, "text-anchor": "middle", class: "projeto-rot", opacity: apagado ? 0.35 : 1 }, curto(p.nome, Math.max(10, Math.floor(c.largura / 7.4)))),
        s("text", { x: c.x, y: c.rotuloY + 13, "text-anchor": "middle", class: "projeto-num", opacity: apagado ? 0.35 : 1 }, conta));
      for (const x of c.tarefas) noMapa(svg, [x.x, x.y], x.cor, x.titulo, () => abrirGrafo("tarefa", x.id),
        { r: x.r, apagado: apagado || tarefaApagada(x), semRotulo: true, dica: x.pasta ? `Sem tarefa · ${x.titulo}` : `${x.id} · ${x.titulo} (${x.status})` });
      if (c.mais) {
        const mais = s("text", { x: c.mais.x, y: c.mais.y + 4, "text-anchor": "middle", class: "mais-rot", tabindex: "0", role: "button" }, `+${c.mais.n}`);
        mais.addEventListener("click", () => abrirGrafo("projeto", p.nome));
        svg.append(mais);
      }
    }
  }

  // Grafo do projeto ou da tarefa: camadas da esquerda para a direita, arestas curvas, rotulo a direita de cada no.
  function renderGrafo(svg, g, t, W) {
    const sessoes = g.nos.filter(n => n.tipo === "sessao").length;
    const projeto = g.tipo === "tarefa" ? (t.projetos.find(p => p.tarefas.some(x => x.id === alvoMapa.id)) || {}).nome : null;
    $("mapaTrilha").replaceChildren(...[
      projeto ? h("button", { class: "trilha-link", type: "button", onclick: () => abrirGrafo("projeto", projeto) }, projeto) : null,
      projeto ? " › " : null, h("b", {}, g.titulo), h("small", {}, sessoes ? `${sessoes} ${sessoes === 1 ? "sessão" : "sessões"}` : "nenhuma sessão ativa")].filter(Boolean));
    const por = new Map(g.nos.map(n => [n.chave, n]));
    for (const a of g.arestas) {
      const de = por.get(a.de), para = por.get(a.para), meio = (de.x + para.x) / 2;
      svg.append(s("path", { d: `M ${de.x} ${de.y} C ${meio} ${de.y}, ${meio} ${para.y}, ${para.x} ${para.y}`, class: "aresta grafo" }));
    }
    const colunas = [...new Set(g.nos.map(n => n.x))].sort((a, b) => a - b);
    for (const n of g.nos) {
      const proxima = colunas.find(x => x > n.x);
      const espaco = (proxima === undefined ? W : proxima - 14) - n.x - n.r - 10;
      const acao = acaoDoNo(n);
      const no = s("g", { class: `no no-grafo${n.nivel === 0 ? " raiz" : ""}${acao ? "" : " parado"}`, transform: `translate(${n.x},${n.y})`, tabindex: acao ? "0" : null, role: acao ? "button" : null },
        s("title", {}, [n.rotulo, n.dica].filter(Boolean).join(" · ")), s("circle", { r: n.r + 5, class: `aura ${n.cor}` }), s("circle", { r: n.r, class: `bola ${n.cor}` }),
        s("text", { x: n.r + 8, y: 4 }, curto(n.rotulo, Math.max(6, Math.floor(espaco / (n.nivel === 0 ? 8 : 6.6))))));
      if (acao) {
        no.addEventListener("click", acao);
        no.addEventListener("keydown", e => { if (e.key === "Enter") acao(); });
      }
      svg.append(no);
    }
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "clique numa sessão para ler a conversa; numa tarefa, para o grafo dela"));
  }
  // O que o clique em cada no do grafo faz: tarefa abre o grafo dela (ou o detalhe, se ja e o grafo dela); sessao e
  // subsessao abrem a conversa; "+N subsessoes" abre a sessao.
  function acaoDoNo(n) {
    if (n.tipo === "tarefa") return n.nivel === 0 ? () => abrirGaveta("tarefa", n.id) : () => abrirGrafo("tarefa", n.id);
    if (n.tipo === "pasta") return n.nivel === 0 ? null : () => abrirGrafo("tarefa", n.id);
    if (n.tipo === "sessao") return () => abrirGaveta("sessao", n.id);
    if (n.tipo === "sub") return () => abrirGaveta("sub", `${n.sessao}:${n.id}`);
    if (n.tipo === "mais" && n.sessao) return () => abrirGaveta("sessao", n.sessao);
    return null;
  }
  function abrirGrafo(tipo, id) {
    alvoMapa = { tipo, id };
    renderizar();
  }
  function voltarAoMapa() {
    alvoMapa = null;
    renderizar();
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
    if (!silencioso && gaveta && (gaveta.tipo !== tipo || gaveta.id !== id)) { pararDitado(); pararDeOuvir(); }
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
    else if (tipo === "tarefa") corpo = gavetaTarefa(d, id);
    else if (tipo === "sessao" || tipo === "sub") corpo = gavetaSessao(d, tipo, id, silencioso);
    if (!corpo) return fecharGaveta();
    // a releitura de 30 s redesenha a gaveta: a conversa volta para onde ele estava lendo
    const lida = silencioso && $("gavetaCorpo").querySelector(".conversa");
    const rolagem = lida ? lida.scrollTop : null;
    gaveta = { tipo, id };
    $("gavetaCorpo").replaceChildren(...corpo.filter(Boolean));
    $("gaveta").classList.toggle("larga", tipo === "sessao" || tipo === "sub");
    const nova = $("gavetaCorpo").querySelector(".conversa");
    if (nova) nova.scrollTop = rolagem === null ? nova.scrollHeight : rolagem;
    $("gaveta").classList.add("aberta");
    $("gaveta").setAttribute("aria-hidden", "false");
    $("veu").hidden = false;
    if (!silencioso) $("fecharGaveta").focus();
  }
  // Tarefa do Mapa: status, projeto, sessoes e a nota. Se ela esta na fila Voce, o botao leva a resposta da fase 1.
  function gavetaTarefa(d, id) {
    const projeto = ((d.trabalho && d.trabalho.projetos) || []).find(p => p.tarefas.some(x => x.id === id));
    if (!projeto) return null;
    const t = projeto.tarefas.find(x => x.id === id);
    const naFila = ((d.voce && d.voce.itens) || []).find(i => i.id === id || i.tarefa === id);
    const nomes = t.sessoes.map(sid => (d.trabalho.sessoes[sid] || {}).nome).filter(Boolean);
    return [h("p", { class: "eyebrow" }, `tarefa · ${projeto.nome}`), h("h3", {}, t.titulo), h("p", { class: `estado estado-${t.cor}` }, t.status || "sem status"),
      h("dl", { class: "detalhes" }, linha("Id", t.id), linha("Sessões", nomes.join("\n") || "nenhuma sessão ativa"),
        linha("Nota", V.linkObsidian(t) ? h("a", { href: V.linkObsidian(t) }, "Abrir a nota no Obsidian") : "")),
      h("div", { class: "acoes" },
        naFila ? h("button", { class: "botao pequeno", type: "button", onclick: () => abrirGaveta("voce", naFila.id) }, naFila.tipo === "dar ok" ? "Revisar o rascunho" : "Responder na fila") : null,
        alvoMapa && alvoMapa.tipo === "tarefa" && alvoMapa.id === id ? null
          : h("button", { class: "botao pequeno secundario", type: "button", onclick: () => { fecharGaveta(); abrirGrafo("tarefa", id); } }, "Ver o grafo da tarefa"))];
  }
  // Sessao ou subsessao: o estado e a conversa, lida do fim para tras. A subsessao (subagente) so se le.
  function gavetaSessao(d, tipo, id, silencioso) {
    const [sessao, sub] = tipo === "sub" ? id.split(":") : [id, null];
    let s = ((d.trabalho && d.trabalho.sessoes) || {})[sessao];
    // a sessao que termina a vez sai da lista de ativas: a gaveta fica, para ler a resposta e continuar a conversa
    if (s) sessoesVistas.set(sessao, s);
    else if (sessoesVistas.has(sessao)) s = { ...sessoesVistas.get(sessao), cor: "sem_sinal", estado: "terminou ou parou (saiu da lista de ativas)", viva: false, na_fila: 0 };
    if (!s) return null;
    const k = `${sessao}|${sub || ""}`;
    if (!silencioso || !conversas.has(k)) carregarConversa(sessao, sub);  // abrir a gaveta traz as falas mais novas
    const conversa = h("div", { class: "conversa", "data-chave": k, tabindex: "0", "aria-label": "Conversa da sessão" }, conteudoConversa(sessao, sub));
    const atualizar = h("button", { class: "botao pequeno secundario", type: "button", title: "Lê de novo as falas mais novas", onclick: () => carregarConversa(sessao, sub) }, "Atualizar conversa");
    if (sub) {
      const x = ((s.subsessoes && s.subsessoes.itens) || []).find(i => i.id === sub) || { descricao: sub, estado: "", cor: "sem_sinal", tipo: "" };
      return [h("p", { class: "eyebrow" }, `subsessão${x.tipo ? ` · ${x.tipo}` : ""}`), h("h3", {}, x.descricao || sub), h("p", { class: `estado estado-${x.cor}` }, x.estado),
        h("p", { class: "sessao-meta" }, `da sessão ${s.nome}`),
        h("div", { class: "acoes" }, atualizar, h("button", { class: "botao pequeno secundario", type: "button", onclick: () => abrirGaveta("sessao", sessao) }, "Abrir a sessão")), conversa];
    }
    // O detalhe cabe em duas linhas: a altura que sobra e da conversa.
    const sb = s.subsessoes || { total: 0, ativas: 0 };
    const attach = s.id ? `claude attach ${s.id}` : "";
    return [h("p", { class: "eyebrow" }, `sessão · ${s.tipo}`), h("h3", {}, s.nome), h("p", { class: `estado estado-${s.cor}` }, s.estado),
      h("p", { class: "sessao-meta", title: s.pasta }, [s.frente || s.pasta, s.atualizado ? `atualizada às ${s.atualizado}` : "",
        sb.total ? `${sb.total} ${sb.total === 1 ? "subsessão" : "subsessões"}${sb.ativas ? ` (${sb.ativas} trabalhando)` : ""}` : ""].filter(Boolean).join(" · ")),
      s.pedido ? h("p", { class: "sessao-pedido", title: s.pedido }, h("b", {}, "Pediram: "), s.pedido) : null,
      h("div", { class: "acoes" }, atualizar, botaoOuvir(s.sessao), attach ? h("button", { class: "botao pequeno secundario", type: "button", title: `Copia "${attach}", que abre a sessão num terminal`,
        onclick: () => copiar(attach, "Comando copiado.") }, "Copiar attach") : null, botaoParar(s, V.acoesDaSessao(s))),
      caixaResumo(s.sessao), conversa, painelSessao(s, V.acoesDaSessao(s))];
  }
  // Ouvir (entrega 3): resumo de ate ~40 s, sem codigo, lido pela voz pt-BR do navegador; o texto fica escrito na gaveta.
  // O botao e o quadro mudam no lugar, sem redesenhar a gaveta, para nao tirar o foco de quem esta digitando.
  function botaoOuvir(sessao) {
    const r = resumos.get(sessao) || {};
    return h("button", { class: "botao pequeno secundario", type: "button", "data-ouvir": "", disabled: Boolean(r.carregando),
      title: "Um resumo de até 40 s, sem código, na voz do navegador", onclick: () => ouvir(sessao) },
      falando === sessao ? "Parar de ouvir" : r.carregando ? "Resumindo…" : "Ouvir");
  }
  function caixaResumo(sessao) {
    const r = resumos.get(sessao) || {};
    return h("p", { class: `sessao-resumo${r.erro ? " erro" : ""}`, "data-resumo": "", hidden: !r.texto && !r.erro, title: r.aviso || null, "aria-live": "polite" },
      r.erro || [h("b", {}, r.fonte === "sem-ia" ? "Resumo sem IA: " : "Resumo: "), r.texto]);
  }
  function atualizarOuvir(sessao) {
    if (!gaveta || gaveta.tipo !== "sessao" || gaveta.id !== sessao) return;
    const corpo = $("gavetaCorpo");
    const botao = corpo.querySelector("[data-ouvir]");
    if (botao) botao.replaceWith(botaoOuvir(sessao));
    const quadro = corpo.querySelector("[data-resumo]");
    if (quadro) quadro.replaceWith(caixaResumo(sessao));
  }
  async function ouvir(sessao) {
    if (falando === sessao) return pararDeOuvir();
    pararDeOuvir();
    resumos.set(sessao, { ...(resumos.get(sessao) || {}), carregando: true, erro: "" });
    atualizarOuvir(sessao);
    try {
      const r = await fetch(`/api/sessoes/${encodeURIComponent(sessao)}/resumo`);
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui resumir a sessão.");
      resumos.set(sessao, { texto: corpo.texto, fonte: corpo.fonte, aviso: corpo.aviso || "" });
      if (gaveta && gaveta.tipo === "sessao" && gaveta.id === sessao) falar(sessao, corpo.texto);  // fechou a gaveta: so guarda
    } catch (erro) {
      resumos.set(sessao, { erro: erro.message });
    }
    atualizarOuvir(sessao);
  }
  // Uma fala por frase: a voz do Google no Chrome para no meio de falas longas.
  function falar(sessao, texto) {
    if (!("speechSynthesis" in window)) return toast("Este navegador não fala: o resumo está escrito na gaveta.");
    const frases = V.frasesParaFalar(texto);
    if (!frases.length) return;
    const voz = V.escolherVoz(speechSynthesis.getVoices());
    speechSynthesis.cancel();
    falando = sessao;
    frases.forEach((frase, i) => {
      const fala = new SpeechSynthesisUtterance(frase);
      fala.lang = "pt-BR";
      if (voz) fala.voice = voz;
      if (i === frases.length - 1) fala.onend = fala.onerror = () => { if (falando === sessao) { falando = null; atualizarOuvir(sessao); } };
      speechSynthesis.speak(fala);
    });
  }
  function pararDeOuvir() {
    if (!falando) return;
    const sessao = falando;
    falando = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    atualizarOuvir(sessao);
  }
  // Ditar (entrega 3): o reconhecimento de voz do navegador, em pt-BR, escreve na caixa; ele revisa e clica em Enviar.
  function botaoDitar(sessao, caixa) {
    if (!V.suporteDitado(window)) return h("span", { class: "dica-ditado" }, "Ditado: use o Chrome ou o Edge.");
    const ativo = Boolean(ditado && ditado.sessao === sessao);
    return h("button", { class: `botao pequeno secundario${ativo ? " gravando" : ""}`, type: "button", "data-ditar": "",
      title: "Ditado do navegador, em português: o áudio vai para o serviço de voz dele. Nada é enviado sem você clicar.",
      onclick: () => alternarDitado(sessao, caixa) }, ativo ? "Parar ditado" : "Ditar");
  }
  function alternarDitado(sessao, caixa) {
    const era = ditado && ditado.sessao;
    pararDitado();
    if (era === sessao) return;
    const Reconhecer = V.suporteDitado(window);
    const rec = new Reconhecer();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;
    const base = caixa.value;
    rec.onresult = ev => {
      caixa.value = V.juntarDitado(base, Array.from(ev.results, r => r[0].transcript));
      digitadoSessao.set(sessao, caixa.value);
    };
    rec.onerror = ev => { const aviso = V.erroDoDitado(ev.error); if (aviso) toast(aviso); };
    rec.onend = () => { if (ditado && ditado.rec === rec) { ditado = null; marcarDitado(); } };
    ditado = { sessao, rec };
    try { rec.start(); } catch (erro) { ditado = null; toast(V.erroDoDitado(erro.name || "start")); }
    caixa.focus();
    marcarDitado();
  }
  function pararDitado() {
    if (!ditado) return;
    const { rec } = ditado;
    ditado = null;
    try { rec.stop(); } catch { /* ja tinha parado */ }  // o que ja foi dito ainda chega na caixa
    marcarDitado();
  }
  function marcarDitado() {
    const botao = $("gavetaCorpo").querySelector("[data-ditar]");
    if (!botao) return;
    const ativo = Boolean(ditado && gaveta && gaveta.tipo === "sessao" && ditado.sessao === gaveta.id);
    botao.textContent = ativo ? "Parar ditado" : "Ditar";
    botao.classList.toggle("gravando", ativo);
  }
  // Resposta para a sessao, embaixo da conversa (entrega 2): parada ou esperando, ela retoma na hora; trabalhando, a
  // resposta espera ela terminar o passo. Ctrl+Enter envia. O texto digitado sobrevive a releitura de 30 s.
  function painelSessao(s, a) {
    if (!a.pode) return h("p", { class: "dica-resposta sessao-resposta" }, a.motivo);
    const caixa = h("textarea", { class: "resposta-texto", rows: "2", maxlength: "8000", "aria-label": "Resposta para a sessão",
      placeholder: a.enviar === "Enviar" ? "Sua resposta: a sessão retoma com ela (Ctrl+Enter envia)" : "Sua resposta: vai quando a sessão terminar o passo atual" });
    caixa.value = digitadoSessao.get(s.sessao) || "";
    const enviar = h("button", { class: "botao pequeno", type: "button", onclick: ev => responderSessao(s, caixa, ev.currentTarget) }, a.enviar);
    caixa.addEventListener("input", () => digitadoSessao.set(s.sessao, caixa.value));
    caixa.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar.click(); } });
    return h("div", { class: "resposta-painel sessao-resposta" },
      a.fila ? h("p", { class: "espera-ciclo" }, `${a.fila} ${a.fila === 1 ? "resposta espera" : "respostas esperam"} a sessão parar`) : null,
      caixa, h("div", { class: "acoes" }, enviar, botaoDitar(s.sessao, caixa)));
  }
  function botaoParar(s, a) {
    if (!a.parar) return null;
    return h("button", { class: "botao pequeno perigo", type: "button", title: "claude stop: a conversa fica, e a próxima resposta a retoma", onclick: ev => {
      const b = ev.currentTarget;
      if (b.dataset.confirmar) return pararSessao(s, b);
      b.dataset.confirmar = "1";
      b.textContent = "Confirmar parada";
      setTimeout(() => { if (b.isConnected && !b.disabled) { delete b.dataset.confirmar; b.textContent = "Parar"; } }, 4000);
    } }, "Parar");
  }
  async function responderSessao(s, caixa, botao) {
    pararDitado();
    const texto = caixa.value.trim();
    if (!texto) { caixa.focus(); return toast("Escreva a resposta."); }
    const rotulo = botao.textContent;
    botao.disabled = true;
    botao.textContent = "Enviando…";
    try {
      const r = await fetch(`/api/sessoes/${encodeURIComponent(s.sessao)}/responder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "A sessão não recebeu a resposta.");
      digitadoSessao.delete(s.sessao);
      caixa.value = "";
      toast(corpo.estado === "na-fila" ? "Guardada: vai quando a sessão terminar o passo atual." : "Enviada: a sessão retomou com a sua resposta.");
      setTimeout(() => { if (gaveta && gaveta.tipo === "sessao" && gaveta.id === s.sessao) carregarConversa(s.sessao, null); }, 5000);
      carregar(true);
    } catch (erro) {
      toast(erro.message);
    } finally {
      botao.disabled = false;
      botao.textContent = rotulo;
    }
  }
  async function pararSessao(s, botao) {
    botao.disabled = true;
    botao.textContent = "Parando…";
    try {
      const r = await fetch(`/api/sessoes/${encodeURIComponent(s.sessao)}/parar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui parar a sessão.");
      toast(corpo.estado === "ja-parada" ? "A sessão já estava parada." : "Sessão parada. A conversa fica, e responder a retoma.");
      carregar(true);
    } catch (erro) {
      toast(erro.message);
      botao.disabled = false;
      botao.textContent = "Parar";
    }
  }
  function conteudoConversa(sessao, sub) {
    const c = conversas.get(`${sessao}|${sub || ""}`) || { falas: [], carregando: true };
    const quem = { voce: "Você", claude: "Claude", "sessão": "Pedido da sessão" };
    return [
      c.antes && !c.carregando ? h("button", { class: "botao pequeno secundario anteriores", type: "button", onclick: () => carregarConversa(sessao, sub, true) }, "Carregar anteriores") : null,
      c.carregando ? h("p", { class: "carregando" }, h("span", { class: "giro" }), "Lendo a conversa…") : null,
      c.erro ? h("p", { class: "aviso erro" }, c.erro) : null,
      ...V.agruparFalas(c.falas).map(f => f.quem === "ferramentas"
        ? h("details", { class: "fala ferramentas" }, h("summary", {}, f.texto, f.hora ? ` · ${f.hora}` : ""), h("ul", {}, f.itens.map(x => h("li", {}, x.texto))))
        : f.quem === "ferramenta" ? h("div", { class: "fala ferramenta" }, f.texto)
          : h("div", { class: `fala ${f.quem === "voce" ? "voce" : f.quem === "claude" ? "claude" : "pedido"}` },
            h("span", { class: "quem" }, quem[f.quem] || f.quem, f.hora ? ` · ${f.hora}` : ""), trechos(f.texto))),
      !c.carregando && !c.erro && !c.falas.length ? h("p", { class: "vazio" }, "Nada para mostrar nesta conversa.") : null];
  }
  // Negrito, codigo e link da fala (V.trechosDaFala); o link so e http(s) e abre em outra aba.
  const trechos = texto => V.trechosDaFala(texto).map(t => (t.tipo === "negrito" ? h("b", {}, t.texto) : t.tipo === "codigo" ? h("code", {}, t.texto)
    : t.tipo === "link" ? h("a", { href: t.href, target: "_blank", rel: "noopener noreferrer" }, t.texto) : t.texto));
  // Le a conversa pela rota /api/sessoes (o cli.py sessao ler). "anteriores" pede a pagina antes da mais antiga que
  // ja esta na tela e mantem a leitura no mesmo ponto; sem ela, troca pelas falas mais novas e desce ate o fim.
  async function carregarConversa(sessao, sub, anteriores = false) {
    const k = `${sessao}|${sub || ""}`;
    const atual = conversas.get(k);
    if (atual && atual.carregando) return;
    conversas.set(k, { falas: atual ? atual.falas : [], antes: atual ? atual.antes : null, carregando: true, erro: "" });
    redesenharConversa(k, anteriores);
    try {
      const q = new URLSearchParams();
      if (sub) q.set("sub", sub);
      if (anteriores && atual && atual.antes) q.set("antes", String(atual.antes));
      const r = await fetch(`/api/sessoes/${encodeURIComponent(sessao)}/conversa?${q}`, { cache: "no-store" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui ler a conversa.");
      conversas.set(k, { falas: anteriores && atual ? [...corpo.falas, ...atual.falas] : corpo.falas, antes: corpo.antes, carregando: false, erro: "" });
    } catch (erro) {
      conversas.set(k, { ...conversas.get(k), carregando: false, erro: erro.message });
    }
    redesenharConversa(k, anteriores);
  }
  function redesenharConversa(k, manterPonto) {
    const el = $("gavetaCorpo").querySelector(".conversa");
    if (!el || el.dataset.chave !== k) return;
    const [sessao, sub] = k.split("|");
    const doFim = el.scrollHeight - el.scrollTop;
    el.replaceChildren(...conteudoConversa(sessao, sub || null).filter(Boolean));
    el.scrollTop = manterPonto ? el.scrollHeight - doFim : el.scrollHeight;
  }
  function fecharGaveta() {
    pararDitado();
    pararDeOuvir();
    gaveta = null;
    $("gaveta").classList.remove("aberta");
    $("gaveta").setAttribute("aria-hidden", "true");
    $("veu").hidden = true;
  }

  // ------------------------------------------------------------------ eventos
  NavRail.montar($("rail"), { ativo: "cockpit" });
  if ("speechSynthesis" in window) speechSynthesis.getVoices();  // o Chrome so carrega a lista de vozes depois da primeira chamada
  document.querySelectorAll(".abas button").forEach(b => b.addEventListener("click", () => { ui.aba = b.dataset.aba; salvarPreferencias(); renderizar(); }));
  document.querySelectorAll(".colunas-abas button").forEach(b => b.addEventListener("click", () => { ui.coluna = b.dataset.coluna; salvarPreferencias(); renderizar(); }));
  $("busca").addEventListener("input", debounce(e => { ui.busca = e.target.value; renderizar(); }, 120));
  $("atualizar").addEventListener("click", () => carregar(true));
  $("rodarAgora").addEventListener("click", rodarAgora);
  $("fecharGaveta").addEventListener("click", fecharGaveta);
  $("veu").addEventListener("click", fecharGaveta);
  $("voltarMapa").addEventListener("click", voltarAoMapa);
  // a largura do desenho segue a do quadro: redesenha quando a janela muda ou quando a aba Mapa aparece (escondida, mede 0)
  new ResizeObserver(() => { if (resposta && ui.aba === "mapa") renderMapa(resposta.dados); }).observe($("mapa"));
  document.addEventListener("keydown", e => {
    const digitando = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !digitando) { e.preventDefault(); $("busca").focus(); }
    else if (e.key === "Escape") {
      if (gaveta) fecharGaveta();
      else if (digitando) { $("busca").value = ""; ui.busca = ""; $("busca").blur(); renderizar(); }
      else if (alvoMapa && ui.aba === "mapa") voltarAoMapa();
    } else if ((e.key === "r" || e.key === "R") && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) carregar(true);
  });
  setInterval(marcarVivo, 1000);

  document.querySelectorAll(".abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === ui.aba)));
  for (const aba of ["painel", "mapa", "hoje"]) $("aba-" + aba).hidden = ui.aba !== aba;
  mostrarCarregando();
  carregarAgenda().then(renderizar);
  carregar(false);
})();
