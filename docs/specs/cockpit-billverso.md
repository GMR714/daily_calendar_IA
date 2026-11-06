---
demanda: cockpit-billverso
status: entregue
data: 2026-11-05
---

# Cockpit no visual do painel do Bill (live de 03/11, minuto 56)

## Pedido original

> "quero que deixe o visual do meu gerenciador mapa cockpit como o bill mostra no minuto 56 da live e tente entender tudo
> la inclusive as funcionalidades que ainda não tenho aqui e o site é o billverso mas nao tenho acesso a tudo acho entao
> va pela tela da live" (05/11)

## Fonte

A tela do painel do Bill no vídeo da live "Treinamento — Lideranças Tech" (YouTube, 55:54 a 57:40). O site dele pede
login, então valeu só o que aparece no vídeo. Os quadros e a leitura bloco por bloco ficam fora deste repositório, que é
público: o painel dele mostra dado interno.

## O que o painel do Bill tem

1. **Topo**: o nome, as abas (Mapa, Pulso, Tarefas, Saldos, Ideias, Entregas, Pessoal), o link "Excalidraw ↗" e, à
   direita, a saúde da leitura ("… ok · relido há 6 s").
2. **Faixa de números**, em duas linhas de cartões:
   - na primeira: Realizadas hoje, Pendentes (com as paradas há mais de 8 h), Geradas sem você (com a origem), Validadas
     sem você (com a % dos aceites) e Esperando você (com a idade do mais velho, em roxo);
   - na segunda: Menor saldo (a conta com menos folga e o reset), Energia (os tokens do dia e quem mais gastou) e
     Cadeiras (os agentes por cor: ◆ problema, ▲ atenção, ● bem, ○ sem sinal).
3. **Faixa amarela**: onde a tela aceita ação.
4. **Esquerda**: Prioridades (campo, Adicionar, caixa de marcar, ↑, ↓ e lixeira) e os times, cada um com os agentes por
   cor, quantos trabalham, a fila e os tokens.
5. **Centro, o Mapa**:
   - a legenda das cores e das linhas: delega, escala, colabora e rotinas;
   - as vistas Padrão, "+ quem observa" e "+ tráfego 24 h", e o zoom;
   - um aviso numa linha;
   - o grafo: "Você" à esquerda, os times em caixas, e cada agente numa caixa com bolinha de estado, nome, estado, % do
     contexto e um selo com a fila. A esteira termina numa caixa tracejada "Entregas hoje".
6. **Direita**:
   - Fila: Abertas, Em execução, Entregues sem aceite, Retrabalho hoje e Entregas hoje;
   - Saldos (% disponível), com "Ver contas";
   - Aconteceu: o último que andou, com a hora.
7. **Aba Entregas**: "entregue não é aceito". Cada cartão traz o id, o título, o resumo, as evidências, os artefatos, a
   data e os botões Aceitar e Reprovar, e quem entregou não aceita.

Tudo em tema escuro, com cartões de borda fina, rótulos pequenos em maiúsculas e o número grande antes do rótulo.

## O que muda aqui

**Visual.** A tela /cockpit fica escura, com o topo, a faixa de números, a faixa de aviso e as três colunas do Mapa como
no painel do Bill. O trilho lateral da agenda continua.

**Abas**, na ordem do Bill. Nada do que existe se perde:

| Aba | O que mostra |
|---|---|
| Mapa | A casa nova: Prioridades e Times à esquerda, o mapa dos agentes no centro, Fila, Saldos e Aconteceu à direita |
| Pulso | O antigo Painel: as colunas Agentes, Você e Rotinas, como estavam |
| Tarefas | O antigo Mapa: as bolas por projeto e a árvore de decisão no clique, como estavam |
| Saldos | Os saldos e o gasto de hoje por sessão (o antigo Hoje) |
| Ideias | O BACKLOG do copiloto, só leitura |
| Entregas | As tasks feitas que esperam aceite, com Aceitar e Reprovar |
| Pessoal ↗ | Abre a agenda, que é a parte pessoal |
| Excalidraw ↗ | Abre os desenhos do copiloto no Obsidian |

**Números do topo** (tudo vem do `cockpit --json` do copiloto, bloco `numeros`):

| Cartão | Conta |
|---|---|
| Realizadas hoje | tasks fechadas como feitas hoje |
| Pendentes · N paradas há +8 h | tasks abertas; paradas são as sem linha no Registro há mais de 8 h |
| Geradas sem você | tasks criadas hoje pelo próprio copiloto (rotina, vigia, capacidade, etapa do ciclo, outra task), com a parte sem origem |
| Validadas sem você · % dos aceites | aceites de hoje que não foram do Gabriel (Verificadora ou sinal externo) |
| Esperando você · mais velho | a fila Você, com a idade do item mais velho |
| Menor saldo | a janela da conta do Claude com menos folga (5 h ou 7 dias), lida da foto do switcher |
| Energia · top | tokens de hoje e a sessão que mais gastou |
| Cadeiras | os agentes por cor |

**Mapa dos agentes.** O copiloto manda os nós e as ligações prontos (`nos` e `ligacoes`); a agenda só desenha.
- Times: Comando (Mestra e orquestradora), Fábrica (um nó por worker de task), Rotinas (as tarefas "Copiloto - *" do
  Agendador), Outras sessões (as que não são do copiloto) e Governança (Verificadora, Revisora e ronda).
- Ligações:
  - delega: Você → Mestra → orquestradora → workers;
  - escala: o worker que espera o Gabriel → Você;
  - rotinas: a rotina → quem ela acorda;
  - observa: a governança → quem ela confere, só com "+ quem observa".
- O clique no agente abre a gaveta da sessão (ler, responder, ouvir, parar), e no Você, a fila Você. A caixa "Entregas
  hoje" abre a aba Entregas.
- A legenda só mostra as linhas que aparecem no mapa.

**Prioridades.** Lista curta, guardada no copiloto (`estado/prioridades.json`, `CLI prioridades`). A orquestradora lê a
lista a cada ciclo para escolher o que despachar primeiro. Adicionar, marcar, subir, descer e apagar valem só neste
computador, como as outras ações da tela.

**Entregas.** As tasks `feita` sem verificação, da mais nova para a mais velha, com a prova (link que abre em outra aba,
arquivo como texto) e o print da prova.
- **Aceitar** grava "Aceita pelo Gabriel" na nota e marca a task como verificada.
- **Reprovar** pede o motivo, grava "Reprovada pelo Gabriel" e devolve a task ao worker (`pronta`).
- As duas passam pelo `CLI verificacao veredito` com `quem: Gabriel`.

**Saldos.**
- A conta do Claude: o uso de 5 h e de 7 dias da foto que o switcher grava a cada 15 min, sem token, com a idade da
  leitura.
- A memória e o disco deste computador.

**Aconteceu.** As últimas 20 linhas do Registro das tasks de hoje, com a hora, o id e o título.

**Faixa amarela.** "Só neste computador · responder, aceitar, reprovar e prioridades gravam no copiloto": o cockpit não
sai da máquina (ADR 015 do copiloto).

## Fica de fora (vira task no copiloto)

- "+ tráfego 24 h" no mapa: quantas mensagens e tarefas passaram por cada ligação no dia.
- Operar pelo celular. O cockpit é local, e abrir para fora é decisão de segurança. Hoje, pelo celular, existe a DM.
- Saldo do AI Hub em dólar, lido do Grafana, como no painel do Bill.

## Pronto quando

- A tela /cockpit tem o topo, a faixa de números, a faixa de aviso e as três colunas do painel do Bill, em tema escuro,
  com os dados reais do copiloto.
- As abas Pulso e Tarefas mostram o que o Painel e o Mapa mostravam antes.
- Prioridades e Entregas (Aceitar e Reprovar) funcionam pela tela e gravam no copiloto.
- Testes na suíte (`npm test`) e print da tela com os dados reais.
