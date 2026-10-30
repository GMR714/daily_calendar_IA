---
demanda: responder-pela-tela
status: proposto
data: 2026-10-29
---

# Responder ao Copiloto pela tela (fase 1 da unificação)

## Pedido original

> "como podemos conectar isso ao meu agente de sistema pos reuniao e ao copiloto para ser tudo uma unica coisa unificada
> com a acesso ao obsidian e a tudo" (29/10)

A proposta está no vault, em `Seazone/Meu setup de IA.md`, seção "Unificação". As decisões dele, também de 29/10, foram "sim quero uma unica orquestradora", "sim pode ter botao" e "sim vault no git".

## Dor real

Medido em 29/10:

- **Fila do cockpit:** tem 31 itens: 11 rascunhos para dar ok e 20 tarefas para decidir, travadas ou esperando terceiros. O mais antigo espera há 6 dias.
- **Resposta a rascunho:** só existia o `ok R-NN` na DM do Slack.
  - A tela copiava o comando para ele colar na DM.
  - A gaveta mostrava o texto cortado em 280 caracteres.
- **"Decidir":** não tinha canal. A resposta ia editando a nota no Obsidian ou entrando no chat do worker.
- **Mandar texto à orquestradora:** o `cli.py orquestradora --prompt` derruba o turno que estiver rodando (ADR 012 do copiloto).
- **API da agenda:**
  - não tinha token;
  - comparava a Origin com o próprio cabeçalho Host, que um site malicioso forja por DNS rebinding.

## O que muda

1. **API protegida** (`request-guard.js`):
   - o Host precisa ser `localhost`, `127.0.0.1`, `[::1]` ou um nome de `AGENDA_HOSTS`;
   - a Origin vale em todo método que não é GET nem HEAD;
   - as rotas de comando só aceitam pedidos deste computador;
   - as rotas `/api/copiloto/*` exigem JSON.
2. **Duas rotas novas** (`copiloto-command.js`), que só chamam o CLI do Copiloto:
   - `POST /api/copiloto/responder`: aprovar, descartar ou pedir ajuste de um rascunho, ou responder uma tarefa. Roda `cli.py entrada gravar`, com o texto pela entrada padrão;
   - `POST /api/copiloto/rodar`: roda `cli.py ciclo agora`;
   - o ambiente do CLI vai sem `ANTHROPIC_*`, para o ciclo não cobrar pela API.
3. **Fila "Você" no cockpit:**
   - nas linhas, "Revisar" (rascunho) ou "Responder" (tarefa) abre a gaveta;
   - na gaveta de rascunho:
     - a mensagem aparece inteira;
     - os botões são "Aprovar e enviar", "Pedir ajuste" e "Descartar";
     - com um ajuste escrito, o aprovar trava;
     - descartar pede um segundo clique.
   - na gaveta de tarefa, há o link da nota no Obsidian e o campo de resposta;
   - item respondido mostra "Aprovado na tela · espera o ciclo" até o ciclo tratar.
4. **Topo do cockpit:** "Rodar agora" pede um ciclo, que espera a vez e nunca derruba o que está rodando. O contador mostra quantas respostas esperam.

No Copiloto (`feat/caixa-de-entrada`, ADR 015):
- a caixa `estado/entrada.jsonl`;
- o evento `resposta` na fila, para o qual o `ok R-NN` da DM também passa a ir;
- o `ciclo.ps1 -Modo agora`;
- o `cockpit --json` com `mensagem`, `resposta` e `obsidian`;
- o commit do vault a cada ciclo.

## Critérios de aceite

- [x] Aprovar um rascunho pela tela grava na caixa de entrada do Copiloto, e o `novidades` vira isso num evento `resposta` da fila.
- [x] A tela nunca envia nada: o envio continua só pela orquestradora, pela `copiloto-comunicar`.
- [x] Clique repetido não grava duas vezes. Resposta para rascunho que já saiu da fila é recusada.
- [x] Um pedido de outro site (outra Origin, ou Host forjado) é barrado com 403, antes de chegar ao Copiloto.
- [x] O "Rodar agora" com ciclo rodando não derruba nada: o ciclo novo espera a vez. Com o copiloto pausado, nada roda.
- [x] Em 1536×730 o cockpit cabe sem a página rolar. A gaveta mostra a mensagem inteira e os botões.

## 30/10: a resposta pede o ciclo sozinha

> "eu mando fazer as coisas que repondi la e nao parece que esta fazendo tudo eu queria que disparasse ate concluir minhas
> tarefas" (30/10)

A resposta esperava o ciclo de 30 em 30 min, que só roda nos dias úteis, das 08:00 às 19:30: à noite e no fim de semana,
ficava parada até o dia útil seguinte. No Copiloto, o ADR 018 faz a resposta continuar a conversa do worker da tarefa.

- **O servidor pede o ciclo** (`server-runtime.js`): cada resposta gravada arma um `cli.py ciclo agora` para 1 min depois
  (`cicloMs`). Resposta nova nesse minuto empurra o pedido para 1 min depois dela: respostas seguidas viram um ciclo só.
- **"Rodar agora" anterior ainda vivo** (`ja-pedido`): esse ciclo pode já ter lido a fila, então o servidor tenta de novo a
  cada minuto até o pedido entrar (`iniciado` ou `na-fila`). O Copiloto só considera vivo um pedido de até 2 h. Pausado ou
  com erro, o servidor para; a próxima resposta arma de novo.
- **Fila "Você":** no primeiro minuto e meio, o item respondido pela tela mostra "· ciclo em ~1 min"; depois, "· espera o
  ciclo". A resposta pela DM continua com "· espera o ciclo".

Critérios de aceite:

- [x] Uma resposta pela tela pede um ciclo 1 min depois; respostas seguidas pedem um só. Conferido em 30/10 com o servidor
  de verdade e um `cli.py` de mentira: respostas às 12:53:40 e às 12:53:46, um `ciclo agora` só, às 12:54:46.
- [x] Com um "rodar agora" ainda vivo, o servidor tenta de novo até o pedido entrar; pausado ou com erro, não insiste
  (testes da API).
- [x] O item respondido pela tela mostra "ciclo em ~1 min" e, passados 90 s, "espera o ciclo" (teste do rótulo; a tela não
  foi fotografada).

## Fora do escopo

- **Conversa livre com a orquestradora pela tela (fase 3):** a caixa de entrada já leva o texto; falta a resposta voltar para a tela.
- **Lista única de tarefas (fase 2):** a decisão sobre as 145 sugeridas e as 58 de "Minhas ações" ainda está em aberto.
- **Nome legível dos canais na fila:** continua aparecendo `C0C62AYA2FN`. O item está no BACKLOG do copiloto.
