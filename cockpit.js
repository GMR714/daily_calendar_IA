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
  // As abas na ordem do painel do Bill (docs/specs/cockpit-billverso.md). O Painel virou o Pulso, o Mapa de bolas virou
  // Tarefas e o Hoje foi para Saldos: o endereco antigo (#painel, #hoje) ainda abre o lugar certo.
  const P = window.CockpitPainel;
  const ABAS = ["mapa", "pulso", "tarefas", "saldos", "ideias", "entregas"];
  const ABA_ANTIGA = { painel: "pulso", hoje: "saldos" };
  const NOME_TIME = { comando: "Comando", fabrica: "Fábrica", governanca: "Governança", rotinas: "Rotinas", outras: "Outras sessões" };
  const FUNCAO = {
    verificadora: "Confere cada tarefa feita contra a prova antes de ela contar como entregue. Quem entregou não aceita: ela ou você.",
    revisora: "Confere toda mensagem em seu nome antes de sair: o fato na fonte, se ainda vale, sem prometer prazo e no tom combinado.",
    ronda: "O vigia: encerra a sessão de tarefa fechada, destrava o worker parado e roda de novo a rotina que falhou."
  };

  const ui = lerPreferencias();
  let resposta = null;
  let recebidoEm = 0;
  let destaques = new Set();
  let naAgenda = new Set();
  let timer = null;
  let toastTimer = null;
  let carregandoAgora = false;
  let gaveta = null;
  let alvoMapa = null;  // o que o Mapa mostra no lugar das bolas: { tipo: "arvore", alvo: "tarefa" | "projeto" | "pasta" | "semtarefa", id }
  const conversas = new Map();  // "sessao|subagente" → { falas, antes, carregando, erro }
  const sessoesVistas = new Map();  // ultima leitura de cada sessao aberta na gaveta
  const digitadoSessao = new Map();  // resposta que ele esta escrevendo, por sessao
  const resumos = new Map();  // sessao → { texto, fonte, aviso, carregando, erro } do Ouvir
  let falando = null;  // sessao cujo resumo a voz esta lendo
  let ditado = null;  // { sessao, rec } enquanto o microfone ouve
  // O que ele acabou de mudar pela tela vale sobre a leitura do Copiloto que comecou antes da mudanca (P.valeOLocal)
  let prioridadesLocais = null;  // { lista, em }
  const entregasTratadas = new Map();  // id → { em, acao }: o card some na hora e volta se a leitura nova ainda o trouxer
  const $ = id => document.getElementById(id);

  function lerPreferencias() {
    const padrao = { aba: "mapa", cor: null, segmento: null, tipoFila: null, frente: null, coluna: "agentes", rotinas: "fechada", vistaMapa: "padrao", zoom: 1, time: null };
    let lido = { ...padrao };
    try { lido = { ...padrao, ...JSON.parse(localStorage.getItem("cockpit:ui") || "{}") }; } catch { /* sem armazenamento */ }
    const deHash = location.hash.slice(1);  // /cockpit#entregas abre direto nas entregas
    const aba = ABA_ANTIGA[deHash] || deHash;
    if (ABAS.includes(aba)) lido.aba = aba;
    else lido.aba = ABA_ANTIGA[lido.aba] || (ABAS.includes(lido.aba) ? lido.aba : "mapa");
    if (!(Number(lido.zoom) > 0)) lido.zoom = 1;
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
  // O primeiro clique so pede confirmacao; o segundo, em ate 4 s, faz. `confirmar` e o texto do botao armado.
  function botaoDeDoisCliques(classe, rotulo, title, acao, confirmar = "Confirmar") {
    return h("button", { class: classe, type: "button", "data-rotulo": rotulo, title, onclick: ev => {
      ev.stopPropagation();
      const b = ev.currentTarget;
      if (b.dataset.confirmar) return acao(b);
      b.dataset.confirmar = "1";
      b.textContent = confirmar;
      setTimeout(() => { if (b.isConnected && !b.disabled) { delete b.dataset.confirmar; b.textContent = rotulo; } }, 4000);
    } }, rotulo);
  }
  const botaoComConfirmacao = (classe, rotulo, title, acao, confirmar) => botaoDeDoisCliques(`${classe} perigo`, rotulo, title, acao, confirmar);
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
      arvores.delete(`tarefa:${id}`);  // a arvore aberta passa a mostrar a tarefa fechada
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
  // De outra maquina da tailnet (docs/specs/cockpit-pela-tailnet.md), a janela da Mestra abriria no notebook, longe dele:
  // ali o botao abre a conversa dela na gaveta, com a caixa de resposta.
  const deOutraMaquina = !["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  function conversaDaMestra() {
    const d = resposta && resposta.dados;
    const mestra = d && (d.agentes || []).find(a => a.nome === "Mestra" && a.sessao);
    return mestra && ((d.trabalho && d.trabalho.sessoes) || {})[mestra.sessao] ? mestra.sessao : "";
  }
  async function abrirMestra() {
    if (deOutraMaquina && conversaDaMestra()) return abrirGaveta("sessao", conversaDaMestra());
    const botao = $("abrirMestra");
    botao.disabled = true;
    botao.textContent = "Abrindo…";
    try {
      const r = await fetch("/api/copiloto/mestra", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok || corpo.ok === false) throw new Error(corpo.error || corpo.erro || "Não consegui abrir a Mestra.");
      if (deOutraMaquina) {  // ela nasceu ou acordou no notebook: a conversa aparece aqui na proxima leitura
        toast("A Mestra está no notebook: a conversa dela abre aqui em instantes.");
        setTimeout(() => { carregar(true).then(() => { if (conversaDaMestra()) abrirGaveta("sessao", conversaDaMestra()); }); }, 8000);
        return;
      }
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
    // como o "daemon ok · ledger ok · relido há 6 s" do Bill: a saude do ciclo e a idade da leitura
    const saude = resposta.dados && resposta.dados.saude;
    const ciclo = !saude ? "" : saude.ok === false ? "ciclo com falha · " : "ciclo ok · ";
    $("vivoTexto").textContent = `${ciclo}${carregandoAgora || resposta.atualizando ? "relendo" : "relido"} ${V.idade(idade)}`;
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
    mostrarAba();
    document.body.dataset.coluna = ui.coluna; // em tela estreita, as colunas viram abas
    document.body.dataset.rotinas = ui.rotinas;  // em tela larga, Rotinas recolhida vira uma faixa com o selo
    const selo = V.resumoRotinas(d.rotinas);
    $("rotinas-selo").textContent = selo.texto;
    $("rotinas-selo").className = `selo ${selo.cor}`;
    $("abrirRotinas").setAttribute("aria-expanded", String(ui.rotinas === "aberta"));
    document.querySelectorAll(".colunas-abas button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.coluna === ui.coluna)));
    $("alertas").replaceChildren();
    renderKpis(d);
    if (ui.aba === "mapa") renderPainelMapa(d);
    else if (ui.aba === "pulso") {
      renderAgentes(f.agentes);
      renderFila(f.voce, d);
      renderRotinas(V.filtrar(d, { busca: ui.busca, cor: ui.cor, segmento: ui.segmento }).rotinas, f.rotinas);
    } else if (ui.aba === "tarefas") renderMapa(d);
    else if (ui.aba === "saldos") { renderSaldos(d); renderHoje(d); }
    else if (ui.aba === "ideias") renderIdeias(d);
    else renderEntregas(d);
    marcarRodar();
    // redesenhar a gaveta no meio de uma resposta apagaria o que ele esta digitando
    const digitando = document.activeElement && document.activeElement.tagName === "TEXTAREA" && $("gaveta").contains(document.activeElement);
    if (gaveta && !digitando && !ditado) abrirGaveta(gaveta.tipo, gaveta.id, true);  // nem no meio de um ditado
  }

  // Troca de aba: o Pulso, as Tarefas e as Entregas tambem abrem pelos cartoes do topo e do Mapa.
  function mostrarAba() {
    document.querySelectorAll(".abas button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === ui.aba)));
    for (const aba of ABAS) $("aba-" + aba).hidden = ui.aba !== aba;
  }
  function irPara(destino) {
    if (!destino) return;
    if (destino === "voce") { ui.aba = "pulso"; ui.tipoFila = null; ui.coluna = "voce"; }
    else {
      if (destino === "tarefas" && ui.aba !== "tarefas") animarBolhas = true;
      ui.aba = destino;
    }
    salvarPreferencias();
    renderizar();
  }
  const marcaCor = cor => h("span", { class: `marca-cor ${cor}`, title: ROTULO[cor], "aria-hidden": "true" });

  // A faixa de numeros do painel do Bill: duas linhas de cartoes, o numero grande antes do rotulo. O clique abre a aba
  // de cada um; nas Cadeiras, o numero de cada cor filtra a tela inteira, como os chips de antes.
  function renderKpis(d) {
    if (!d.numeros) {
      $("kpis").replaceChildren(h("p", { class: "kpis-aviso" }, "O Copiloto instalado ainda não manda os números do painel. Mescle o PR dele e rode git pull em C:\\Dev\\Dev Seazone\\copiloto."));
      return;
    }
    const { linha1, linha2 } = P.cartoesTopo(d.numeros);
    const cartao = (c, ...dentro) => h("button", { class: `kpi-cartao ${c.cor || ""}`, type: "button",
      title: [c.titulo || `${c.numero} ${c.rotulo}`, c.sub].filter(Boolean).join(" · "), onclick: () => irPara(c.destino) }, ...dentro);
    const primeira = linha1.map(c => cartao(c, h("span", { class: "kpi-numero" }, c.numero), h("span", { class: "kpi-rotulo" }, c.rotulo),
      c.sub ? h("span", { class: "kpi-sub" }, `· ${c.sub}`) : null));
    const [saldo, energia, cadeiras] = linha2;
    const segunda = [
      cartao(saldo, h("span", { class: "kpi-titulo" }, bolinha(saldo.cor), saldo.titulo), h("span", { class: "kpi-rotulo" }, saldo.rotulo),
        saldo.sub ? h("span", { class: "kpi-sub" }, `· ${saldo.sub}`) : null),
      cartao(energia, h("span", { class: "kpi-numero" }, energia.numero), h("span", { class: "kpi-rotulo" }, energia.rotulo),
        energia.sub ? h("span", { class: "kpi-sub" }, `· ${energia.sub}`) : null),
      h("div", { class: "kpi-cartao cadeiras", title: "Os agentes por cor. Clique num número para mostrar só aquela cor." },
        ...CORES.map(c => h("button", { class: `cadeira${ui.cor === c ? " ativo" : ""}`, type: "button", "aria-pressed": String(ui.cor === c),
          title: `${ROTULO[c]}: ${DESC[c]}. ${ui.cor === c ? "Clique para tirar o filtro." : "Clique para mostrar só isso."}`,
          onclick: () => { ui.cor = ui.cor === c ? null : c; salvarPreferencias(); renderizar(); } }, marcaCor(c), cadeiras.cores[c])),
        h("span", { class: "kpi-rotulo" }, "Cadeiras"))];
    $("kpis").replaceChildren(h("div", { class: "kpis-linha" }, primeira), h("div", { class: "kpis-linha" }, segunda));
  }

  // ------------------------------------------------------------------ Mapa: o painel do Bill em tres colunas
  function renderPainelMapa(d) {
    renderPrioridades(d);
    renderTimesLista(d.times || []);
    renderMapaTimes(d);
    renderFilaPainel(d.fila);
    renderSaldosPainel(d.saldos || []);
    renderMaquinasPainel(d);
    renderAconteceu(d.aconteceu || [], d);
  }

  // Prioridades: a lista curta dele, que a orquestradora le a cada ciclo para despachar primeiro o que serve a elas.
  const prioridadesAgora = d => (P.valeOLocal(prioridadesLocais, resposta && resposta.iniciadoEm) ? prioridadesLocais.lista : (d.prioridades || []));
  function renderPrioridades(d) {
    const lista = P.prioridadesEmOrdem(prioridadesAgora(d));
    const abertas = lista.filter(p => !p.feita);
    if (!lista.length) {
      $("prioridades").replaceChildren(h("li", { class: "vazio" }, "Nenhuma prioridade. A orquestradora despacha pela ordem das tarefas."));
      return;
    }
    $("prioridades").replaceChildren(...lista.map(p => {
      const i = abertas.indexOf(p);
      const ligadas = (p.tarefas || []).length;
      return h("li", { class: `prioridade${p.feita ? " feita" : ""}` },
        h("input", { type: "checkbox", checked: p.feita, "aria-label": p.feita ? "Desmarcar: voltar a ser prioridade" : "Marcar como feita",
          onchange: ev => mexerPrioridade({ acao: "marcar", id: p.id, feita: ev.currentTarget.checked }, ev.currentTarget) }),
        h("span", { class: "texto-prio" }, p.texto),
        ligadas ? h("span", { class: "ligadas", title: p.tarefas.join(", ") }, `${ligadas} ${ligadas === 1 ? "tarefa ligada" : "tarefas ligadas"}`) : null,
        h("span", { class: "controles" },
          h("button", { class: "quadrado", type: "button", title: "Subir", "aria-label": "Subir", disabled: p.feita || i <= 0,
            onclick: ev => mexerPrioridade({ acao: "mover", id: p.id, direcao: "subir" }, ev.currentTarget) }, "↑"),
          h("button", { class: "quadrado", type: "button", title: "Descer", "aria-label": "Descer", disabled: p.feita || i === abertas.length - 1,
            onclick: ev => mexerPrioridade({ acao: "mover", id: p.id, direcao: "descer" }, ev.currentTarget) }, "↓"),
          botaoComConfirmacao("quadrado", "🗑", "Apagar a prioridade (o segundo clique confirma)", b => mexerPrioridade({ acao: "apagar", id: p.id }, b), "✓")));
    }));
  }
  async function mexerPrioridade(pedido, controle) {
    if (controle) controle.disabled = true;
    try {
      const r = await fetch("/api/copiloto/prioridades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedido) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "O Copiloto não aceitou a prioridade.");
      prioridadesLocais = { lista: corpo.prioridades || [], em: Date.now() };
      if (pedido.acao === "adicionar") $("novaPrioridade").value = "";
      if (pedido.acao === "adicionar") toast("Prioridade gravada: a orquestradora liga a tarefa que a serve no próximo ciclo.");
    } catch (erro) {
      toast(erro.message);
    }
    if (resposta) renderPrioridades(resposta.dados);
  }

  // Times: um cartao por time; o clique destaca o time no mapa (de novo, tira o destaque)
  function renderTimesLista(times) {
    if (!times.length) { $("timesLista").replaceChildren(h("p", { class: "vazio" }, "Nenhum time com gente agora.")); return; }
    $("timesLista").replaceChildren(...times.map(t => {
      const cores = CORES.filter(c => (t.cores || {})[c]);
      const pior = cores[0] || "sem_sinal";
      return h("button", { class: `time-cartao${ui.time === t.chave ? " ativo" : ""}`, type: "button", "aria-pressed": String(ui.time === t.chave),
        title: `${t.nome}: ${P.subtituloTime(t)}. Clique para destacar no mapa.`, onclick: () => { ui.time = ui.time === t.chave ? null : t.chave; salvarPreferencias(); renderizar(); } },
        h("div", { class: "linha-time-1" }, bolinha(pior), h("b", {}, t.nome),
          h("span", { class: "cores-time" }, cores.map(c => h("span", {}, marcaCor(c), t.cores[c])))),
        h("div", { class: "linha-time-2" }, P.linhaTime(t)));
    }));
  }

  // O mapa dos times: os nos e as ligacoes vem prontos do Copiloto (times.montar); aqui so se desenha. O desenho
  // cabe no quadro (zoom 1); + e − aproximam e afastam, e o quadro rola por dentro.
  function renderMapaTimes(d) {
    const svg = $("mapaTimes");
    const nos = d.nos || [];
    const observa = ui.vistaMapa === "observa";
    document.querySelectorAll(".vistas-mapa button[data-vista]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vista === ui.vistaMapa)));
    if (!nos.length) {
      svg.setAttribute("viewBox", "0 0 600 120");
      svg.setAttribute("width", "600");
      svg.setAttribute("height", "120");
      svg.replaceChildren(s("text", { x: 300, y: 60, "text-anchor": "middle", class: "mapa-vazio" },
        d.numeros ? "Nenhum agente no mapa agora." : "O Copiloto instalado ainda não manda o mapa dos times: mescle o PR dele e rode git pull."));
      $("legendaTimes").replaceChildren();
      $("mapaNota").hidden = true;
      return;
    }
    const L = P.layoutTimes(nos, d.ligacoes || [], { observa });
    // a legenda so mostra as cores e as linhas que aparecem
    const SENTIDO = { delega: "quem passa trabalho a quem", escala: "o agente que espera você", rotinas: "a rotina que acorda o agente", observa: "quem confere o trabalho de quem" };
    $("legendaTimes").replaceChildren(...CORES.map(c => h("span", {}, marcaCor(c), ROTULO[c].toLowerCase())), h("span", { class: "separa" }),
      ...L.tipos.map(t => h("span", { title: SENTIDO[t] || t }, h("i", { class: `tracinho ${t}` }), t)));
    // um aviso numa linha, como o do Bill: o bloco do painel que falhou ou o ciclo com problema
    const erros = Object.keys(d.erros_painel || {});
    const nota = erros.length ? `O Copiloto não montou ${erros.join(", ")} nesta leitura: o resto do painel segue.`
      : d.saude && d.saude.ok === false ? `O ciclo do Copiloto está falhando${d.saude.erro ? `: ${curto(d.saude.erro, 140)}` : "."}` : "";
    $("mapaNota").hidden = !nota;
    $("mapaNota").textContent = nota;
    const termo = V.semAcento(ui.busca).trim();
    const apagado = n => Boolean((ui.cor && n.tipo !== "voce" && n.tipo !== "entregas" && n.cor !== ui.cor)
      || (ui.time && n.time !== ui.time && n.tipo !== "voce" && n.tipo !== "entregas")
      || (termo && ![n.nome, n.estado, n.detalhe, n.tarefa].some(c => V.semAcento(c).includes(termo))));
    const apagados = new Set(L.nos.filter(apagado).map(n => n.id));
    const defs = s("defs", {}, ...["delega", "escala", "rotinas", "observa", "esteira"].map(t => s("marker", { id: `seta-${t}`, viewBox: "0 0 10 10", refX: 9, refY: 5,
      markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, s("path", { d: "M0,1 L9,5 L0,9 z", class: `seta ${t}` }))));
    // por ordem: o fundo das caixas, a esteira e as ligacoes, o nome de cada caixa por cima das linhas e os agentes
    const apagada = c => (ui.time && ui.time !== c.time ? " apagada" : "");
    const fundos = L.caixas.map(c => s("g", { class: `caixa-time${apagada(c)}` }, s("rect", { x: c.x, y: c.y, width: c.w, height: c.h, rx: 10 })));
    const nomes = L.caixas.map(c => {
      const time = (d.times || []).find(t => t.chave === c.time);
      return s("g", { class: `caixa-time${apagada(c)}` },
        s("text", { x: c.x + 10, y: c.y + 15, class: "nome-caixa" }, NOME_TIME[c.time] || c.nome),
        time ? s("text", { x: c.x + 10, y: c.y + 27, class: "sub-caixa" }, P.subtituloTime(time)) : null);
    });
    const arestas = L.arestas.map(a => s("path", { d: a.d, class: `ligacao ${a.tipo}${apagados.has(a.de) && apagados.has(a.para) ? " apagada" : ""}`,
      "marker-end": `url(#seta-${a.tipo})` }));
    const esteira = L.esteira ? s("path", { d: L.esteira, class: "ligacao esteira", "marker-end": "url(#seta-esteira)" }, s("title", {}, "o que a Fábrica entrega hoje")) : null;
    const nosSvg = L.nos.map(n => noDoMapa(n, apagados.has(n.id)));
    const escala = escalaDoMapa(L);
    svg.setAttribute("viewBox", `0 0 ${L.largura} ${L.altura}`);
    svg.setAttribute("width", String(Math.round(L.largura * escala)));
    svg.setAttribute("height", String(Math.round(L.altura * escala)));
    $("mapaRolagem").classList.toggle("aproximado", ui.zoom > 1);
    svg.replaceChildren(defs, ...fundos, s("g", { class: "ligacoes" }, esteira, arestas), ...nomes, ...nosSvg);
  }
  // cabe no quadro com o zoom 1; o + e o − multiplicam
  function escalaDoMapa(L) {
    const quadro = $("mapaRolagem");
    const caber = quadro.clientWidth > 0 && quadro.clientHeight > 0 ? Math.min(quadro.clientWidth / L.largura, (quadro.clientHeight - 4) / L.altura) : 1;
    return Math.max(0.3, Math.min(3, caber * (ui.zoom || 1)));
  }
  // A marca da cor (losango, triangulo, bola, anel), como na legenda
  function marcaNoSvg(cor, x, y) {
    if (cor === "problema") return s("polygon", { class: "cor-no problema", points: `${x},${y - 4.5} ${x + 4.5},${y} ${x},${y + 4.5} ${x - 4.5},${y}` });
    if (cor === "atencao") return s("polygon", { class: "cor-no atencao", points: `${x},${y - 4.5} ${x + 4.8},${y + 3.8} ${x - 4.8},${y + 3.8}` });
    return s("circle", { class: `cor-no ${cor === "bem" ? "bem" : "sem_sinal"}`, cx: x, cy: y, r: cor === "bem" ? 4 : 3.4 });
  }
  function seloNoSvg(n, x, y) {
    if (n.selo === null || n.selo === undefined || n.selo === 0) return null;
    const texto = String(n.selo);
    const r = texto.length > 2 ? 10 : 8;
    return s("g", { class: "selo-no" }, s("circle", { cx: x, cy: y, r }), s("text", { x, y: y + 3.3, "text-anchor": "middle" }, texto));
  }
  function noDoMapa(n, apagado) {
    const onde = V.ondeRoda(n, resposta && resposta.dados && resposta.dados.agentes);
    const dica = [n.nome, onde ? `na máquina ${onde}` : "", n.detalhe || n.estado, n.tarefa ? `tarefa ${n.tarefa}` : "", n.selo ? `${n.selo} na fila` : ""].filter(Boolean).join(" · ");
    const acao = acaoDoNo(n);
    const base = { class: `no-time ${n.tipo} ${n.cor}${n.tipo === "voce" ? " no-voce" : ""}${n.tipo === "entregas" ? " no-entregas" : ""}${apagado ? " apagado" : ""}`,
      transform: `translate(${n.x},${n.y})`, tabindex: acao ? "0" : null, role: acao ? "button" : null, "aria-label": dica };
    let corpo;
    if (n.tipo === "voce") {
      corpo = [s("rect", { class: "corpo", width: n.w, height: n.h, rx: n.h / 2 }),
        s("text", { class: "nome-no", x: n.w / 2, y: n.h / 2 + 4, "text-anchor": "middle" }, "Você"), seloNoSvg(n, n.w - 2, 2)];
    } else if (n.tipo === "entregas") {
      corpo = [s("rect", { class: "corpo", width: n.w, height: n.h, rx: 10 }),
        s("text", { class: "nome-no", x: n.w / 2, y: 22, "text-anchor": "middle" }, "Entregas hoje"),
        s("text", { class: "numero-no", x: n.w / 2, y: 46, "text-anchor": "middle" }, String(n.selo || 0))];
    } else {
      const pct = n.tipo === "agente" && n.contexto ? `${V.medidorContexto(n.contexto).pct}%` : "";
      const nomeMax = Math.floor((n.w - (pct ? 48 : 30)) / 6.1);
      corpo = [s("rect", { class: "corpo", width: n.w, height: n.h, rx: 7 }), marcaNoSvg(n.cor, 12, n.tipo === "rotina" ? n.h / 2 - 5 : 13),
        s("text", { class: "nome-no", x: 22, y: n.tipo === "rotina" ? n.h / 2 - 1.5 : 17 }, curto(n.nome, nomeMax)),
        s("text", { class: "estado-no", x: 22, y: n.tipo === "rotina" ? n.h / 2 + 10 : 31 }, curto((onde ? `${onde} · ` : "") + (n.estado || ""), Math.floor((n.w - 30) / 5.3))),
        pct ? s("text", { class: "pct-no", x: n.w - (n.selo ? 22 : 8), y: 17, "text-anchor": "end" }, s("title", {}, `contexto: ${V.medidorContexto(n.contexto).rotulo} tokens`), pct) : null,
        seloNoSvg(n, n.w - 4, 4)];
    }
    const g = s("g", base, s("title", {}, dica), ...corpo.filter(Boolean));
    return acao ? clicavel(g, acao) : g;
  }
  // O clique no agente abre a conversa dele (ler, responder, ouvir, parar); na rotina, a rotina; em Voce, a sua fila;
  // nas Entregas de hoje, a aba Entregas; na governanca, o que ela faz.
  function acaoDoNo(n) {
    const d = resposta && resposta.dados;
    if (!d) return null;
    if (n.tipo === "voce") return () => irPara("voce");
    if (n.tipo === "entregas") return () => irPara("entregas");
    if (n.tipo === "rotina" && n.rotina) return () => abrirGaveta("rotina", n.rotina);
    if (n.tipo === "funcao") return () => abrirGaveta("funcao", n.id);
    if (n.tipo === "agente") {
      const sessoes = (d.trabalho && d.trabalho.sessoes) || {};
      const agente = (d.agentes || []).find(a => (n.agente && a.id === n.agente) || (n.sessao && a.sessao === n.sessao));
      const sessao = n.sessao || (agente && agente.sessao) || "";
      if (sessao && sessoes[sessao]) return () => abrirGaveta("sessao", sessao);
      if (agente && agente.id) return () => abrirGaveta("agente", agente.id);
    }
    return null;
  }

  // A direita: a fila em quadros, os saldos e o que aconteceu
  function renderFilaPainel(fila) {
    $("filaGrade").replaceChildren(...P.cartoesFila(fila).map(c => h("button", { class: `fila-item${c.larga ? " larga" : ""}`, type: "button",
      title: `${c.numero} ${c.rotulo}. Clique para abrir.`, onclick: () => irPara(c.destino) },
      h("span", { class: "numero" }, c.numero), h("span", { class: "rotulo" }, c.rotulo))));
  }
  function renderSaldosPainel(saldos) {
    $("saldosLista").replaceChildren(...(saldos.length ? saldos.map(sa => h("div", { class: "saldo-item", title: `${sa.nome}: ${sa.detalhe} (${sa.fonte})` },
      h("div", { class: "saldo-1" }, bolinha(sa.cor), h("b", {}, sa.nome), h("span", { class: `saldo-pct ${sa.cor}` }, `${sa.disponivel}% disponível`)),
      h("div", { class: "saldo-2" }, sa.detalhe))) : [h("p", { class: "vazio" }, "Sem leitura dos saldos.")]));
  }
  // As outras maquinas (o PC de casa): no ar ou fora, vagas livres, memoria e quando o ciclo leu; sem nenhuma, some.
  function renderMaquinasPainel(d) {
    const linhas = V.linhasMaquinas(d);
    $("cartaoMaquinas").hidden = !linhas.length;
    $("maquinasLista").replaceChildren(...linhas.map(m => h("div", { class: "maquina-item", title: m.texto },
      bolinha(m.cor), h("span", {}, m.texto))));
  }
  function renderAconteceu(itens, d) {
    if (!itens.length) { $("aconteceu").replaceChildren(h("li", { class: "vazio" }, "Nada andou hoje ainda.")); return; }
    const termo = V.semAcento(ui.busca).trim();
    const naTela = id => ((d.trabalho && d.trabalho.projetos) || []).some(p => p.tarefas.some(x => x.id === id));
    $("aconteceu").replaceChildren(...itens.filter(i => !termo || [i.texto, i.titulo, i.tarefa].some(c => V.semAcento(c).includes(termo))).map(i => {
      const abrir = naTela(i.tarefa) ? () => abrirGaveta("tarefa", i.tarefa) : null;
      const li = h("li", { title: `${i.tarefa} · ${i.titulo}\n${i.texto}`, tabindex: abrir ? "0" : null, role: abrir ? "button" : null },
        h("span", { class: "hora-ac" }, i.hora), h("span", { class: "texto-ac" }, h("span", { class: "id-ac" }, i.tarefa), " ", i.texto));
      return abrir ? clicavel(li, abrir) : li;
    }));
  }

  // ------------------------------------------------------------------ Saldos, Ideias e Entregas
  function renderSaldos(d) {
    const saldos = d.saldos || [];
    const gastos = P.gastoPorSessao(d.agentes || []).slice(0, 8);
    const energia = (d.numeros && d.numeros.energia) || {};
    const nota = d.nota;
    $("saldosGrade").replaceChildren(
      ...saldos.map(sa => h("section", { class: "saldo-cartao" }, h("h2", { class: "rotulo-painel" }, sa.nome),
        h("div", { class: "grande" }, `${sa.disponivel}%`, h("small", {}, "disponível")),
        h("div", { class: "barra" }, h("i", { class: sa.cor, style: `width:${Math.max(0, Math.min(100, Number(sa.disponivel) || 0))}%` })),
        h("div", { class: "detalhe" }, `${sa.detalhe} · ${sa.fonte}`))),
      nota ? h("section", { class: "saldo-cartao" }, h("h2", { class: "rotulo-painel" }, "Organização do workspace"),
        h("div", { class: "grande" }, String(nota.nota), h("small", {}, "/ 100")),
        h("div", { class: "barra" }, h("i", { class: nota.nota >= 75 ? "bem" : nota.nota >= 50 ? "atencao" : "problema", style: `width:${Math.max(0, Math.min(100, nota.nota))}%` })),
        h("div", { class: "detalhe" }, `auditoria de ${nota.dia || "hoje"}`)) : null,
      h("section", { class: "saldo-cartao largo" }, h("h2", { class: "rotulo-painel" }, "Energia de hoje"),
        h("div", { class: "grande" }, P.tokensCurto(energia.tokens || 0), h("small", {}, "tokens, sem o cache lido")),
        gastos.length ? h("ul", { class: "gasto-lista" }, gastos.map(g => h("li", {}, h("span", {}, g.nome), h("b", {}, P.tokensCurto(g.tokens)))))
          : h("p", { class: "detalhe" }, "Nenhuma sessão gastou hoje.")));
  }
  function renderIdeias(d) {
    const grupos = P.ideiasPorSecao(d.ideias || [], ui.busca);
    const total = (d.ideias || []).length;
    $("ideias").replaceChildren(
      h("p", { class: "ideias-intro" }, h("b", {}, `${total} ${total === 1 ? "ideia" : "ideias"} no BACKLOG do copiloto`),
        ": o que ainda não virou trabalho, da seção mais nova para a mais velha. Só leitura: o que vira trabalho sai daqui como tarefa."),
      ...(grupos.length ? grupos.map(g => h("section", { class: "ideias-secao" }, h("h3", {}, g.secao), h("ul", {}, g.itens.map(t => h("li", {}, trechos(t))))))
        : [h("p", { class: "vazio" }, total ? "Nenhuma ideia com essa busca." : "O BACKLOG não tem ideia aberta.")]));
  }
  // "Entregue não é aceito": cada tarefa feita espera o aceite de quem não entregou. Aceitar marca a tarefa como
  // verificada por ele; reprovar pede o motivo e devolve a tarefa ao worker.
  function renderEntregas(d) {
    const todas = d.entregas || [];
    for (const [id, t] of entregasTratadas) if (!P.valeOLocal(t, resposta.iniciadoEm)) entregasTratadas.delete(id);
    const termo = V.semAcento(ui.busca).trim();
    const lista = todas.filter(e => !entregasTratadas.has(e.id) && (!termo || [e.id, e.titulo, e.projeto, e.resumo].some(c => V.semAcento(c).includes(termo))));
    $("entregas").replaceChildren(
      h("p", { class: "entregas-intro" }, h("b", {}, "Entregue não é aceito"),
        ": cada tarefa aqui espera a revisão de quem não a entregou. A evidência que é link https:// abre em outra aba; o resto aparece como texto."),
      h("div", { class: "entregas-cabeca" }, h("h2", { class: "rotulo-painel" }, `Entregues · ${lista.length}`),
        h("span", { class: "fonte" }, `fonte: as notas do vault · lido ${resposta ? V.idade((resposta.idadeSegundos || 0) + (Date.now() - recebidoEm) / 1000) : ""}`)),
      lista.length ? h("div", { class: "entregas-lista" }, lista.map(cartaoEntrega))
        : h("p", { class: "vazio" }, todas.length ? "Nenhuma entrega com essa busca." : "Nenhuma entrega esperando aceite."));
  }
  function cartaoEntrega(e) {
    const v = P.entregaVista(e);
    const itemLista = it => h("li", {}, it.tipo === "link" ? h("a", { href: it.href, target: "_blank", rel: "noopener noreferrer" }, it.texto)
      : it.tipo === "print" ? [h("span", { class: "tipo-print" }, "print"), it.texto] : it.texto);
    const motivo = h("textarea", { class: "resposta-texto", rows: "2", maxlength: "500", placeholder: "O que faltou? Vai para a nota e volta com a tarefa para o worker." });
    const caixaMotivo = h("div", { class: "reprovar-motivo", hidden: true }, motivo,
      h("div", { class: "acoes" }, h("button", { class: "botao pequeno perigo", type: "button", "data-confirmar": "1",
        onclick: ev => { const t = motivo.value.trim(); if (!t) { motivo.focus(); return toast("Diga o que faltou."); } darVeredito(e, "reprovar", t, ev.currentTarget); } }, "Reprovar e devolver ao worker"),
        h("button", { class: "botao pequeno secundario", type: "button", onclick: () => { caixaMotivo.hidden = true; } }, "Cancelar")));
    return h("article", { class: "entrega-cartao" },
      h("div", { class: "entrega-topo" }, h("span", { class: "entrega-id" }, e.id), h("span", { class: "entrega-quando" }, e.entregue_em ? `entregue ${e.entregue_em}` : "")),
      h("h3", {}, e.titulo),
      e.projeto ? h("div", { class: "entrega-projeto" }, e.projeto) : null,
      e.resumo ? h("p", { class: "entrega-resumo" }, trechos(e.resumo)) : null,
      v.evidencias.length ? [h("div", { class: "entrega-rotulo" }, "Evidências"), h("ul", { class: "entrega-lista" }, v.evidencias.map(itemLista))] : null,
      v.artefatos.length ? [h("div", { class: "entrega-rotulo" }, "Artefatos"), h("ul", { class: "entrega-lista" }, v.artefatos.map(itemLista))] : null,
      h("div", { class: "acoes" },
        botaoDeDoisCliques("botao pequeno secundario", "Aceitar", "Marca a tarefa como aceita por você (o segundo clique confirma)", b => darVeredito(e, "ok", "", b), "Confirmar aceite"),
        h("button", { class: "botao pequeno secundario", type: "button", onclick: () => { caixaMotivo.hidden = false; motivo.focus(); } }, "Reprovar"),
        V.linkObsidian(e) ? h("a", { class: "link", href: V.linkObsidian(e) }, "Abrir a nota") : null),
      caixaMotivo);
  }
  async function darVeredito(e, veredito, motivo, botao) {
    botao.disabled = true;
    const rotulo = botao.textContent;
    botao.textContent = veredito === "ok" ? "Aceitando…" : "Reprovando…";
    try {
      const r = await fetch("/api/copiloto/veredito", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tarefa: e.id, veredito, motivo }) });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || "O Copiloto não aceitou o veredito.");
      entregasTratadas.set(e.id, { em: Date.now(), acao: corpo.acao });
      toast(veredito === "ok" ? `${e.id} aceita: a tarefa fica verificada por você.` : `${e.id} reprovada: volta para o worker, com o seu motivo na nota.`);
      renderizar();
    } catch (erro) {
      botao.disabled = false;
      if (botao.dataset.rotulo) delete botao.dataset.confirmar;  // o Aceitar volta a pedir os dois cliques
      botao.textContent = botao.dataset.rotulo || rotulo;
      toast(erro.message);
    }
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
  // A sessao de outra maquina (o PC de casa) leva o nome dela num chip; a do notebook, nada.
  function chipMaquina(a) {
    const m = V.ondeRoda(a);
    return m ? h("span", { class: "chip maquina", title: `Roda na máquina ${m}, não neste notebook` }, m) : null;
  }
  // Linha compacta (2 linhas): nome e hora; estado e contexto. O resto fica na gaveta.
  function linhaAgente(a) {
    const ctx = V.medidorContexto(a.contexto);
    const abrir = () => abrirGaveta("agente", a.id);
    return h("article", { class: `linha cor-${a.cor}${destaques.has(a.id) ? " mudou" : ""}`, tabindex: "0", role: "button", title: a.agora || a.estado,
      onclick: abrir, onkeydown: e => { if (e.key === "Enter") abrir(); } },
      h("div", { class: "linha-1" }, bolinha(a.cor), h("b", {}, a.nome), a.papel && a.papel !== "sessão" ? h("span", { class: `chip ${a.papel}` }, a.papel) : null,
        chipMaquina(a),
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
    const naArvore = Boolean(alvoMapa && alvoMapa.tipo === "arvore");
    $("aba-tarefas").dataset.vista = naArvore ? "arvore" : "mapa";
    $("mapaTopo").hidden = !naArvore;
    const quadro = svg.parentElement;
    tamanhoDoMapa = `${quadro.clientWidth}x${quadro.clientHeight}`;
    if (naArvore) return renderArvore(d);
    renderBolhas(svg, d.trabalho, larguraDoMapa(svg));
  }

  function renderBolhas(svg, t, W) {
    $("legenda").replaceChildren(...CORES.map(c => h("span", {}, bolinha(c), ROTULO[c])),
      h("span", {}, "cada bola é uma tarefa: cresce com os passos e quando precisa de você"),
      h("span", {}, "clique na bola para a árvore da tarefa; no nome do projeto, para a do projeto"));
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
      const dica = x.pasta ? `Sem tarefa · ${x.titulo}: ${x.sessoes.length} ${x.sessoes.length === 1 ? "sessão" : "sessões"}. Clique para a árvore delas.`
        : `${x.id} · ${x.titulo}\n${x.status || "sem status"}${x.passos ? ` · ${x.passos} ${x.passos === 1 ? "passo" : "passos"}` : ""}${n ? ` · ${n} na memória` : ""}. Clique para a árvore da tarefa.`;
      const precisa = x.aberta && (x.cor === "atencao" || x.cor === "problema");
      const bolha = s("g", { class: `bolha ${x.cor}${x.pasta ? " pasta" : ""}${x.aberta ? "" : " fechada"}${precisa ? " precisa" : ""}${animar ? " surgir" : ""}`,
        transform: `translate(${b.x},${b.y})`, tabindex: "0", role: "button", "aria-label": dica, opacity: apagada(x) ? 0.22 : null },
        s("title", {}, dica),
        s("g", { class: "bolha-corpo", style: `--atraso:${(i * 53) % 1300}ms` },
          s("circle", { r: b.r + 6, class: "aura" }), s("circle", { r: b.r, class: "bola" }),
          s("text", { "text-anchor": "middle" }, linhas.map((l, k) => s("tspan", { x: 0, y: topo + k * entre }, l)))));
      svg.append(clicavel(bolha, () => abrirArvore(x.pasta ? "pasta" : "tarefa", x.id)));
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
        s("title", {}, `${p.nome}: ${conta}, ${p.sessoes} ${p.sessoes === 1 ? "sessão" : "sessões"} (${p.vivas} na memória). Clique para a árvore do projeto.`), nome);
      svg.append(clicavel(rotulo, () => abrirArvore(p.nome === "Sem tarefa" ? "semtarefa" : "projeto", p.nome)));
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

  function voltarAoMapa() {
    alvoMapa = null;
    animarBolhas = true;
    renderizar();
  }

  // Arvore de decisao (docs/specs/mapa-bolas-arvore.md): o clique na bola abre a arvore da tarefa; no nome do projeto,
  // a do projeto. De cima para baixo: a parte com filhos abre e fecha no clique (uma aberta por nivel), a decisao e um
  // losango e o ramo leva o rotulo na linha. As partes vem da nota (## Partes) pelo Copiloto (cli.py tarefa arvore e
  // projeto arvore, ADR 030); sem partes, a historia vem em partes: o pedido, o feito, o agora e o pronto quando.
  // Relida a cada 30 s enquanto aberta, sem fechar nada.
  const arvores = new Map();  // "tarefa:T-..." | "projeto:Nome" → { dados, carregando, erro, em }
  let abertosArvore = null;  // chaves abertas; null = a arvore acabou de abrir (abre a raiz e o que a nota manda)
  let visiveisArvore = new Set();  // o que ja estava na tela: so o que aparece agora surge com movimento
  const ESTADO_ARVORE = { feito: "feito", andando: "andando", falta: "falta", espera: "espera alguém de fora",
    voce: "precisa de você", descartado: "descartado", decisao: "decisão", nota: "nota" };
  const semMovimento = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function verHistoria(id) {
    if (ui.aba !== "tarefas") { ui.aba = "tarefas"; salvarPreferencias(); }
    abrirArvore("tarefa", id);
  }
  function abrirArvore(alvo, id) {
    alvoMapa = { tipo: "arvore", alvo, id };
    abertosArvore = null;
    visiveisArvore = new Set();
    if (alvo === "tarefa" || alvo === "projeto") carregarArvore(alvo, id);
    renderizar();
  }
  async function carregarArvore(alvo, id) {
    const chave = `${alvo}:${id}`;
    const atual = arvores.get(chave) || {};
    if (atual.carregando) return;
    arvores.set(chave, { ...atual, carregando: true, erro: "" });
    try {
      const r = await fetch(`/api/${alvo === "projeto" ? "projetos" : "tarefas"}/${encodeURIComponent(id)}/arvore`, { cache: "no-store" });
      const corpo = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corpo.error || `O servidor respondeu ${r.status}.`);
      arvores.set(chave, { dados: corpo, carregando: false, erro: "", em: Date.now() });
    } catch (erro) {
      arvores.set(chave, { ...(arvores.get(chave) || {}), carregando: false, erro: V.mensagemDeFalha(erro), em: Date.now() });
    }
    if (resposta && ui.aba === "tarefas" && alvoMapa && alvoMapa.tipo === "arvore" && `${alvoMapa.alvo}:${alvoMapa.id}` === chave) renderMapa(resposta.dados);
  }
  // os dados da arvore: da nota (tarefa e projeto) ou montados aqui (a pasta e "Sem tarefa", que nao tem nota)
  function dadosDaArvore(d) {
    const t = d.trabalho || { projetos: [], sessoes: {} };
    if (alvoMapa.alvo === "pasta" || alvoMapa.alvo === "semtarefa") {
      const sem = (t.projetos || []).find(p => p.nome === "Sem tarefa");
      const pastas = sem ? sem.tarefas : [];
      if (alvoMapa.alvo === "semtarefa") {
        return { dados: { tipo: "semtarefa", texto: "Sem tarefa", estado: "nota", tarefas: [], filhos: pastas.map(x => V.arvoreDaPasta(x, t.sessoes || {})) } };
      }
      const x = pastas.find(p => p.id === alvoMapa.id);
      return x ? { dados: V.arvoreDaPasta(x, t.sessoes || {}) } : { erro: "A pasta saiu do Mapa: as sessões dela fecharam." };
    }
    const chave = `${alvoMapa.alvo}:${alvoMapa.id}`;
    const estado = arvores.get(chave);
    if (!estado || (!estado.carregando && Date.now() - (estado.em || 0) > 30000)) carregarArvore(alvoMapa.alvo, alvoMapa.id);
    return estado || { carregando: true };
  }
  function renderArvore(d) {
    const caixa = $("arvoreDecisao");
    const estado = dadosDaArvore(d);
    const raiz = estado.dados;
    const t = d.trabalho || { projetos: [], sessoes: {} };
    const projetos = t.projetos || [];
    // em cima: o projeto (abre a arvore dele) › a tarefa, de onde vem a arvore, e as sessoes vivas, que abrem a conversa
    const projeto = alvoMapa.alvo === "tarefa" ? projetos.find(p => p.tarefas.some(x => x.id === alvoMapa.id)) : null;
    const tarefa = projeto ? projeto.tarefas.find(x => x.id === alvoMapa.id) : null;
    const ids = alvoMapa.alvo === "tarefa" ? ((tarefa && tarefa.sessoes) || [])
      : alvoMapa.alvo === "projeto" ? ((projetos.find(p => p.nome === alvoMapa.id) || { tarefas: [] }).tarefas.flatMap(x => x.sessoes || [])) : [];
    const vivas = [...new Set(ids)].map(sid => ({ sid, ...((t.sessoes || {})[sid] || {}) })).filter(x => x.viva);
    const fonte = raiz && { partes: "partes da nota", historia: "sem partes: a história", tarefas: "sem nota: as tarefas" }[raiz.fonte];
    $("mapaTrilha").replaceChildren(...[
      projeto ? h("button", { class: "trilha-link", type: "button", title: "Árvore do projeto", onclick: () => abrirArvore("projeto", projeto.nome) }, projeto.nome) : null,
      projeto ? " › " : null,
      h("b", {}, alvoMapa.alvo === "tarefa" ? `${alvoMapa.id} · ${(raiz && raiz.texto) || (tarefa && tarefa.titulo) || ""}` : (raiz && raiz.texto) || alvoMapa.id),
      fonte ? h("small", {}, fonte) : null,
      ...vivas.slice(0, 4).map(x => h("button", { class: "pilula", type: "button", title: `${x.nome || x.sid}: ${x.estado || "viva"}. Clique para a conversa.`,
        onclick: () => abrirGaveta("sessao", x.sid) }, bolinha(x.cor || "bem"), curto(x.nome || x.sid, 22)))].filter(Boolean));
    $("legenda").replaceChildren(
      ...["feito", "andando", "falta", "espera", "voce", "descartado"].map(e => h("span", {}, h("i", { class: `ponto-arvore ${e}` }), ESTADO_ARVORE[e])),
      h("span", {}, h("i", { class: "ponto-arvore decisao" }), "decisão: o ramo leva o rótulo"),
      h("span", {}, "clique na parte para abrir (uma por nível); no id, a gaveta da tarefa"), h("span", {}, "← Mapa ou Esc volta"));
    if (!raiz) {
      const deNovo = alvoMapa.alvo === "tarefa" || alvoMapa.alvo === "projeto";
      caixa.replaceChildren(estado.erro && !estado.carregando
        ? h("div", { class: "falha" }, h("h2", {}, "Não consegui ler a árvore"), h("p", {}, estado.erro),
          deNovo ? h("button", { class: "botao pequeno", type: "button", onclick: () => carregarArvore(alvoMapa.alvo, alvoMapa.id) }, "Tentar de novo") : null)
        : h("p", { class: "vazio" }, "Lendo a nota…"));
      return;
    }
    if (!abertosArvore) abertosArvore = V.abertosIniciais(raiz);
    desenharArvore(caixa, raiz);
  }
  function desenharArvore(caixa, raiz, foco = null) {
    const livre = Math.max(320, caixa.clientWidth - 12);
    const L = V.layoutArvore(raiz, abertosArvore, livre);
    const A = V.ARVORE;
    // cabe no quadro: encolhe ate 80% para nao rolar; abaixo disso a letra fica miuda, e o quadro rola por dentro
    const escala = Math.min(1, Math.max(0.8, Math.min(livre / L.largura, (caixa.clientHeight - 4) / L.altura)));
    const svg = s("svg", { width: Math.floor(L.largura * escala), height: Math.floor(L.altura * escala),
      viewBox: `0 0 ${L.largura} ${L.altura}`, class: "arvore-svg", role: "group" });
    const linhas = s("g", { class: "arestas" });
    for (const e of L.arestas) {
      // cotovelo: desce do pe do pai ate o barramento, corre ate cima do filho e desce; o rotulo vai na descida do filho.
      // O barramento passa embaixo da linha inteira do pai (e.y2 - vaoY e o fundo dela), nao atras das vizinhas mais altas.
      const ym = e.y2 - A.vaoY + 16;
      const lado = Math.sign(e.x2 - e.x1);
      const raio = Math.min(8, Math.abs(e.x2 - e.x1) / 2, ym - e.y1, e.y2 - ym);
      const d = lado === 0 ? `M${e.x1},${e.y1} V${e.y2}`
        : `M${e.x1},${e.y1} V${ym - raio} Q${e.x1},${ym} ${e.x1 + lado * raio},${ym} H${e.x2 - lado * raio} Q${e.x2},${ym} ${e.x2},${ym + raio} V${e.y2}`;
      linhas.append(s("path", { class: `aresta-arvore${visiveisArvore.has(e.para) ? "" : " surgir"}`, d }));
      if (e.rotulo) {
        const largura = Math.max(26, e.rotulo.length * 6.5 + 12);
        linhas.append(s("g", { class: "rotulo-ramo", transform: `translate(${e.x2},${(ym + e.y2) / 2})` },
          s("rect", { x: -largura / 2, y: -8, width: largura, height: 16, rx: 8 }), s("text", { "text-anchor": "middle", y: 3.5 }, e.rotulo)));
      }
    }
    svg.append(linhas);
    let focar = null;
    for (const n of L.nos) {
      const no = n.no;
      const ids = n.prof > 0 ? (no.tarefas || []) : [];
      const total = (no.filhos || []).length;
      const dica = `${no.rotulo ? `${no.rotulo}: ` : ""}${no.texto} · ${n.prof === 0 ? "raiz" : ESTADO_ARVORE[no.estado] || no.estado || ""}`
        + (n.temFilhos && n.prof > 0 ? (n.aberto ? ". Clique para fechar." : `. Clique para abrir ${total} ${total === 1 ? "parte" : "partes"}.`) : "");
      const corpo = s("g", { class: "no-corpo" },
        n.decisao ? s("polygon", { class: "forma", points: `${n.w / 2},0 ${n.w},${n.h / 2} ${n.w / 2},${n.h} 0,${n.h / 2}` })
          : s("rect", { class: "forma", width: n.w, height: n.h, rx: n.prof === 0 ? 14 : 10 }));
      const topo = n.decisao ? n.h / 2 - ((n.linhas.length - 1) * A.linha) / 2 + 4 : A.pad + 11;
      corpo.append(s("text", { class: "texto-no", "text-anchor": "middle" }, n.linhas.map((l, k) => s("tspan", { x: n.w / 2, y: topo + k * A.linha }, l))));
      if (ids.length) {
        corpo.append(clicavel(s("text", { class: "id-no", "text-anchor": "middle", x: n.w / 2, y: n.h - 8, tabindex: "0", role: "link" },
          s("title", {}, `Abrir a gaveta de ${ids[0]}`), `${ids[0]}${ids.length > 1 ? ` +${ids.length - 1}` : ""} ↗`),
          ev => { if (ev) ev.stopPropagation(); abrirGaveta("tarefa", ids[0]); }));
      }
      if (n.temFilhos && n.prof > 0) {
        corpo.append(s("g", { class: "mais-no", transform: `translate(${n.decisao ? n.w / 2 : n.w - 13},${n.decisao ? n.h - 2 : 13})` },
          s("circle", { r: 9 }), s("text", { "text-anchor": "middle", y: 4 }, n.aberto ? "−" : String(total))));
      }
      const estadoCss = n.prof === 0 ? "raiz" : (no.estado || "nota");
      const g = s("g", { class: `no-dec ${estadoCss}${n.aberto && n.prof > 0 ? " aberto" : ""}${n.temFilhos ? " com-filhos" : ""}${visiveisArvore.has(n.chave) ? "" : " surgir"}`,
        transform: `translate(${n.x},${n.y})`, tabindex: "0", role: "button", "aria-label": dica,
        "aria-expanded": n.temFilhos && n.prof > 0 ? String(n.aberto) : null }, s("title", {}, dica), corpo);
      const acao = n.prof === 0 ? (alvoMapa.alvo === "tarefa" ? () => abrirGaveta("tarefa", alvoMapa.id) : null)
        : no.sessao ? () => abrirGaveta("sessao", no.sessao)
        : n.temFilhos ? () => alternarArvore(raiz, n.chave)
        : ids.length ? () => abrirGaveta("tarefa", ids[0]) : null;
      svg.append(acao ? clicavel(g, acao) : g);
      if (foco === n.chave) focar = g;
    }
    visiveisArvore = new Set(L.nos.map(n => n.chave));
    caixa.replaceChildren(svg);
    if (focar) {
      focar.focus({ preventScroll: true });
      focar.scrollIntoView({ block: "nearest", inline: "center", behavior: semMovimento() ? "auto" : "smooth" });
    }
  }
  function alternarArvore(raiz, chave) {
    abertosArvore = V.alternarNo(abertosArvore || V.abertosIniciais(raiz), chave);
    desenharArvore($("arvoreDecisao"), raiz, chave);
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
          linha("Contexto", `${ctx.rotulo} tokens: ${ZONA[ctx.cor]}`), linha("Máquina", V.ondeRoda(a) || "este notebook"), linha("Pasta", a.pasta + (a.branch ? ` (branch ${a.branch})` : "")),
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
          daTarefa ? h("button", { class: "botao pequeno secundario", type: "button", title: "As partes da tarefa, de cima para baixo, no Mapa",
            onclick: () => { fecharGaveta(); verHistoria(daTarefa); } }, "Ver a árvore da tarefa") : null)];
    }
    else if (tipo === "funcao") corpo = gavetaFuncao(d, id);
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
  // Governanca do mapa: a Verificadora, a Revisora e a Ronda rodam no ciclo e no codigo, sem sessao propria. A gaveta
  // diz o que cada uma faz e leva ao lugar onde ela age.
  function gavetaFuncao(d, id) {
    const n = (d.nos || []).find(x => x.id === id);
    if (!n) return null;
    const qual = id.replace(/^funcao:/, "");
    const vigia = (d.vigia && d.vigia.hoje) || null;
    const ronda = (d.rotinas || []).find(r => r.nome === "Copiloto - ronda");
    return [h("p", { class: "eyebrow" }, "governança"), h("h3", {}, n.nome), h("p", { class: `estado estado-${n.cor}` }, n.estado),
      h("dl", { class: "detalhes" }, linha("O que faz", FUNCAO[qual] || ""),
        linha("Na fila", qual === "verificadora" ? `${n.selo || 0} ${n.selo === 1 ? "entrega espera" : "entregas esperam"} aceite` : ""),
        linha("Hoje", qual === "ronda" && vigia ? vigia.texto : "")),
      h("div", { class: "acoes" },
        qual === "verificadora" ? h("button", { class: "botao pequeno", type: "button", onclick: () => { fecharGaveta(); irPara("entregas"); } }, "Ver as entregas") : null,
        qual === "ronda" && ronda ? h("button", { class: "botao pequeno secundario", type: "button", onclick: () => abrirGaveta("rotina", ronda.nome) }, "Ver a rotina da ronda") : null)];
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
        !/^T-/.test(t.id) || (ui.aba === "tarefas" && alvoMapa && alvoMapa.tipo === "arvore" && alvoMapa.alvo === "tarefa" && alvoMapa.id === id) ? null
          : h("button", { class: "botao pequeno secundario", type: "button", onclick: () => { fecharGaveta(); verHistoria(id); } }, "Ver a árvore da tarefa"),
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
    if (b.dataset.aba === "tarefas" && ui.aba !== "tarefas") animarBolhas = true;
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
  $("voltarMapa").addEventListener("click", voltarAoMapa);
  // o desenho segue o tamanho do quadro: redesenha quando a janela muda ou quando a aba Mapa aparece (escondida, mede 0)
  new ResizeObserver(() => {
    const quadro = $("mapa").parentElement;
    if (resposta && ui.aba === "tarefas" && `${quadro.clientWidth}x${quadro.clientHeight}` !== tamanhoDoMapa) renderMapa(resposta.dados);
  }).observe($("mapa").parentElement);
  document.addEventListener("keydown", e => {
    const digitando = /^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName || "");
    if (e.key === "/" && !digitando) { e.preventDefault(); $("busca").focus(); }
    else if (e.key === "Escape") {
      if (gaveta) fecharGaveta();
      else if (digitando) { $("busca").value = ""; ui.busca = ""; $("busca").blur(); renderizar(); }
      else if (alvoMapa && ui.aba === "tarefas") voltarAoMapa();
    } else if ((e.key === "r" || e.key === "R") && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) carregar(true);
  });
  setInterval(marcarVivo, 1000);

  // O Mapa do painel: a prioridade nova, as vistas (Padrao e + quem observa), o zoom e a tela cheia
  $("formPrioridade").addEventListener("submit", ev => {
    ev.preventDefault();
    const texto = $("novaPrioridade").value.trim();
    if (!texto) { $("novaPrioridade").focus(); return; }
    const botao = ev.submitter || null;
    mexerPrioridade({ acao: "adicionar", texto }, botao).finally(() => { if (botao) botao.disabled = false; });
  });
  document.querySelectorAll(".vistas-mapa button[data-vista]").forEach(b => b.addEventListener("click", () => {
    ui.vistaMapa = b.dataset.vista; salvarPreferencias(); if (resposta) renderMapaTimes(resposta.dados);
  }));
  document.querySelectorAll(".zoom button").forEach(b => b.addEventListener("click", () => {
    const z = b.dataset.zoom;
    if (z === "tela") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else $("quadroMapa").requestFullscreen().catch(() => toast("O navegador não deixou abrir em tela cheia."));
      return;
    }
    ui.zoom = z === "caber" ? 1 : Math.max(0.5, Math.min(3, (ui.zoom || 1) * (z === "mais" ? 1.25 : 0.8)));
    salvarPreferencias();
    if (resposta) renderMapaTimes(resposta.dados);
  }));
  $("verContas").addEventListener("click", () => irPara("saldos"));
  let tamanhoDoQuadro = "";  // redesenha o mapa dos times so quando o quadro muda de tamanho (ou aparece)
  new ResizeObserver(() => {
    const q = $("mapaRolagem");
    const agora = `${q.clientWidth}x${q.clientHeight}`;
    if (agora === tamanhoDoQuadro) return;
    tamanhoDoQuadro = agora;
    if (resposta && ui.aba === "mapa") renderMapaTimes(resposta.dados);
  }).observe($("mapaRolagem"));

  mostrarAba();
  mostrarCarregando();
  carregarAgenda().then(renderizar);
  carregar(false);
})();
