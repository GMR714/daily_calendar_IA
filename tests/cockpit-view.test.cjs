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

test("fala do Claude sem markdown cru", () => {
  assert.equal(V.semMarkdown("**O que deu errado:** use `npm test` e veja [o PR #5](https://github.com/x/pull/5). # Fim"),
    "O que deu errado: use npm test e veja o PR #5. # Fim");
  assert.equal(V.semMarkdown("## Resumo\n- item __um__"), "Resumo - item um");
  assert.equal(V.semMarkdown("feito. ## Proximo passo rodar"), "feito. Proximo passo rodar", "titulo que ficou no meio da linha");
  assert.equal(V.semMarkdown("edite o `__main__.py` e o `**kwargs`"), "edite o __main__.py e o **kwargs", "dentro da crase fica como esta");
  assert.equal(V.semMarkdown(null), "");
});

test("dados legiveis: limpa as falas de agentes, Hoje e fila Voce sem mexer no original", () => {
  const dados = {
    agentes: [{ id: "a", nome: "A", agora: "**Pronto:** veja `x`", pedido: "## Faça", ultimo_pedido: "[aqui](http://y)", contexto: 10 }],
    hoje: [{ titulo: "`t`", pedido: "**p**", agora: "a ## B", pasta: "C:\\x" }],
    voce: { total: 1, itens: [{ id: "R-01", titulo: "**T**", texto: "use `npm`", tipo: "dar ok" }] },
    rotinas: [{ nome: "R", texto: "rodou" }]
  };
  const l = V.legivel(dados);
  assert.deepEqual(l.agentes, [{ id: "a", nome: "A", agora: "Pronto: veja x", pedido: "Faça", ultimo_pedido: "aqui", contexto: 10 }]);
  assert.deepEqual(l.hoje, [{ titulo: "t", pedido: "p", agora: "a B", pasta: "C:\\x" }]);
  assert.deepEqual(l.voce, { total: 1, itens: [{ id: "R-01", titulo: "T", texto: "use npm", tipo: "dar ok" }] });
  assert.equal(l.rotinas, dados.rotinas);
  assert.equal(dados.agentes[0].agora, "**Pronto:** veja `x`");
  assert.deepEqual(V.legivel({ placar: 1 }), { placar: 1 });
  assert.equal(V.legivel(null), null);
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

test("fila Voce: rascunho aprova, ajusta ou descarta; tarefa responde; o que ja foi respondido espera o ciclo", () => {
  assert.deepEqual(V.acoesDoItem({ tipo: "dar ok", id: "R-07" }), ["aprovar", "ajuste", "descartar"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "decidir", id: "T-20261029-03" }), ["responder"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "travada", id: "T-20261027-01" }), ["responder"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "aguardando terceiros", id: "T-20261027-02" }), ["responder"]);
  assert.deepEqual(V.acoesDoItem({ tipo: "dar ok", id: "R-07", resposta: { acao: "aprovar", origem: "tela" } }), []);
  assert.deepEqual(V.acoesDoItem(null), []);
});

test("fila Voce: rotulo da resposta que espera o ciclo", () => {
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "tela" } }), "Aprovado na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "aprovar", origem: "dm" } }), "Aprovado na DM · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "descartar", origem: "tela" } }), "Descartado na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "dar ok", resposta: { acao: "responder", origem: "tela" } }), "Ajuste pedido na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "decidir", resposta: { acao: "responder", origem: "tela" } }), "Respondido na tela · espera o ciclo");
  assert.equal(V.rotuloDaResposta({ tipo: "decidir" }), "");
});

test("fila Voce: so link do Obsidian vira link clicavel na gaveta", () => {
  const ok = "obsidian://open?vault=Obsidian%20Vault&file=Seazone%2FTarefas%2FT-20261023-05.md";
  assert.equal(V.linkObsidian({ obsidian: ok }), ok);
  assert.equal(V.linkObsidian({ obsidian: "javascript:alert(1)" }), "");
  assert.equal(V.linkObsidian({ obsidian: "https://site.example" }), "");
  assert.equal(V.linkObsidian({}), "");
});

// ------------------------------------------------------------------ Mapa de trabalho (29/10)
const tarefa = (id, cor = "atencao", sessoes = [], extra = {}) => ({ id, titulo: `tarefa ${id}`, status: "aguardando-voce", cor, aberta: true, pasta: false, sessoes, obsidian: "", ...extra });
const subs = (total, n = Math.min(total, 8)) => ({ total, ativas: 0, itens: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, descricao: `passo ${i}`, tipo: "general-purpose", cor: "sem_sinal", estado: "terminou" })) });
const sessaoFalsa = (sid, nome, sub = subs(0)) => ({ id: sid.slice(0, 8), sessao: sid, nome, cor: "atencao", estado: "esperando você", tipo: "em segundo plano", viva: false, subsessoes: sub });
const TRABALHO = {
  projetos: [
    { nome: "setup-com-prova", cor: "problema", abertas: 12, vivas: 0, sessoes: 1,
      tarefas: Array.from({ length: 12 }, (_, i) => tarefa(`T-202610${String(i + 10)}-01`, i ? "problema" : "atencao", i ? [] : ["s1"])) },
    { nome: "copiloto", cor: "atencao", abertas: 2, vivas: 0, sessoes: 0, tarefas: [tarefa("T-20261023-11"), tarefa("T-20261026-03")] },
    { nome: "Sem tarefa", cor: "bem", abertas: 0, vivas: 1, sessoes: 2,
      tarefas: [tarefa("pasta:gabri", "bem", ["s2", "s3"], { titulo: "gabri", status: "", pasta: true })] },
  ],
  sessoes: { s1: sessaoFalsa("s1", "Desafio do Marios", subs(12)), s2: sessaoFalsa("s2", "transcricao"), s3: sessaoFalsa("s3", "tasks jornada", subs(2)) },
};
const dentro = (p, c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test("mapa de trabalho: cada projeto na sua celula, as tarefas em volta e tudo dentro da area", () => {
  const caixa = { x: 30, y: 50, w: 700, h: 430 };
  const { celulas } = V.layoutTrabalho(TRABALHO.projetos, caixa);
  assert.deepEqual(celulas.map(c => c.nome), ["setup-com-prova", "copiloto", "Sem tarefa"]);
  for (const c of celulas) {
    assert.ok(dentro(c, caixa), c.nome);
    assert.ok(c.rotuloY <= caixa.y + caixa.h, `rotulo de ${c.nome} fora da area`);
    for (const t of c.tarefas) {
      assert.ok(dentro({ x: t.x - t.r, y: t.y - t.r }, caixa) && dentro({ x: t.x + t.r, y: t.y + t.r }, caixa), t.id);
      assert.ok(dist(c, t) >= c.r + t.r + 2, `${t.id} encosta no projeto`);
      for (const outra of celulas) if (outra !== c) assert.ok(dist(c, t) < dist(outra, t), `${t.id} mais perto de ${outra.nome}`);
    }
  }
});

test("mapa de trabalho: mais de 10 tarefas mostra 9 e '+3'; sem projetos, sem celulas", () => {
  const c = V.layoutTrabalho(TRABALHO.projetos, { x: 0, y: 0, w: 700, h: 430 }).celulas[0];
  assert.equal(c.tarefas.length, 9);
  assert.equal(c.mais.n, 3);
  assert.equal(V.layoutTrabalho(TRABALHO.projetos, { x: 0, y: 0, w: 700, h: 430 }).celulas[1].mais, null);
  assert.deepEqual(V.layoutTrabalho([], { x: 0, y: 0, w: 700, h: 430 }), { celulas: [] });
});

function conferirGrafo(g, caixa) {
  const chaves = new Set(g.nos.map(n => n.chave));
  assert.equal(chaves.size, g.nos.length, "chave repetida");
  for (const a of g.arestas) assert.ok(chaves.has(a.de) && chaves.has(a.para), `${a.de} -> ${a.para}`);
  for (const n of g.nos) assert.ok(n.x - n.r >= 0 && n.x + n.r <= caixa.w && n.y - n.r >= 0 && n.y + n.r <= caixa.h, n.chave);
  const colunas = {};
  for (const n of g.nos) (colunas[n.x] ||= []).push(n);
  for (const col of Object.values(colunas)) {
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) assert.ok(col[i].y - col[i - 1].y >= col[i].r + col[i - 1].r, `${col[i - 1].chave} encosta em ${col[i].chave}`);
  }
}

test("grafo do projeto: tarefas, sessoes e ate 3 subsessoes por sessao, com '+N' no resto", () => {
  const caixa = { w: 1100, h: 660 };
  const g = V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "setup-com-prova" }, caixa);
  conferirGrafo(g, caixa);
  assert.equal(g.titulo, "setup-com-prova");
  const tipos = g.nos.reduce((m, n) => ({ ...m, [n.tipo]: (m[n.tipo] || 0) + 1 }), {});
  assert.deepEqual(tipos, { projeto: 1, tarefa: 12, sessao: 1, sub: 3, mais: 1 });
  assert.ok(g.arestas.some(a => a.de === "tarefa:T-20261010-01" && a.para === "sessao:s1"));
  assert.equal(g.nos.find(n => n.tipo === "mais").rotulo, "+9 subsessões");
  assert.equal(g.nos.find(n => n.tipo === "sub").sessao, "s1");
});

test("grafo da tarefa: as sessoes dela e ate 8 subsessoes; 'Sem tarefa' mostra as pastas", () => {
  const caixa = { w: 1100, h: 660 };
  const g = V.grafoDoItem(TRABALHO, { tipo: "tarefa", id: "T-20261010-01" }, caixa);
  conferirGrafo(g, caixa);
  assert.equal(g.nos.filter(n => n.tipo === "sub").length, 8);
  assert.equal(g.nos.find(n => n.tipo === "mais").rotulo, "+4 subsessões");
  const sem = V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "Sem tarefa" }, caixa);
  conferirGrafo(sem, caixa);
  assert.deepEqual(sem.nos.filter(n => n.tipo === "pasta").map(n => n.rotulo), ["Sem tarefa · gabri"]);
  assert.deepEqual(sem.nos.filter(n => n.tipo === "sessao").map(n => n.rotulo).sort(), ["tasks jornada", "transcricao"]);
});

test("grafo: alvo que nao existe (ou sem dados) nao desenha nada", () => {
  assert.equal(V.grafoDoItem(TRABALHO, { tipo: "projeto", id: "nao existe" }), null);
  assert.equal(V.grafoDoItem(TRABALHO, { tipo: "tarefa", id: "T-1" }), null);
  assert.equal(V.grafoDoItem(null, { tipo: "projeto", id: "copiloto" }), null);
});

test("conversa: ferramentas seguidas viram um item so; o resto fica como esta", () => {
  const f = (quem, texto) => ({ quem, texto, hora: "29/10 17:00" });
  const g = V.agruparFalas([f("voce", "Revise"), f("claude", "Vou ler."), f("ferramenta", "Bash: a"), f("ferramenta", "Read: b"),
    f("ferramenta", "Grep: c"), f("claude", "Pronto."), f("ferramenta", "Bash: d")]);
  assert.deepEqual(g.map(x => [x.quem, x.texto]), [["voce", "Revise"], ["claude", "Vou ler."], ["ferramentas", "3 ferramentas"],
    ["claude", "Pronto."], ["ferramenta", "Bash: d"]]);
  assert.deepEqual(g[2].itens.map(x => x.texto), ["Bash: a", "Read: b", "Grep: c"]);
  assert.deepEqual(V.agruparFalas([]), []);
});

test("conversa: negrito, codigo, titulo e link http viram trechos; outro esquema fica como texto", () => {
  assert.deepEqual(V.trechosDaFala("## Onde estão\nVeja **isto** e `cli.py` em [mensagem](https://x.example/a?b=1) ou https://y.example/c."), [
    { tipo: "negrito", texto: "Onde estão" }, { tipo: "texto", texto: "\nVeja " }, { tipo: "negrito", texto: "isto" }, { tipo: "texto", texto: " e " },
    { tipo: "codigo", texto: "cli.py" }, { tipo: "texto", texto: " em " }, { tipo: "link", texto: "mensagem", href: "https://x.example/a?b=1" },
    { tipo: "texto", texto: " ou " }, { tipo: "link", texto: "https://y.example/c", href: "https://y.example/c" }, { tipo: "texto", texto: "." }]);
  assert.deepEqual(V.trechosDaFala("[x](javascript:alert(1))"), [{ tipo: "texto", texto: "[x](javascript:alert(1))" }]);
  assert.deepEqual(V.trechosDaFala(""), []);
});

test("sessao: terminal nao responde pela tela; trabalhando manda quando parar; viva pode parar", () => {
  assert.deepEqual(V.acoesDaSessao({ tipo: "interativa", estado: "parada", viva: true }),
    { pode: false, motivo: "Aberta num terminal: responda por lá.", enviar: "", parar: false, fila: 0 });
  assert.deepEqual(V.acoesDaSessao({ tipo: "em segundo plano", estado: "trabalhando", viva: true, na_fila: 2 }),
    { pode: true, motivo: "", enviar: "Mandar quando parar", parar: true, fila: 2 });
  assert.deepEqual(V.acoesDaSessao({ tipo: "em segundo plano", estado: "esperando você: R-77", viva: false }),
    { pode: true, motivo: "", enviar: "Enviar", parar: false, fila: 0 });
  assert.equal(V.acoesDaSessao(null).pode, false);
});
