---
demanda: mapa-arvore
status: implementado
data: 2026-11-02
---

# Mapa em árvore: de cima para baixo, abrindo ao clicar

> Em 03/11, as bolas voltaram e a árvore passou a abrir no clique, como árvore de decisão da tarefa
> ([mapa-bolas-arvore](mapa-bolas-arvore.md)). A lista em árvore desta spec saiu.

## Pedido original

> "melhore os grafos de tarefas e como eu visualizo eles quero que seja de cima para baixo na tela e ir se abrindo
> expandindo" (02/11)

## Dor real

- O Mapa de 30/10 espalha as tarefas como bolas na largura da tela.
- Há três jeitos de ler a mesma coisa:
  - as bolas;
  - a história, que abre no lugar das bolas em cartões da esquerda para a direita;
  - o grafo de sessões, que é outra tela, também da esquerda para a direita.
- Para ir de um projeto até a sessão que trabalha numa tarefa, é preciso trocar de tela duas vezes.
- Em 02/11 o cockpit tinha 8 projetos e 22 tarefas abertas.

## O que muda

1. **O Mapa vira uma árvore, de cima para baixo.**
   - **Projetos.** Um por linha, na ordem de urgência que o Copiloto manda. A linha mostra:
     - a cor;
     - o nome;
     - as tarefas abertas;
     - quantas precisam de você;
     - uma bolinha por tarefa, com a cor dela.
   - **Tarefas.** O clique (ou Enter) no projeto abre as tarefas embaixo dele, uma por linha, ligadas por uma linha vertical. Cada tarefa mostra a cor, o id, o título, o estado, os passos e as sessões vivas.
     - Quando a tarefa é com ele, um selo diz "precisa de você" ou "travada".
     - O estado ao lado só aparece quando diz mais que o selo: "espera você" ao lado de "precisa de você" seria o mesmo recado.
   - **História.** O clique na tarefa abre a história embaixo dela, de cima para baixo:
     - o pedido;
     - os 3 últimos passos, com "+N anteriores" para abrir mais 6 acima;
     - **Agora**, com Responder, Revisar e Excluir;
     - a meta.
   - **Sessões.** Vêm depois da história. A seta da sessão abre as subsessões, e o clique no nome abre a conversa, como antes.
   - **Sem tarefa.** A pasta "Sem tarefa" abre direto nas sessões dela.
2. **Abre e fecha com movimento.**
   - O ramo cresce para baixo ao abrir e encolhe ao fechar.
   - Fica aberto um projeto, uma tarefa e uma sessão por vez: abrir outro fecha o anterior, para caber em 1536×730.
   - A árvore rola por dentro do quadro e traz para a vista o que abriu.
   - A tarefa que abre sobe para o topo do quadro quando a história chega. Em 1536×730 cabem o pedido, os 3 passos, o Agora e a meta.
3. **Teclado.**
   - ↑ e ↓ andam entre as linhas.
   - → abre o ramo, ou desce para o primeiro filho.
   - ← fecha o ramo, ou sobe para o pai.
   - Enter abre e fecha.
   - Esc fecha o que abriu por último.
4. **Busca e semáforo.** A busca (`/`) e o filtro de cor escondem as tarefas que não batem. Com busca, os projetos que têm tarefa achada já vêm abertos.
5. **O que fica igual:**
   - a gaveta: passo inteiro, conversa, Responder, Revisar e Excluir;
   - a leitura da história no clique (`/api/tarefas/<id>/historia`);
   - a releitura de 30 s, que mantém aberto o que está aberto.
6. **O que sai:** as bolas, o grafo de sessões da esquerda para a direita e a história em cartões.

## Critérios de aceite

- [x] O Mapa mostra os projetos de cima para baixo.
- [x] O clique no projeto abre as tarefas embaixo dele.
- [x] O clique na tarefa abre, embaixo dela, a história de cima para baixo e as sessões.
- [x] Abrir e fechar têm movimento, e o `prefers-reduced-motion` tira o movimento.
- [x] Fica aberto um projeto, uma tarefa e uma sessão por vez, e a releitura de 30 s não fecha nada.
- [x] "Ver a história da tarefa", na gaveta, abre o Mapa com o projeto e a tarefa abertos.
- [x] O teclado funciona: ↑ ↓ → ← Enter Esc.
- [x] Em 1536×730 a página não rola; a árvore rola por dentro do quadro.

## Fora do escopo

- Mais de um projeto aberto ao mesmo tempo, fora da busca.
- Mudar o que o Copiloto manda: o `cockpit --json` e o `tarefa historia` ficam como estão.

## Plano

Cada passo vem com o teste antes.

1. **`cockpit-view.js`.**
   - `arvoreDoMapa(trabalho, {busca, cor})`: projetos e tarefas visíveis, contagens, rótulo do estado, selo e o que a busca abre.
   - `alternarNoMapa`, `fecharNoMapa` e `abrirNoMapa`: um projeto, uma tarefa e uma sessão por vez.
   - Saem `raioDaTarefa`, `layoutBolhas`, `textoNaBola` e `grafoDoItem`, junto com os testes delas.
2. **`cockpit.js`.**
   - `renderMapa` passa a desenhar a árvore, no lugar das bolas, do grafo e dos cartões da história.
   - Abrir e fechar trocam só a classe, para o movimento correr nos dois sentidos.
   - Entram o teclado e o Esc.
   - `verHistoria` passa a abrir a árvore.
3. **`cockpit.html` e `cockpit.css`.** O quadro da árvore, as linhas, o movimento de abrir e a linha do tempo da história.
4. **Conferência.** Na 8899, em 1536×730, com o headless, em três estados: tudo fechado, projeto aberto e tarefa aberta.
