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

  const ui = lerPreferencias();
  let resposta = null;
  let recebidoEm = 0;
  let destaques = new Set();
  let naAgenda = new Set();
  let timer = null;
  let toastTimer = null;
  let carregandoAgora = false;
  let gaveta = null;
  const conversas = new Map();  // "sessao|subagente" → { falas, antes, carregando, erro }
  const sessoesVistas = new Map();  // ultima leitura de cada sessao aberta na gaveta
  const digitadoSessao = new Map();  // resposta que ele esta escrevendo, por sessao
  const resumos = new Map();  // sessao → { texto, fonte, aviso, carregando, erro } do Ouvir
  let falando = null;  // sessao cujo resumo a voz esta lendo
  let ditado = null;  // { sessao, rec } enquanto o microfone ouve
  const $ = id => document.getElementById(id);

  function lerPreferencias() {
    const padrao = { aba: "painel", cor: null, segmento: null, tipoFila: null, frente: null, coluna: "agentes", rotinas: "fechada",
      mapa: { projeto: null, tarefa: null, sessao: null } };  // o que esta aberto na arvore do Mapa (02/11)
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
  const bolinha = cor => h("span", { class: `bolinha ${cor}`, title: ROTULO[cor] });
  const curto = (t, n) => { t = String(t || ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const doisDigitos = n => String(n).padStart(2, "0");
  const hojeChave = () => { const d = new Date(); return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`; };
  const agoraLocal = () => { const d = new Date(); return `${hojeChave()}T${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:00`; };
  const horaDe = iso => (iso ? String(iso).replace("T", " ").slice(0, 16) : "");
  const linha = (rotulo, valor) => (valor ? h("div", {}, h("dt", {}, rotulo), h("dd", {}, valor)) : null);
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
      const filtrado = V.semExcluidas(corpo.dados, excluidas);  // a leitura pode ser de antes da exclusao
      corpo.dados = filtrado.dados;
      excluidas = filtrado.pendentes;
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
  // Excluir tarefa (29/10): a nota fica no vault com status descartada e o card sai da fila e do Mapa na hora.
  // O primeiro clique so pede confirmacao, como no Descartar e no Parar.
  let excluidas = new Set();  // tarefas excluidas que a leitura do Copiloto ainda nao mostra fechadas
  function botaoComConfirmacao(classe, rotulo, title, acao) {
    return h("button", { class: `${classe} perigo`, type: "button", "data-rotulo": rotulo, title, onclick: ev => {
      ev.stopPropagation();
      const b = ev.currentTarget;
      if (b.dataset.confirmar) return acao(b);
      b.dataset.confirmar = "1";
      b.textContent = "Confirmar";
      setTimeout(() => { if (b.isConnected && !b.disabled) { delete b.dataset.confirmar; b.textContent = rotulo; } }, 4000);
    } }, rotulo);
  }
  const botaoExcluir = (id, classe, rotulo) => botaoComConfirmacao(classe, rotulo,
    "Fecha a tarefa como descartada. A nota fica no vault, com uma linha no registro.", b => excluirTarefa(id, b));
  function sessoesVivasDaTarefa(id) {
    const t = (resposta && resposta.dados && resposta.dados.trabalho) || {};
    const tarefa = (t.projetos || []).flatMap(p => p.tarefas).find(x => x.id === id);
    return ((tarefa && tarefa.sessoes) || []).map(sid => (t.sessoes || {})[sid]).filter(s => s && s.viva).map(s => s.nome);
  }
  async function excluirTarefa(id, botao) {
    const vivas = sessoesVivasDaTarefa(id);
    botao.disabled = true;
    botao.textContent = "Excluindo…";
    try {
      const r = await fetch("/api/copiloto/excluir-tarefa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tarefa: id }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "Não consegui excluir a tarefa.");
      excluidas.add(id);
      historias.delete(id);  // a historia aberta passa a mostrar a tarefa fechada
      resposta.dados = V.semExcluidas(resposta.dados, excluidas).dados;
      if (gaveta && (gaveta.tipo === "voce" || gaveta.tipo === "tarefa") && gaveta.id === id) fecharGaveta();
      toast(V.avisoDaExclusao(vivas));
      renderizar();
      carregar(true);
    } catch (erro) {
      botao.disabled = false;
      delete botao.dataset.confirmar;
      botao.textContent = botao.dataset.rotulo;
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
  async function abrirMestra() {
    const botao = $("abrirMestra");
    botao.disabled = true;
    botao.textContent = "Abrindo…";
    try {
      const r = await fetch("/api/copiloto/mestra", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok || corpo.ok === false) throw new Error(corpo.error || corpo.erro || "Não consegui abrir a Mestra.");
      toast(corpo.janela ? (corpo.acao === "nova" ? "A Mestra nasceu: a janela abre em instantes." : "Janela da Mestra aberta.")
        : `A Mestra está no claude agents: claude attach ${corpo.curto || "Mestra"}`);
    } catch (erro) {
      toast(erro.message);
    } finally {
      botao.disabled = false;
      botao.textContent = "Mestra";
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
      descartar, acoes.includes("excluir") ? botaoExcluir(i.id, "botao pequeno", "Excluir tarefa") : null));
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
    document.body.dataset.rotinas = ui.rotinas;  // em tela larga, Rotinas recolhida vira uma faixa com o selo
    const selo = V.resumoRotinas(d.rotinas);
    $("rotinas-selo").textContent = selo.texto;
    $("rotinas-selo").className = `selo ${selo.cor}`;
    $("abrirRotinas").setAttribute("aria-expanded", String(ui.rotinas === "aberta"));
    document.querySelectorAll(".colunas-abas button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.coluna === ui.coluna)));
    $("alertas").replaceChildren();
    renderKpis(d);
    if (ui.aba === "painel") {
      renderAgentes(f.agentes);
      renderFila(f.voce, d);
      renderRotinas(V.filtrar(d, { busca: ui.busca, cor: ui.cor, segmento: ui.segmento }).rotinas, f.rotinas);
    } else if (ui.aba === "mapa") renderMapa(d);
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
    const possiveis = V.acoesDoItem(i);
    const acoes = [
      espera ? h("span", { class: "espera-ciclo", title: "O Copiloto trata no próximo ciclo; Rodar agora, no topo, adianta" }, espera)
        : possiveis.length ? h("button", { class: "mini principal", type: "button",
          title: i.tipo === "dar ok" ? "Ler a mensagem inteira e aprovar, pedir ajuste ou descartar" : "Responder ao Copiloto",
          onclick: e => { e.stopPropagation(); abrir(); } }, i.tipo === "dar ok" ? "Revisar" : "Responder") : null,
      h("button", { class: `mini${levado ? " feito" : ""}`, type: "button", disabled: levado, title: "Cria uma tarefa de 30 min, com prazo hoje, na sua agenda",
        onclick: e => { e.stopPropagation(); levarParaAgenda(i, e.currentTarget); } }, levado ? "✓ agenda" : "+ agenda"),
      // apagar sem abrir: a tarefa sai descartada no vault; o rascunho e descartado pelo Copiloto no proximo ciclo
      possiveis.includes("excluir") ? botaoExcluir(i.id, "mini", "Excluir")
        : possiveis.includes("descartar") ? botaoComConfirmacao("mini", "Descartar", "Descarta o rascunho sem enviar; o Copiloto trata no próximo ciclo",
          b => { delete b.dataset.confirmar; b.textContent = "Descartar"; responder(i, "descartar", "", b); }) : null];
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

  // Mapa em arvore (docs/specs/mapa-arvore.md): de cima para baixo, projeto → tarefas → historia (pedido → passos →
  // agora ⇢ meta) e sessoes → subsessoes. O clique abre o ramo embaixo da linha; fica aberto um projeto, uma tarefa e
  // uma sessao por vez (ui.mapa). Abrir e fechar so trocam a classe, e o ramo cresce e encolhe com movimento; a
  // releitura de 30 s redesenha tudo ja no estado de agora, sem movimento, e guarda a rolagem e o foco.
  const clicavel = (el, acao) => {
    el.addEventListener("click", acao);
    el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === e.currentTarget) acao(); });
    return el;
  };
  const dataCurta = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || "")) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : String(iso || ""));
  const historias = new Map();  // tarefa → { dados, carregando, erro, em }
  const passosVistos = new Map();  // tarefa → quantos passos aparecem; "+N anteriores" abre mais acima
  const PASSOS_INICIAIS = 3, PASSOS_A_MAIS = 6, PONTOS = 16;  // 3 passos: pedido, passos, agora e meta cabem em 1536x730
  let trazerQuandoChegar = null;  // a tarefa que abriu antes de a historia chegar: vem para a vista quando ela chega
  let abertosPelaBusca = new Set();  // projetos que a busca abriu, menos os que ele fechou durante a mesma busca
  const fechadosNaBusca = { busca: "", nomes: new Set() };
  const mapaAberto = () => ({ projeto: null, tarefa: null, sessao: null, ...(ui.mapa || {}) });
  const tarefaDoMapa = (d, id) => ((d && d.trabalho && d.trabalho.projetos) || []).flatMap(p => p.tarefas || []).find(x => x.id === id) || null;
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function renderMapa(d) {
    const caixa = $("arvore");
    const rolagem = caixa.scrollTop;
    const focado = document.activeElement && caixa.contains(document.activeElement) && document.activeElement.closest("[data-chave]");
    const foco = focado ? focado.dataset.chave : null;
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "clique na linha para abrir embaixo; no passo, para ler inteiro"), h("span", {}, "↑ ↓ andam · → abre · ← fecha · Esc fecha"));
    if (!d.trabalho) {
      caixa.replaceChildren(h("p", { class: "vazio" }, "O Copiloto instalado ainda não manda o mapa de trabalho. Mescle o PR dele e rode git pull em C:\\Dev\\Dev Seazone\\copiloto."));
      return;
    }
    const arvore = V.arvoreDoMapa(d.trabalho, { busca: ui.busca, cor: ui.cor });
    if (fechadosNaBusca.busca !== ui.busca) { fechadosNaBusca.busca = ui.busca; fechadosNaBusca.nomes.clear(); }
    abertosPelaBusca = new Set(arvore.projetos.filter(p => p.pelaBusca && !fechadosNaBusca.nomes.has(p.nome)).map(p => p.nome));
    if (!arvore.projetos.length) {
      caixa.replaceChildren(h("p", { class: "vazio" }, ui.busca || ui.cor ? "Nada no Mapa bate com a busca ou com a cor escolhida." : "Nenhuma tarefa aberta nem sessão ativa."));
      return;
    }
    const a = mapaAberto();
    caixa.replaceChildren(...arvore.projetos.map(p => noProjeto(p, a, d)));
    caixa.scrollTop = rolagem;
    const voltar = foco && caixa.querySelector(`[data-chave="${CSS.escape(foco)}"] > .linha-arvore`);
    if (voltar && !voltar.closest(".ramo[inert]")) voltar.focus({ preventScroll: true });
  }

  // Um no da arvore: a linha (clicavel, com a seta quando tem ramo) e o ramo embaixo dela, que abre com movimento.
  function noArvore({ chave, nivel, aberto, rotulo, linha, acao, ramo }) {
    const temRamo = Array.isArray(ramo) && ramo.length > 0;
    const l = h("div", { class: "linha-arvore", tabindex: "0", role: "button", "aria-label": rotulo,
      "aria-expanded": temRamo ? String(aberto) : null }, h("span", { class: "seta-arvore", "aria-hidden": "true" }, temRamo ? "▸" : ""), ...linha);
    if (acao) clicavel(l, acao);
    const no = h("div", { class: `no-arvore n${nivel}${temRamo && aberto ? " aberto" : ""}`, "data-chave": chave }, l);
    if (temRamo) no.append(h("div", { class: "ramo", inert: !aberto }, h("div", { class: "dentro" }, ...ramo)));
    return no;
  }

  function noProjeto(p, a, d) {
    const aberto = a.projeto === p.nome || abertosPelaBusca.has(p.nome);
    const conta = p.semTarefa ? plural(p.sessoes, "sessão", "sessões") : plural(p.tarefas.length, "tarefa aberta", "tarefas abertas");
    const meta = [conta, p.precisa ? `${p.precisa} ${p.precisa === 1 ? "precisa" : "precisam"} de você` : "", p.vivas ? `${p.vivas} na memória` : ""];
    return noArvore({ chave: `projeto:${p.nome}`, nivel: 1, aberto, rotulo: `${p.nome}: ${meta.filter(Boolean).join(", ")}`,
      linha: [bolinha(p.cor), h("b", { class: "nome-arvore" }, p.nome), h("span", { class: "meta-arvore" }, meta.filter(Boolean).join(" · ")),
        h("span", { class: "pontos", "aria-hidden": "true" }, ...p.tarefas.slice(0, PONTOS).map(t => h("i", { class: `ponto ${t.cor}` })),
          p.tarefas.length > PONTOS ? h("small", {}, `+${p.tarefas.length - PONTOS}`) : null)],
      acao: () => alternar({ tipo: "projeto", id: p.nome }), ramo: p.tarefas.map(t => noTarefa(t, p, a, d)) });
  }

  function noTarefa(t, p, a, d) {
    const aberto = a.tarefa === t.id;
    if (t.pasta) {
      return noArvore({ chave: `tarefa:${t.id}`, nivel: 2, aberto, rotulo: `Sem tarefa · ${t.titulo}`,
        linha: [bolinha(t.cor), h("span", { class: "titulo-arvore" }, `Sem tarefa · ${t.titulo}`), h("span", { class: "meta-arvore" }, plural(t.sessoes.length, "sessão", "sessões"))],
        acao: () => alternar({ tipo: "tarefa", id: t.id, projeto: p.nome }), ramo: t.sessoes.map(x => noSessao(x, a)) });
    }
    const meta = [t.estado, t.passos ? plural(t.passos, "passo", "passos") : ""].filter(Boolean).join(" · ");
    const ramo = [h("div", { class: "historia-arvore", "data-historia": t.id }, ...(aberto ? conteudoHistoria(t.id, d) : [])),
      ...(t.sessoes.length ? [h("p", { class: "sub-arvore" }, "Sessões da tarefa"), ...t.sessoes.map(x => noSessao(x, a))] : [])];
    return noArvore({ chave: `tarefa:${t.id}`, nivel: 2, aberto, rotulo: [`${t.id} · ${t.titulo}`, t.selo, meta].filter(Boolean).join(" · "),
      linha: [bolinha(t.cor), h("code", { class: "id-arvore" }, t.id), h("span", { class: "titulo-arvore" }, t.titulo),
        t.selo ? h("span", { class: `selo-arvore ${t.cor}` }, t.selo) : null,
        meta ? h("span", { class: "meta-arvore" }, meta) : null, t.vivas ? h("span", { class: "chip" }, `${t.vivas} na memória`) : null],
      acao: () => alternar({ tipo: "tarefa", id: t.id, projeto: p.nome }), ramo });
  }

  // A sessao: a seta abre as subsessoes (ate 8; o resto abre a sessao), e o nome abre a conversa na gaveta.
  function noSessao(x, a) {
    const sub = x.subsessoes || { total: 0, itens: [] };
    const itens = (sub.itens || []).slice(0, 8);
    const ramo = sub.total ? [
      ...itens.map(y => noArvore({ chave: `sub:${x.sessao}:${y.id}`, nivel: 4, aberto: false, rotulo: `${y.descricao || y.tipo || y.id}: ${y.estado || ""}`,
        linha: [bolinha(y.cor), h("span", { class: "titulo-arvore fino" }, y.descricao || y.tipo || y.id), h("span", { class: "meta-arvore" }, y.estado || "")],
        acao: () => abrirGaveta("sub", `${x.sessao}:${y.id}`) })),
      sub.total > itens.length ? h("button", { class: "mais-arvore", type: "button", onclick: () => abrirGaveta("sessao", x.sessao) }, `+${sub.total - itens.length} subsessões: abrir a sessão`) : null,
    ].filter(Boolean) : null;
    return noArvore({ chave: `sessao:${x.sessao}`, nivel: 3, aberto: a.sessao === x.sessao, rotulo: `${x.nome}: ${x.estado}`,
      linha: [bolinha(x.cor), h("button", { class: "link-arvore", type: "button", title: "Abrir a conversa",
        onclick: e => { e.stopPropagation(); abrirGaveta("sessao", x.sessao); } }, x.nome),
      h("span", { class: "meta-arvore" }, [x.estado, sub.total ? plural(sub.total, "subsessão", "subsessões") : ""].filter(Boolean).join(" · "))],
      acao: ramo ? () => alternar({ tipo: "sessao", id: x.sessao }) : () => abrirGaveta("sessao", x.sessao), ramo });
  }

  function alternar(alvo) {
    // o projeto que a busca abriu fecha sem mexer no que ele tinha aberto, e fica fechado ate a busca mudar
    if (alvo.tipo === "projeto" && abertosPelaBusca.delete(alvo.id)) {
      fechadosNaBusca.nomes.add(alvo.id);
      if (mapaAberto().projeto !== alvo.id) return aplicarMapa();
    }
    ui.mapa = V.alternarNoMapa(mapaAberto(), alvo);
    salvarPreferencias();
    aplicarMapa();
  }
  // Acerta as classes com o ui.mapa, sem redesenhar: o ramo que abre cresce e o que fecha encolhe. A tarefa que abriu
  // ganha a historia (lida da nota no primeiro clique) e o que abriu vem para a vista.
  function aplicarMapa() {
    const a = mapaAberto();
    let abriu = null;
    for (const no of $("arvore").querySelectorAll(".no-arvore[data-chave]")) {
      const ramo = no.querySelector(":scope > .ramo");
      if (!ramo) continue;
      const [tipo, ...resto] = no.dataset.chave.split(":");
      const id = resto.join(":");
      const deve = tipo === "projeto" ? a.projeto === id || abertosPelaBusca.has(id) : tipo === "tarefa" ? a.tarefa === id : tipo === "sessao" ? a.sessao === id : false;
      if (deve === no.classList.contains("aberto")) continue;
      const linhaDoNo = no.querySelector(":scope > .linha-arvore");
      if (!deve && ramo.contains(document.activeElement)) linhaDoNo.focus({ preventScroll: true });  // o foco nao some com o ramo
      no.classList.toggle("aberto", deve);
      linhaDoNo.setAttribute("aria-expanded", String(deve));
      ramo.inert = !deve;
      if (deve) {
        abriu = no;
        if (tipo === "tarefa") {
          trazerQuandoChegar = historias.get(id) && historias.get(id).dados ? null : id;
          preencherHistoria(id);
        }
      }
    }
    if (abriu) setTimeout(() => trazerParaAVista(abriu), 280);
  }
  function trazerParaAVista(no) {
    const caixa = $("arvore"), r = no.getBoundingClientRect(), c = caixa.getBoundingClientRect();
    if (r.bottom > c.bottom - 8) caixa.scrollBy({ top: Math.min(r.bottom - c.bottom + 8, r.top - c.top - 8), behavior: "smooth" });
    else if (r.top < c.top) caixa.scrollBy({ top: r.top - c.top - 8, behavior: "smooth" });
  }
  // ↑ ↓ andam entre as linhas que aparecem; → abre (ou desce para o primeiro filho); ← fecha (ou sobe para o pai);
  // espaco abre e fecha. O Enter vem do clicavel.
  function teclaNaArvore(e) {
    const l = e.target;
    if (!l.classList || !l.classList.contains("linha-arvore")) return;
    const visiveis = [...$("arvore").querySelectorAll(".linha-arvore")].filter(x => !x.closest(".ramo[inert]"));
    const i = visiveis.indexOf(l), no = l.parentElement, temRamo = Boolean(no.querySelector(":scope > .ramo")), aberto = no.classList.contains("aberto");
    const ir = x => { if (x) { e.preventDefault(); x.focus(); } };
    if (e.key === "ArrowDown") ir(visiveis[i + 1]);
    else if (e.key === "ArrowUp") ir(visiveis[i - 1]);
    else if (e.key === "ArrowRight" && temRamo) { if (aberto) ir(visiveis[i + 1]); else { e.preventDefault(); l.click(); } }
    else if (e.key === "ArrowLeft") {
      if (temRamo && aberto) { e.preventDefault(); l.click(); }
      else { const pai = no.parentElement.closest(".no-arvore"); ir(pai && pai.querySelector(":scope > .linha-arvore")); }
    } else if (e.key === " ") { e.preventDefault(); l.click(); }
  }
  // "Ver a historia da tarefa" (gaveta): abre o Mapa com o projeto e a tarefa abertos
  function verHistoria(id) {
    const caminho = resposta && V.abrirNoMapa(resposta.dados.trabalho, id);
    if (!caminho) return;
    ui.aba = "mapa";
    ui.mapa = caminho;
    trazerQuandoChegar = historias.get(id) && historias.get(id).dados ? null : id;
    salvarPreferencias();
    renderizar();
    const no = $("arvore").querySelector(`[data-chave="${CSS.escape(`tarefa:${id}`)}"]`);
    if (no) setTimeout(() => trazerParaAVista(no), 60);
  }

  // Historia da tarefa (docs/specs/mapa-historia.md), agora em linha do tempo de cima para baixo dentro do ramo: pedido →
  // os ultimos passos ("+N anteriores" abre mais acima) → agora ⇢ meta. A nota e lida no clique (cli.py tarefa historia)
  // e de novo a cada 30 s enquanto a tarefa esta aberta.
  async function carregarHistoria(id) {
    const atual = historias.get(id) || {};
    if (atual.carregando) return;
    historias.set(id, { ...atual, carregando: true, erro: "" });
    try {
      const r = await fetch(`/api/tarefas/${encodeURIComponent(id)}/historia`, { cache: "no-store" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || `O servidor respondeu ${r.status}.`);
      historias.set(id, { dados: corpo, carregando: false, erro: "", em: Date.now() });
    } catch (erro) {
      historias.set(id, { ...(historias.get(id) || {}), carregando: false, erro: V.mensagemDeFalha(erro), em: Date.now() });
    }
    if (resposta && ui.aba === "mapa" && mapaAberto().tarefa === id) {
      preencherHistoria(id);
      if (trazerQuandoChegar === id) {  // chegou depois do movimento de abrir: so agora da para trazer a historia inteira
        trazerQuandoChegar = null;
        const no = $("arvore").querySelector(`[data-chave="${CSS.escape(`tarefa:${id}`)}"]`);
        if (no) setTimeout(() => trazerParaAVista(no), 300);
      }
    }
    if (gaveta && gaveta.tipo === "historia" && gaveta.id.startsWith(`${id}|`)) abrirGaveta("historia", gaveta.id, true);
  }
  function preencherHistoria(id) {
    const alvo = $("arvore").querySelector(`[data-historia="${CSS.escape(id)}"]`);
    if (alvo && resposta) alvo.replaceChildren(...conteudoHistoria(id, resposta.dados));
  }
  function conteudoHistoria(id, d) {
    const estado = historias.get(id);
    if (!estado || (!estado.carregando && Date.now() - (estado.em || 0) > 30000)) carregarHistoria(id);
    const H = estado && estado.dados;
    if (!H) {
      return [estado && estado.erro && !estado.carregando
        ? h("p", { class: "falha-arvore" }, `Não consegui ler a história da tarefa: ${estado.erro} `,
          h("button", { class: "mini", type: "button", onclick: () => carregarHistoria(id) }, "Tentar de novo"))
        : h("p", { class: "carregando-arvore" }, "Lendo a nota da tarefa…")];
    }
    const t = tarefaDoMapa(d, id);
    const sessoesDaTarefa = ((t && t.sessoes) || []).map(sid => ((d.trabalho && d.trabalho.sessoes) || {})[sid]).filter(Boolean);
    const { porPasso, noAgora } = V.sessoesNosPassos(H.passos, sessoesDaTarefa);
    const fila = (d.voce && d.voce.itens) || [];
    const naFila = fila.find(i => i.id === id);
    const pendentes = new Set(fila.map(i => i.id));
    const agora = V.agoraDaHistoria(H.agora);
    const f = V.fatiaDaHistoria(H.passos.length, null, passosVistos.get(id) || PASSOS_INICIAIS);
    const abrirParte = parte => () => abrirGaveta("historia", `${id}|${parte}`);
    const pilulaSessao = x => h("button", { class: "pilula", type: "button", title: `${x.nome}: ${x.estado}. Clique para a conversa.`,
      onclick: e => { e.stopPropagation(); abrirGaveta("sessao", x.sessao); } }, bolinha(x.cor), curto(x.nome, 24));
    const marco = (classe, acao, ...filhos) => clicavel(h("li", { class: `marco ${classe}`, tabindex: "0", role: "button" }, ...filhos), acao);
    const topo = (texto, quem) => h("p", { class: "marco-topo" }, texto, quem ? h("span", { class: "marco-quem" }, quem) : null);
    const texto = (valor, limite, vazio) => h("p", { class: "marco-texto" }, V.resumoDoPasso(valor, limite) || vazio);
    const p = H.pedido || {};
    const quem = [p.por, p.origem].filter(Boolean).join(" · ");
    const itens = [marco("pedido", abrirParte("pedido"), topo(`Pedido${p.criada ? ` · ${dataCurta(p.criada)}` : ""}`, quem),
      texto(p.por_que, 240, "A nota não diz por quê."))];
    if (f.antes) {
      itens.push(h("li", { class: "marco mais" }, h("button", { class: "mais-arvore", type: "button", title: "Abrir os passos de antes",
        onclick: () => { passosVistos.set(id, (passosVistos.get(id) || PASSOS_INICIAIS) + PASSOS_A_MAIS); preencherHistoria(id); } },
      `+${plural(f.antes, "passo anterior", "passos anteriores")}`)));
    }
    for (let i = f.de; i < f.ate; i++) {
      const passo = H.passos[i], delas = porPasso[i] || [];
      itens.push(marco("passo", abrirParte(`passo:${i}`), topo(`Passo ${i + 1} · ${passo.quando}`), texto(passo.texto, 260, "(vazio)"),
        delas.length ? h("div", { class: "pilulas" }, delas.map(pilulaSessao)) : null));
    }
    const pilulas = [...(H.rascunhos || []).map(r => h("button", { class: "pilula rascunho", type: "button", disabled: !pendentes.has(r.id), title: r.texto,
      onclick: e => { e.stopPropagation(); abrirGaveta("voce", r.id); } }, `${r.id} · revisar`)), ...noAgora.map(pilulaSessao)];
    itens.push(marco(`agora ${agora.cor}`, () => abrirGaveta("tarefa", id),
      h("div", { class: "marco-cabeca" }, topo(`Agora · ${agora.rotulo}`),
        naFila ? h("button", { class: "mini principal", type: "button", onclick: e => { e.stopPropagation(); abrirGaveta("voce", id); } }, "Responder") : null,
        t && t.aberta ? botaoExcluir(id, "mini", "Excluir") : null),
      texto(H.agora && H.agora.texto, 360, "Nada registrado ainda."), pilulas.length ? h("div", { class: "pilulas" }, pilulas) : null));
    itens.push(marco("meta", abrirParte("meta"), topo("Meta · pronto quando"), texto(H.meta, 260, "A nota não diz quando fica pronta.")));
    return [h("ol", { class: "linha-do-tempo" }, ...itens)];
  }
  // Uma parte da historia na gaveta: o pedido com o porque inteiro, a meta ou um passo, com o texto inteiro e os
  // botoes para o passo anterior e o seguinte.
  function gavetaHistoria(chave) {
    const [id, parte = ""] = String(chave).split("|");
    const H = (historias.get(id) || {}).dados;
    if (!H) return null;
    const inteiro = valor => h("div", { class: "texto-passo", tabindex: "0" }, trechos(valor));
    if (parte === "pedido") {
      const p = H.pedido || {};
      const link = /^https?:\/\//.test(p.link || "") ? h("a", { href: p.link, target: "_blank", rel: "noopener noreferrer" }, p.origem || "abrir a origem") : p.origem;
      return [h("p", { class: "eyebrow" }, `pedido · ${id}`), h("h3", {}, H.titulo),
        h("dl", { class: "detalhes" }, linha("Quem pediu", p.por), linha("Onde", link), linha("Criada", dataCurta(p.criada)), linha("Prazo", dataCurta(H.prazo))),
        p.por_que ? inteiro(p.por_que) : h("p", { class: "vazio" }, "A nota não diz por quê.")];
    }
    if (parte === "meta") return [h("p", { class: "eyebrow" }, `meta · ${id}`), h("h3", {}, "Pronto quando"), H.meta ? inteiro(H.meta) : h("p", { class: "vazio" }, "A nota não diz quando fica pronta.")];
    const i = Number((/^passo:(\d+)$/.exec(parte) || [])[1]);
    const p = Number.isInteger(i) ? H.passos[i] : null;
    if (!p) return null;
    const ir = j => () => abrirGaveta("historia", `${id}|passo:${j}`);
    return [h("p", { class: "eyebrow" }, `passo ${i + 1} de ${H.passos.length} · ${p.quando}`), h("h3", {}, H.titulo), inteiro(p.texto),
      h("div", { class: "acoes" },
        h("button", { class: "botao pequeno secundario", type: "button", disabled: i === 0, onclick: ir(i - 1) }, "← Passo anterior"),
        h("button", { class: "botao pequeno secundario", type: "button", disabled: i >= H.passos.length - 1, onclick: ir(i + 1) }, "Passo seguinte →"))];
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
      // a tarefa do item (ele mesmo ou a do rascunho), para ver a historia dela no Mapa
      const daTarefa = [i.id, i.tarefa].find(x => /^T-/.test(String(x || "")));
      corpo = [h("p", { class: "eyebrow" }, `${NOME_TIPO[i.tipo] || i.tipo} · ${i.id}`), h("h3", {}, i.titulo),
        espera ? h("p", { class: "estado estado-atencao" }, espera) : null,
        i.mensagem ? h("div", { class: "mensagem-completa", tabindex: "0", "aria-label": "Mensagem que vai sair em seu nome" }, i.mensagem) : null,
        h("dl", { class: "detalhes" }, i.mensagem ? null : linha("O que é", i.texto), linha("Esperando", idadeDoItem(i)),
          linha("Tarefa", i.tarefa && i.tarefa !== i.id ? i.tarefa : ""), linha("Pela DM", i.comando ? h("code", {}, i.comando) : ""),
          linha("Nota", V.linkObsidian(i) ? h("a", { href: V.linkObsidian(i) }, "Abrir a nota no Obsidian") : "")),
        acoes.length ? painelResposta(i, acoes) : null,
        h("div", { class: "acoes" },
          h("button", { class: `botao pequeno secundario${levado ? " feito" : ""}`, type: "button", disabled: levado, title: "Cria uma tarefa de 30 min, com prazo hoje, na sua agenda",
            onclick: ev => levarParaAgenda(i, ev.currentTarget) }, levado ? "✓ Na agenda" : "Levar para a agenda"),
          daTarefa ? h("button", { class: "botao pequeno secundario", type: "button", title: "Pedido, o que foi feito e onde a tarefa está, no Mapa",
            onclick: () => { fecharGaveta(); verHistoria(daTarefa); } }, "Ver a história da tarefa") : null)];
    }
    else if (tipo === "tarefa") corpo = gavetaTarefa(d, id);
    else if (tipo === "historia") corpo = gavetaHistoria(id);
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
        !/^T-/.test(t.id) || (ui.aba === "mapa" && mapaAberto().tarefa === id) ? null
          : h("button", { class: "botao pequeno secundario", type: "button", onclick: () => { fecharGaveta(); verHistoria(id); } }, "Ver a história da tarefa"),
        t.aberta && /^T-/.test(t.id) ? botaoExcluir(t.id, "botao pequeno", "Excluir tarefa") : null)];
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
  document.querySelectorAll(".abas button").forEach(b => b.addEventListener("click", () => {
    ui.aba = b.dataset.aba; salvarPreferencias(); renderizar();
  }));
  document.querySelectorAll(".colunas-abas button").forEach(b => b.addEventListener("click", () => { ui.coluna = b.dataset.coluna; salvarPreferencias(); renderizar(); }));
  $("abrirRotinas").addEventListener("click", () => { ui.rotinas = "aberta"; salvarPreferencias(); renderizar(); });
  $("recolherRotinas").addEventListener("click", () => { ui.rotinas = "fechada"; salvarPreferencias(); renderizar(); });
  $("busca").addEventListener("input", debounce(e => { ui.busca = e.target.value; renderizar(); }, 120));
  $("atualizar").addEventListener("click", () => carregar(true));
  $("rodarAgora").addEventListener("click", rodarAgora);
  $("abrirMestra").addEventListener("click", abrirMestra);
  $("fecharGaveta").addEventListener("click", fecharGaveta);
  $("veu").addEventListener("click", fecharGaveta);
  $("arvore").addEventListener("keydown", teclaNaArvore);
  document.addEventListener("keydown", e => {
    const digitando = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !digitando) { e.preventDefault(); $("busca").focus(); }
    else if (e.key === "Escape") {
      if (gaveta) fecharGaveta();
      else if (digitando) { $("busca").value = ""; ui.busca = ""; $("busca").blur(); renderizar(); }
      else if (ui.aba === "mapa" && V.fecharNoMapa(ui.mapa)) { ui.mapa = V.fecharNoMapa(ui.mapa); salvarPreferencias(); aplicarMapa(); }
    } else if ((e.key === "r" || e.key === "R") && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) carregar(true);
  });
  setInterval(marcarVivo, 1000);

  document.querySelectorAll(".abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === ui.aba)));
  for (const aba of ["painel", "mapa", "hoje"]) $("aba-" + aba).hidden = ui.aba !== aba;
  mostrarCarregando();
  carregarAgenda().then(renderizar);
  carregar(false);
})();
