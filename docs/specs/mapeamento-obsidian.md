---
demanda: mapeamento-obsidian
status: aprovado
data: 2026-10-21
aprovado-por: Gabriel, 2026-10-21
---

# Mapeamento do computador pro Obsidian + checklist do app de agenda

## Pedido original

> "quero que acesse meus projetos do claude aqui do computador e mapeie tudo de uma
> forma eficiente e organizada no obsidian e quando atualizar uma informação não deixar
> a antiga errada lá para não criar confusões" — e que o app de agenda consulte essa
> base (onde estou em cada projeto, o que tenho que fazer, o que já fiz, onde está tal
> coisa, logs do que foi feito em cada dia) em vez de eu ter que atualizá-lo sempre.

## Dor real

- **Quem sofre**: o Gabriel, tocando muitos projetos em paralelo (pessoais, faculdade, Seazone).
- Perde o fio de onde parou em cada projeto; para retomar, precisa reabrir sessões antigas.
- O app de agenda seria útil, mas fica parado porque depende de cadastrar tarefa na mão.
- O que ele quer não é só um registro: é ser **dirigido** — abrir o app e saber a próxima
  coisa a fazer, já pequena, já com o contexto.

## Como é hoje

- **App de agenda** (este repo): página local + `server.js`; guarda tarefas, compromissos,
  rotinas, metas e relatos em `agenda-data.json`/navegador; entrada por texto, áudio e
  Telegram, interpretada pelo Ollama. Não lê nenhuma fonte externa; toda tarefa é digitada.
- **Vault do Obsidian** (`C:\Users\gabri\Documents\Obsidian Vault`): 125 notas — 19 soltas
  na raiz (notas curtas de abril/2026) e 106 da Seazone, geradas por `.scripts/seanotes_sync.py`
  a partir do SeaNotes. Esse script já usa a regra "só o trecho entre `<!-- auto:X -->` e
  `<!-- /auto:X -->` é regenerado; edição manual e `[x]` são preservados".
- **Fontes do que foi feito**: 38 sessões do app desktop, ~50 históricos de sessões do
  terminal (`~/.claude/projects`), `~/.claude/history.jsonl`, repositórios git em `C:\Dev`.
  A sessão da Seazone sozinha tem 163 MB, e transcrições podem conter tokens e senhas.
- **VM** (`vm-gabriel.lifeshub.com.br`): o acesso por SSH desta sessão foi bloqueado.

## Produto-alvo

Uma vez por dia, o trabalho real do computador vira (1) um vault do Obsidian que sempre
diz a verdade sobre cada projeto e (2) um checklist no app de agenda que diz o que fazer
agora, em tarefas pequenas, com contexto, sem o Gabriel cadastrar nada à mão.

Decisões fechadas na conversa:

1. **Uso principal**: retomar projetos e acompanhar metas. O app ordena um checklist e
   direciona pro que fazer; cada item é uma tarefa pequena com um resumo curto do contexto;
   tarefas agrupadas por projeto, projetos por área.
2. **Origem das tarefas**: extraídas das sessões (pendências e próximos passos). Entram no
   checklist como **sugeridas**; um clique confirma ou descarta, e a descartada não volta.
3. **Ordem do checklist**: prazo mais perto (da agenda) → prioridade da meta/projeto
   (definida uma vez pelo Gabriel) → parado há mais tempo.
4. **Frequência**: uma rodada por dia consolida o que foi feito.
5. **Escopo**: todos os projetos, separados por área — pessoais, faculdade e Seazone. A
   Seazone liga no hub que já existe no vault. Sessões soltas (perguntas avulsas) entram
   só no log do dia, sem virar projeto.
6. **Informação velha**: a nota de cada projeto mostra só o estado atual, reescrito a cada
   rodada. O que mudou fica registrado com data no log do dia ("decisão X trocada por Y",
   "tarefa Z concluída"). Nada velho aparece como atual.
7. **Onde as tarefas moram**: no **app de agenda** (é onde se marca feito). O Obsidian guarda
   estado, histórico e "onde está cada coisa" de cada projeto, mas não a lista de tarefas.

Proposta de organização do vault (a confirmar no gate):

- `Projetos/<Área>/<Projeto>.md` — por projeto: o que é, estado atual, próximos passos em
  texto, onde está cada coisa (pasta, repositório, branch, PR, arquivos de saída), sessões
  relacionadas. Trechos automáticos entre marcadores `auto`; o que o Gabriel escrever fora
  deles nunca é tocado (mesma regra do `seanotes_sync.py`).
- `Diário/AAAA-MM-DD.md` — o que foi feito no dia, por projeto, e o que mudou.
- Uma nota índice com todos os projetos, área, último dia mexido e status.
- As 19 notas soltas e a pasta `Seazone/` ficam como estão; os projetos ligam nelas quando
  fizer sentido.

Caminho feliz:

- Como Gabriel, abro o app de manhã e vejo o checklist ordenado, agrupado por projeto.
- Cada tarefa tem 2–3 linhas de contexto: onde parei, por quê, onde estão os arquivos.
- Confirmo ou descarto as sugeridas com um clique; marco feito quando termino.
- Quando quero entender um projeto, abro a nota dele no Obsidian e vejo o estado atual
  correto e onde está cada coisa; o histórico do que mudou está nos logs diários.
- Trabalho normalmente nas sessões do Claude; no dia seguinte, tudo isso já está refletido
  sem eu ter feito nada.

## Métricas de sucesso

- **Zero tarefa manual**: quantas tarefas o Gabriel cadastra à mão por semana.
  Baseline: hoje toda tarefa é manual. Meta: a definir após a primeira semana de uso.
- **Uso diário**: dias por semana em que o checklist é aberto. Baseline desconhecido (o app
  está parado); medir é parte da entrega — o app passa a registrar quando é aberto.
- **Sugestões boas**: tarefas sugeridas confirmadas ÷ (confirmadas + descartadas).
  Baseline inexistente; medir é parte da entrega — o app conta cada clique.

## Fora de escopo

- VM (`vm-gabriel`): segunda etapa, depende de resolver o acesso.
- Esteira Seazone e TaskDex: projeto pessoal.
- Google Calendar, WhatsApp e demais integrações já planejadas no README do app.
- Copiar transcrições brutas pro vault: só resumos; nada de tokens, senhas ou saídas longas.

## Pendências

- Metas numéricas das três métricas: definir depois da primeira semana de medição.
- Horário da rodada diária e o que acontece se o computador estiver desligado nesse horário.
- Como um projeto se liga a uma meta de longo prazo (quem faz a ligação e quando).
- Como reconhecer que uma tarefa sugerida já foi feita numa sessão posterior e fechá-la sozinha.
- Qual IA resume as sessões (a do app, o Ollama, ou o próprio Claude) — decisão do plano técnico.
- Primeira carga: o histórico inteiro (setembro e outubro) é processado de uma vez na primeira rodada.

## Referências

- `README.md` deste repo — o que o app já faz.
- `C:\Users\gabri\Documents\Obsidian Vault\.scripts\seanotes_sync.py` — padrão de blocos `auto`.
- `C:\Users\gabri\Documents\Obsidian Vault\Seazone.md` — hub Seazone existente.
