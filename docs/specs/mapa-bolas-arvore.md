---
demanda: mapa-bolas-arvore
status: proposto
data: 2026-11-03
---

# Mapa de bolas, com a árvore de decisão da tarefa no clique

## Pedido original

> "não gostei que tirou o mapa, queria que tivesse e quando eu clicasse me desse grafos como uma árvore de decisão mas
> com as task se quebrando em partes para começar faça isso com a tarefa jornada da implantação que estou fazendo quero
> ver" (03/11)

## Dor real

- Em 02/11 ([mapa-arvore](mapa-arvore.md), agenda #24), o Mapa de bolas virou uma lista em árvore: projeto → tarefa →
  história → sessões. O pedido de 02/11 ("de cima para baixo na tela e ir se abrindo expandindo") era para o grafo que
  abre no clique, não para o Mapa. As bolas sumiram.
- A tarefa mostra só o que já aconteceu (a história). Não mostra em que partes ela se quebra, o que falta em cada parte,
  nem a condição que decide o resultado.
- A Jornada da Implantação tem 10 tarefas e 6 pedidos. O estado de cada pedido ("fecha até sexta se as edges saírem até
  quarta") existe só no texto do Registro da T-20261103-03.

## O que muda

1. **O Mapa volta a ser de bolas**, como em 30/10:
   - cada bola é uma tarefa;
   - as bolas ficam em cacho por projeto, com o nome do projeto em cima.
2. **O clique abre a árvore** no lugar das bolas, de cima para baixo:
   - o clique na bola abre a árvore da tarefa, e o clique no nome do projeto abre a árvore do projeto;
   - a raiz é a tarefa ou o projeto, e as partes ficam embaixo;
   - a parte que tem filhos abre e fecha no clique ou no Enter, e o ramo cresce para baixo;
   - fica aberta uma parte por nível: abrir uma parte fecha a vizinha, e a árvore mostra o caminho seguido;
   - cada nível é uma linha embaixo da parte aberta. A linha que passaria da borda do quadro encosta nela, e as
     linhas saem em cotovelo;
   - a decisão é um losango, com um ramo por resultado, e o rótulo do ramo ("sim", "não") vai na linha;
   - a cor diz o estado: feito, andando, falta, espera alguém de fora, precisa de você ou descartado;
   - a parte que cita uma tarefa (`T-AAAAMMDD-NN`) traz o id embaixo, e o clique no id abre a gaveta dela;
   - em cima ficam "← Mapa", o caminho e as sessões vivas da tarefa (o clique abre a conversa na gaveta);
   - Esc volta às bolas.
3. **As partes vêm da seção `## Partes` da nota.**
   - Na tarefa, é a nota da tarefa.
   - No projeto, é a nota `Seazone/Temas/Projeto - <nome>.md`.
   - É uma lista com recuo, que se edita no Obsidian:

   ```markdown
   ## Partes
   - [/] 1. Termo novo · vistoria-pro#501, #503, #506
     - [x] PRs prontos, com o CI verde
     - [?] Teste no stg até qua 04/11?
       - [ ] sim: fecha até sex 06/11
       - [ ] não: vai para a semana de 09/11
   ```

   | Caixa | Estado |
   |---|---|
   | `[x]` | feito |
   | `[/]` | andando |
   | `[ ]` | falta |
   | `[>]` | espera alguém de fora |
   | `[!]` | precisa de você |
   | `[-]` | descartado |
   | `[?]` | decisão: os filhos são os ramos, e o texto antes do primeiro `:` é o rótulo do ramo |

   Item sem caixa é nota, sem estado.
4. **Quando a nota não tem `## Partes`:**
   - a história da tarefa vira as partes dela, lado a lado: o pedido, "Feito · N passos" (com os últimos passos
     dentro), o Agora e o "Pronto quando";
   - o projeto mostra as tarefas dele, com as abertas primeiro e as feitas como feito, e cada tarefa abre nas partes dela;
   - a pasta "Sem tarefa" mostra as sessões dela.
5. **A Jornada da Implantação já sai quebrada:** a nota `Projeto - Jornada da Implantação`, com os 6 pedidos em
   partes, montada a partir do Registro da T-20261103-03 de 03/11, às 14:43.
6. **O que sai:** a lista em árvore do #24 e a história dela. As sessões continuam na gaveta e na árvore. "Ver a
   história da tarefa", na gaveta, abre a árvore da tarefa.

## Critérios de aceite

- [ ] O Mapa mostra as bolas em cacho por projeto, com o nome do projeto em cima.
- [ ] O clique na bola abre a árvore da tarefa, e o clique no nome do projeto abre a árvore do projeto.
- [ ] A árvore cresce de cima para baixo, e o clique numa parte com filhos abre e fecha os filhos.
- [ ] Abrir uma parte fecha a vizinha aberta, e o que está em cima não sai do lugar.
- [ ] A decisão aparece em losango, com o rótulo do ramo na linha.
- [ ] A cor de cada parte segue a caixa da nota.
- [ ] O id de tarefa numa parte abre a gaveta dela.
- [ ] A Jornada da Implantação abre nos 6 pedidos.
- [ ] Em 1536×730 a página não rola. A árvore começa no topo do quadro, com a letra entre 80% e 100% do tamanho, e só
  rola por dentro do quadro quando nem assim cabe.
- [ ] "Ver a história da tarefa", na gaveta, abre a árvore da tarefa.
- [ ] Esc e "← Mapa" voltam às bolas. A releitura de 30 s não fecha a árvore.

## Fora do escopo

- Gerar as partes de cada tarefa sozinho. Por enquanto, quem escreve as partes é quem trabalha na tarefa; manter as partes
  ao registrar fica para depois.
- Editar a árvore pela tela.

## Plano

Cada passo começa pelo teste.

1. **Copiloto (ADR 030).** `copiloto/partes.py` lê a seção `## Partes`. A CLI ganha `tarefa arvore <id>` e
   `projeto arvore <nome>`. Na tarefa sem partes, a árvore vem da história; no projeto sem nota, vem das tarefas dele.
2. **Agenda, `cockpit-view.js`.**
   - Voltam as funções das bolas: `raioDaTarefa`, `empacotar`, `layoutBolhas` e `textoNaBola`.
   - Entram `layoutArvore(raiz, abertos)`, para as caixas, os losangos e as linhas de cima para baixo, e
     `alternarNo(abertos, chave)`.
   - Saem `arvoreDoMapa` e as funções de abrir e fechar a lista em árvore.
3. **Agenda, servidor.** Entram as rotas `/api/tarefas/<id>/arvore` e `/api/projetos/<nome>/arvore`. O nome do projeto
   passa por um formato e o id passa pelo de sempre.
4. **Agenda, `cockpit.js`, `cockpit.html` e `cockpit.css`.** As bolas voltam, a árvore abre no clique, e entram o
   teclado e a legenda.
5. **Nota da Jornada**, no vault.
6. **Conferência** na 8899, em 1536×730, com o headless, em três estados: as bolas, a Jornada aberta e um pedido aberto.

## O que a conferência de 03/11 mudou

A primeira conferência passou nos cliques, mas a tela não servia:
- **A regra das bolas esticava a árvore.** A regra `.mapa-caixa svg` também pegava a árvore e a esticava no quadro.
  Assim, a árvore pequena ficava no meio, com um vão em cima. Com o pedido 1 e o 6 abertos, a letra ficava miúda.
- **A largura somava as subárvores.** Cada parte reservava a largura da subárvore dela.
- **A história descia demais.** Era uma corrente de 9 níveis.

O que entrou:
- a regra das bolas vale só para `#mapa`;
- uma parte aberta por nível;
- a linha que passaria da borda encosta nela;
- as linhas em cotovelo;
- a escala entre 80% e 100%, encostada no topo;
- a história em partes (ADR 030, no Copiloto).
