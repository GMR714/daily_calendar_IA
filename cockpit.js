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
  let alvoMapa = null;  // o que o Mapa mostra no lugar das bolas: { tipo: "historia" | "projeto" | "tarefa", id }
  const conversas = new Map();  // "sessao|subagente" → { falas, antes, carregando, erro }
  const sessoesVistas = new Map();  // ultima leitura de cada sessao aberta na gaveta
  const digitadoSessao = new Map();  // resposta que ele esta escrevendo, por sessao
  const resumos = new Map();  // sessao → { texto, fonte, aviso, carregando, erro } do Ouvir
  let falando = null;  // sessao cujo resumo a voz esta lendo
  let ditado = null;  // { sessao, rec } enquanto o microfone ouve
  const $ = id => document.getElementById(id);

  function lerPreferencias() {
    const padrao = { aba: "painel", cor: null, segmento: null, tipoFila: null, frente: null, coluna: "agentes", rotinas: "fechada" };
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

  // Mapa de bolas (docs/specs/mapa-historia.md): cada bola e uma tarefa, com o titulo dentro, e as do mesmo projeto ficam
  // juntas, com o nome dele em cima. A bola cresce com os passos e quando precisa dele; a que espera por ele pulsa.
  // O clique na bola abre a historia da tarefa (na pasta de sessoes sem tarefa, o grafo delas); no nome do projeto, o
  // grafo de sessoes dele. "← Mapa" (ou Esc) volta. A largura do desenho acompanha a da tela (altura fixa de 660): em
  // 1536×730 sobra largura. O SVG continua com 100% do quadro, entao trocar o viewBox nao muda o tamanho dele.
  let animarBolhas = true;  // as bolas surgem ao abrir o Mapa; a releitura de 30 s redesenha sem animar
  let tamanhoDoMapa = "";  // o ResizeObserver so redesenha quando o quadro muda de tamanho (senao corta a animacao)
  const clicavel = (el, acao) => {
    el.addEventListener("click", acao);
    el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === e.currentTarget) acao(); });
    return el;
  };
  const dataCurta = iso => (/^\d{4}-\d{2}-\d{2}/.test(String(iso || "")) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : String(iso || ""));
  function larguraDoMapa(svg) {
    const r = svg.getBoundingClientRect();
    const W = r.width > 0 && r.height > 0 ? Math.round(Math.min(1800, Math.max(1100, (660 * r.width) / r.height))) : 1100;
    svg.setAttribute("viewBox", `0 0 ${W} 660`);
    return W;
  }
  function renderMapa(d) {
    const svg = $("mapa");
    svg.replaceChildren();
    const naHistoria = Boolean(alvoMapa && alvoMapa.tipo === "historia");
    $("aba-mapa").dataset.vista = naHistoria ? "historia" : "mapa";
    $("mapaTopo").hidden = !alvoMapa;
    const quadro = svg.parentElement;
    tamanhoDoMapa = `${quadro.clientWidth}x${quadro.clientHeight}`;
    if (naHistoria) return renderHistoria(d);
    const W = larguraDoMapa(svg);
    if (alvoMapa && d.trabalho) {
      const g = V.grafoDoItem(d.trabalho, alvoMapa, { w: W, h: 660 });
      if (g) return renderGrafo(svg, g, d.trabalho, W);
      alvoMapa = null;  // o item saiu do mapa (tarefa fechada, sessão encerrada): volta ao Mapa
      $("mapaTopo").hidden = true;
    }
    renderBolhas(svg, d.trabalho, W);
  }

  function renderBolhas(svg, t, W) {
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "cada bola é uma tarefa: cresce com os passos e quando precisa de você"),
      h("span", {}, "clique na bola para a história; no nome do projeto, para o grafo de sessões"));
    if (!t) {
      svg.append(s("text", { x: 40, y: 60, class: "mapa-aviso" }, "O Copiloto instalado ainda não manda o mapa de trabalho."),
        s("text", { x: 40, y: 80, class: "mapa-aviso" }, "Mescle o PR dele e rode git pull em C:\\Dev\\Dev Seazone\\copiloto."));
      return;
    }
    const sessoes = t.sessoes || {};
    const tarefas = t.projetos.flatMap(p => p.tarefas.map(x => ({ ...x, projeto: p.nome })));
    if (!tarefas.length) {
      svg.append(s("text", { x: W / 2, y: 330, "text-anchor": "middle", class: "mapa-aviso" }, "Nenhuma tarefa aberta nem sessão ativa."));
      return;
    }
    const vivas = x => x.sessoes.filter(sid => (sessoes[sid] || {}).viva).length;
    const { bolhas, grupos } = V.layoutBolhas(tarefas.map(x => ({ id: x.id, grupo: x.projeto, r: V.raioDaTarefa(x, vivas(x)) })), { x: 16, y: 12, w: W - 32, h: 636 });
    const termo = V.semAcento(ui.busca).trim();
    const apagada = x => Boolean((ui.cor && x.cor !== ui.cor) || (termo && ![x.projeto, x.id, x.titulo].some(c => V.semAcento(c).includes(termo))));
    const porId = new Map(tarefas.map(x => [x.id, x]));
    const animar = animarBolhas;
    animarBolhas = false;
    bolhas.forEach((b, i) => {
      const x = porId.get(b.id);
      // a pasta e uma bola menor, com o nome numa fonte menor
      const linhas = x.pasta ? V.textoNaBola(x.titulo, b.r, { letra: 5.6, altura: 12 }) : V.textoNaBola(x.titulo, b.r - 3);
      const entre = x.pasta ? 12 : 14;
      const topo = 4 - ((linhas.length - 1) * entre) / 2;
      const n = vivas(x);
      const dica = x.pasta ? `Sem tarefa · ${x.titulo}: ${x.sessoes.length} ${x.sessoes.length === 1 ? "sessão" : "sessões"}. Clique para o grafo delas.`
        : `${x.id} · ${x.titulo}\n${x.status || "sem status"}${x.passos ? ` · ${x.passos} ${x.passos === 1 ? "passo" : "passos"}` : ""}${n ? ` · ${n} na memória` : ""}. Clique para a história.`;
      const precisa = x.aberta && (x.cor === "atencao" || x.cor === "problema");
      const bolha = s("g", { class: `bolha ${x.cor}${x.pasta ? " pasta" : ""}${x.aberta ? "" : " fechada"}${precisa ? " precisa" : ""}${animar ? " surgir" : ""}`,
        transform: `translate(${b.x},${b.y})`, tabindex: "0", role: "button", "aria-label": dica, opacity: apagada(x) ? 0.22 : null },
        s("title", {}, dica),
        s("g", { class: "bolha-corpo", style: `--atraso:${(i * 53) % 1300}ms` },
          s("circle", { r: b.r + 6, class: "aura" }), s("circle", { r: b.r, class: "bola" }),
          s("text", { "text-anchor": "middle" }, linhas.map((l, k) => s("tspan", { x: 0, y: topo + k * entre }, l)))));
      svg.append(clicavel(bolha, x.pasta ? () => abrirGrafo("tarefa", x.id) : () => abrirHistoria(x.id)));
    });
    // o nome de cada projeto em cima do cacho, medido depois de desenhado: fica dentro do desenho e, se encosta no nome
    // de um projeto mais urgente (que veio antes), encurta; se nem curto cabe, vai para baixo do cacho
    const postos = [];
    for (const g of grupos) {
      const p = t.projetos.find(x => x.nome === g.nome);
      const conta = p.nome === "Sem tarefa" ? `${p.sessoes} ${p.sessoes === 1 ? "sessão" : "sessões"}` : `${p.abertas} ${p.abertas === 1 ? "aberta" : "abertas"}`;
      const nome = document.createTextNode("");
      const rotulo = s("text", { x: g.x, y: g.rotuloY, "text-anchor": "middle", class: "cacho-rot", tabindex: "0", role: "button",
        opacity: tarefas.filter(x => x.projeto === p.nome).every(apagada) ? 0.35 : null },
        s("title", {}, `${p.nome}: ${conta}, ${p.sessoes} ${p.sessoes === 1 ? "sessão" : "sessões"} (${p.vivas} na memória). Clique para o grafo de sessões.`), nome);
      svg.append(clicavel(rotulo, () => abrirGrafo("projeto", p.nome)));
      const colocar = (n, y) => {
        nome.data = `${curto(p.nome, n)} · ${conta}`;
        const w = rotulo.getComputedTextLength(), x = Math.min(Math.max(g.x, w / 2 + 6), W - w / 2 - 6);
        rotulo.setAttribute("x", x);
        rotulo.setAttribute("y", y);
        return { x0: x - w / 2, x1: x + w / 2, y0: y - 12, y1: y + 3 };
      };
      const encosta = c => postos.some(o => c.x0 < o.x1 + 8 && o.x0 < c.x1 + 8 && c.y0 < o.y1 && o.y0 < c.y1);
      const tentar = y => {
        let n = Math.max(24, Math.floor((2 * g.r) / 7)), caixa = colocar(n, y);
        while (n > 8 && encosta(caixa)) caixa = colocar(n -= 2, y);
        return caixa;
      };
      let caixa = tentar(g.rotuloY);
      if (encosta(caixa) && g.y + g.r + 16 <= 654) caixa = tentar(g.y + g.r + 16);
      postos.push(caixa);
    }
  }

  // Grafo do projeto ou da pasta de sessoes sem tarefa: camadas da esquerda para a direita, arestas curvas, rotulo a
  // direita de cada no.
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
      if (acao) clicavel(no, acao);
      svg.append(no);
    }
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "clique numa sessão para ler a conversa; numa tarefa, para a história dela"));
  }
  // O que o clique em cada no do grafo faz: tarefa abre a historia dela; sessao e subsessao abrem a conversa;
  // "+N subsessoes" abre a sessao.
  function acaoDoNo(n) {
    if (n.tipo === "tarefa") return () => abrirHistoria(n.id);
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
    animarBolhas = true;
    renderizar();
  }

  // Historia da tarefa (docs/specs/mapa-historia.md): pedido → passos do Registro → agora ⇢ meta, em cartoes ligados
  // por setas, em quantas fileiras couberem no quadro. Cabem os ultimos passos (onde a tarefa esta); "+N anteriores"
  // volta. A nota e lida no clique (cli.py tarefa historia) e de novo a cada 30 s enquanto a historia esta aberta.
  const historias = new Map();  // tarefa → { dados, carregando, erro, em }
  let inicioHistoria = null;  // primeiro passo mostrado; null = os ultimos que cabem
  const LARGURA = { cartao: 196, agora: 420, nav: 92, seta: 28 }, ALTURA_CARTAO = 160, VAO_FILEIRA = 14;
  function verHistoria(id) {
    if (ui.aba !== "mapa") { ui.aba = "mapa"; salvarPreferencias(); }
    abrirHistoria(id);
  }
  function abrirHistoria(id) {
    alvoMapa = { tipo: "historia", id };
    inicioHistoria = null;
    carregarHistoria(id);
    renderizar();
  }
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
    if (resposta && ui.aba === "mapa" && alvoMapa && alvoMapa.tipo === "historia" && alvoMapa.id === id) renderMapa(resposta.dados);
    if (gaveta && gaveta.tipo === "historia" && gaveta.id.startsWith(`${id}|`)) abrirGaveta("historia", gaveta.id, true);
  }
  function renderHistoria(d) {
    const id = alvoMapa.id;
    const estado = historias.get(id);
    if (!estado || (!estado.carregando && Date.now() - (estado.em || 0) > 30000)) carregarHistoria(id);
    const H = estado && estado.dados;
    const projeto = ((d.trabalho && d.trabalho.projetos) || []).find(p => p.tarefas.some(x => x.id === id));
    const t = projeto ? projeto.tarefas.find(x => x.id === id) : null;
    const status = (H && H.status) || (t && t.status) || "";
    $("mapaTrilha").replaceChildren(...[
      projeto ? h("button", { class: "trilha-link", type: "button", title: "Grafo de sessões do projeto", onclick: () => abrirGrafo("projeto", projeto.nome) }, projeto.nome) : null,
      projeto ? " › " : null, h("b", {}, `${id} · ${(H && H.titulo) || (t && t.titulo) || ""}`),
      h("small", {}, [status, H ? `${H.passos.length} ${H.passos.length === 1 ? "passo" : "passos"}` : "", H && H.prazo ? `prazo ${dataCurta(H.prazo)}` : ""].filter(Boolean).join(" · "))].filter(Boolean));
    $("legenda").replaceChildren(h("span", {}, "pedido → o que foi feito → agora ⇢ meta"), h("span", {}, "clique num cartão para ler inteiro"),
      h("span", {}, "no Agora: responder, revisar o rascunho ou excluir"), h("span", {}, "← Mapa ou Esc volta"));
    const caixa = $("historia");
    if (!H) {
      caixa.replaceChildren(estado && estado.erro && !estado.carregando
        ? h("div", { class: "falha" }, h("h2", {}, "Não consegui ler a história da tarefa"), h("p", {}, estado.erro),
          h("button", { class: "botao pequeno", type: "button", onclick: () => carregarHistoria(id) }, "Tentar de novo"))
        : h("p", { class: "vazio" }, "Lendo a nota da tarefa…"));
      return;
    }
    const largura = caixa.clientWidth - 24, altura = caixa.clientHeight - 24;
    const cabemFileiras = Math.max(1, Math.floor((altura + VAO_FILEIRA) / (ALTURA_CARTAO + VAO_FILEIRA)));
    const total = H.passos.length;
    // a sequencia com `cabem` passos, quebrada em fileiras; a seta que liga uma fileira a outra abre a de baixo
    const arranjar = cabem => {
      const f = V.fatiaDaHistoria(total, inicioHistoria, cabem);
      const itens = [{ tipo: "pedido" }];
      if (f.antes) itens.push({ tipo: "antes", n: f.antes });
      for (let i = f.de; i < f.ate; i++) itens.push({ tipo: "passo", i });
      if (f.depois) itens.push({ tipo: "depois", n: f.depois });
      itens.push({ tipo: "agora" }, { tipo: "meta" });
      const fileiras = [[]];
      let usado = 0;
      for (const it of itens) {
        const w = LARGURA[it.tipo === "agora" ? "agora" : it.tipo === "antes" || it.tipo === "depois" ? "nav" : "cartao"];
        const custo = (fileiras.length > 1 || fileiras[0].length ? LARGURA.seta : 0) + w;
        if (fileiras[fileiras.length - 1].length && usado + custo > largura) { fileiras.push([]); usado = 0; }
        usado += custo;
        fileiras[fileiras.length - 1].push(it);
      }
      return { f, fileiras, cabem };
    };
    let arranjo = arranjar(Math.max(1, total));
    while (arranjo.cabem > 1 && arranjo.fileiras.length > cabemFileiras) arranjo = arranjar(arranjo.cabem - 1);
    const { f, fileiras, cabem } = arranjo;
    const sessoesDaTarefa = ((t && t.sessoes) || []).map(sid => ((d.trabalho && d.trabalho.sessoes) || {})[sid]).filter(Boolean);
    const { porPasso, noAgora } = V.sessoesNosPassos(H.passos, sessoesDaTarefa);
    const naFila = ((d.voce && d.voce.itens) || []).find(i => i.id === id);
    const pendentes = new Set(((d.voce && d.voce.itens) || []).map(i => i.id));
    const agora = V.agoraDaHistoria(H.agora);
    const pilulaSessao = ses => h("button", { class: "pilula", type: "button", title: `${ses.nome}: ${ses.estado}. Clique para a conversa.`,
      onclick: e => { e.stopPropagation(); abrirGaveta("sessao", ses.sessao); } }, bolinha(ses.cor), curto(ses.nome, 24));
    const abrirParte = parte => () => abrirGaveta("historia", `${id}|${parte}`);
    const navegar = inicio => { inicioHistoria = inicio; renderHistoria(resposta.dados); };
    const cartao = (classe, acao, ...filhos) => clicavel(h("article", { class: `cartao-h ${classe}`, tabindex: "0", role: "button" }, ...filhos), acao);
    const topo = texto => h("p", { class: "cartao-h-topo" }, texto);
    const texto = (valor, limite, vazio) => h("p", { class: "cartao-h-texto" }, V.resumoDoPasso(valor, limite) || vazio);
    const montar = it => {
      if (it.tipo === "pedido") {
        const p = H.pedido || {};
        return cartao("pedido", abrirParte("pedido"), topo(`Pedido${p.criada ? ` · ${dataCurta(p.criada)}` : ""}`),
          h("b", { class: "cartao-h-titulo" }, [p.por, p.origem].filter(Boolean).join(" · ") || "Quem pediu não está na nota"),
          texto(p.por_que, 150, "A nota não diz por quê."));
      }
      if (it.tipo === "antes") return h("button", { class: "cartao-h nav", type: "button", title: "Mostrar os passos anteriores", onclick: () => navegar(Math.max(0, f.de - cabem)) }, h("b", {}, `+${it.n}`), "anteriores");
      if (it.tipo === "depois") return h("button", { class: "cartao-h nav", type: "button", title: "Mostrar os passos seguintes", onclick: () => navegar(f.ate + cabem >= total ? null : f.ate) }, h("b", {}, `+${it.n}`), "seguintes");
      if (it.tipo === "passo") {
        const p = H.passos[it.i];
        const delas = porPasso[it.i] || [];
        return cartao(`passo${delas.length ? " com-pilulas" : ""}`, abrirParte(`passo:${it.i}`), topo(`Passo ${it.i + 1} · ${p.quando}`),
          texto(p.texto, delas.length ? 150 : 200, "(vazio)"), delas.length ? h("div", { class: "pilulas" }, delas.map(pilulaSessao)) : null);
      }
      if (it.tipo === "agora") {
        // os botoes ficam no topo, sempre a vista; embaixo, os rascunhos para revisar e as sessoes que cuidam dela agora
        const pilulas = [...(H.rascunhos || []).map(r => h("button", { class: "pilula rascunho", type: "button", disabled: !pendentes.has(r.id), title: r.texto,
          onclick: e => { e.stopPropagation(); abrirGaveta("voce", r.id); } }, `${r.id} · revisar`)), ...noAgora.map(pilulaSessao)];
        return cartao(`agora ${agora.cor}${pilulas.length > 4 ? " muitas-pilulas" : ""}`, () => abrirGaveta("tarefa", id),
          h("div", { class: "cartao-h-cabeca" }, topo(`Agora · ${agora.rotulo}`),
            naFila ? h("button", { class: "mini principal", type: "button", onclick: e => { e.stopPropagation(); abrirGaveta("voce", id); } }, "Responder") : null,
            t && t.aberta ? botaoExcluir(id, "mini", "Excluir") : null),
          texto(H.agora && H.agora.texto, 330, "Nada registrado ainda."),
          pilulas.length ? h("div", { class: "pilulas" }, pilulas) : null);
      }
      return cartao("meta", abrirParte("meta"), topo("Meta · pronto quando"), texto(H.meta, 200, "A nota não diz quando fica pronta."));
    };
    caixa.replaceChildren(...fileiras.map((fileira, fi) => h("div", { class: "historia-fileira" },
      fileira.flatMap((it, k) => [fi || k ? h("span", { class: `seta${it.tipo === "meta" ? " tracejada" : ""}`, "aria-hidden": "true" }, it.tipo === "meta" ? "⇢" : "→") : null, montar(it)]))));
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
        !/^T-/.test(t.id) || (ui.aba === "mapa" && alvoMapa && alvoMapa.tipo === "historia" && alvoMapa.id === id) ? null
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
    if (b.dataset.aba === "mapa" && ui.aba !== "mapa") animarBolhas = true;
    ui.aba = b.dataset.aba; salvarPreferencias(); renderizar();
  }));
  document.querySelectorAll(".colunas-abas button").forEach(b => b.addEventListener("click", () => { ui.coluna = b.dataset.coluna; salvarPreferencias(); renderizar(); }));
  $("abrirRotinas").addEventListener("click", () => { ui.rotinas = "aberta"; salvarPreferencias(); renderizar(); });
  $("recolherRotinas").addEventListener("click", () => { ui.rotinas = "fechada"; salvarPreferencias(); renderizar(); });
  $("busca").addEventListener("input", debounce(e => { ui.busca = e.target.value; renderizar(); }, 120));
  $("atualizar").addEventListener("click", () => carregar(true));
  $("rodarAgora").addEventListener("click", rodarAgora);
  $("fecharGaveta").addEventListener("click", fecharGaveta);
  $("veu").addEventListener("click", fecharGaveta);
  $("voltarMapa").addEventListener("click", voltarAoMapa);
  // o desenho segue o tamanho do quadro: redesenha quando a janela muda ou quando a aba Mapa aparece (escondida, mede 0)
  new ResizeObserver(() => {
    const quadro = $("mapa").parentElement;
    if (resposta && ui.aba === "mapa" && `${quadro.clientWidth}x${quadro.clientHeight}` !== tamanhoDoMapa) renderMapa(resposta.dados);
  }).observe($("mapa").parentElement);
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
