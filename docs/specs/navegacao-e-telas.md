---
demanda: navegacao-e-telas
status: proposto
data: 2026-10-29
---

# Navegação única e telas que cabem na tela

## Pedido original

> "o frontend esta inusavel esta feio e infuncional em todos os aspectos eu nao consigo navegar entre as
> telas e funcionalidades meu calendario aparece pequeno e cade minha função de ficar no cantinho da tela
> que eu fiz fora que o painel de controle la nao esta bem organizado e responsivo as coisas tem que caber
> na tela para eu poder ver e nao fazer coisas feias gigantes e infinitas tem que ser pratico" (29/10)

## Dor real

Medido em 29/10 na tela dele: 1536×864 com escala de 125%, o que dá cerca de 1536×730 úteis no Chrome. O segundo monitor é 2560×1080.

- **Agenda:**
  - A primeira tela mostra só o checklist (3 projetos, cada um com o seu formulário).
  - O calendário começa depois de rolar e tem ~1000 px, porque a hora tem 78 px fixos.
  - A caixa "O que vamos organizar?" fica presa no rodapé e cobre ~150 px.
- **Navegação:** não há menu.
  - Metas, tarefas, histórico e ajustes ficam dentro do modal "Meus planos".
  - O link do Cockpit ficou num bloco que o CSS esconde (`.sidebar > div:first-child`).
  - Nada leva ao painel flutuante (`iniciar-painel.cmd`), então parece que ele sumiu.
- **Cockpit:**
  - A primeira tela gasta tudo com os cartões de números e com o "O que olhar agora".
  - As três colunas começam no rodapé, e a página tem ~2000 px de cartões longos.

## O que muda

1. **Menu lateral fixo, o mesmo em todas as telas:**
   - Agenda, Checklist e Cockpit;
   - Cantinho, que abre o painel flutuante;
   - Metas e Ajustes, que abrem o "Meus planos";
   - o estado da sincronização.
2. **Cada tela ocupa a janela:** só as listas internas rolam, nunca a página.
3. **Agenda:**
   - O calendário enche a área, e a escala da hora vem da altura disponível. O dia inteiro aparece sem rolar, com mínimo de 34 px por hora; abaixo disso, a rolagem fica dentro do calendário.
   - Filtros e pendências viram botões na barra do calendário.
   - A caixa de mensagem vira uma barra de uma linha, que cresce ao focar.
   - A proposta da IA abre por cima, sem empurrar o calendário.
4. **Checklist:** tela própria, com rolagem interna.
5. **Cockpit:**
   - O status fica numa linha de chips, que continuam filtrando.
   - Agentes, Você e Rotinas ficam em três colunas com rolagem interna, cada linha com uma ou duas linhas de texto, e o detalhe completo fica na gaveta.
   - Sai o bloco "O que olhar agora": o que precisa de você já fica no topo de cada coluna.
   - Em tela estreita, as colunas viram abas.
6. **Cantinho:** o botão chama `POST /api/overlay/abrir`, que abre o `iniciar-painel.cmd` (só no Windows).

## Fora, por enquanto

- Mudar o painel flutuante (`overlay.ps1`).
- Mudar o conteúdo do checklist. Muda só o lugar dele e a rolagem.
- Comandar o copiloto pela tela. Isso depende da proposta de unificação e de proteger a API contra pedidos de outros sites (CSRF).

## Critérios de aceite

- **Em 1536×730:** Agenda, Checklist e Cockpit sem rolagem da página. Na Agenda em modo Semana, das 08:00 às 21:00 aparece sem rolar.
- **Em 2560×950 e 1024×700:** o mesmo, com mais ou menos espaço por coluna.
- **Em 390×780 (celular):** o menu vira uma barra inferior, e nada sai da tela na horizontal.
- **Navegação:** de qualquer tela, um clique leva a qualquer outra, e o Cantinho abre o painel.
- **Testes:** `npm test` e `npm run check` passando.
