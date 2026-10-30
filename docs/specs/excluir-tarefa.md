---
demanda: excluir-tarefa
status: proposto
data: 2026-10-29
---

# Excluir tarefa pelo cockpit

## Pedido original

> "sim mescle e quero poder exluir os cards de tarefas la tambem alem de dar ok" (29/10)

## Dor real

Medido em 29/10, às 23h:

- **Fila Você:** tem 28 cards. São 11 rascunhos (`dar ok`), 13 decisões (`decidir`) e 4 travadas.
  - O rascunho tem Aprovar, Pedir ajuste e Descartar.
  - Os 17 cards de tarefa só têm Responder.
- **Tirar uma tarefa que não vale mais:** hoje ele responde "pode descartar" e espera o ciclo, ou muda a nota no Obsidian.
- **Vault:** 20 tarefas abertas em `Seazone/Tarefas/`.

## Decisão

Assumida, porque ele não disse como excluir:

- **Excluir é pôr o status `descartada` na nota**, sem apagar o arquivo.
  - A tarefa sai da fila e do Mapa.
  - A nota fica no vault, com uma linha no Registro, e volta se o status mudar.
  - Esse é o mesmo fechamento que o resto do copiloto já entende (`feita` e `descartada`).
- **O efeito é imediato, sem esperar o ciclo:** a agenda roda o `cli.py tarefa registrar <id> "Descartada pela tela do cockpit." --status descartada`, que o copiloto já tem.

## O que muda

1. **Agenda:** `POST /api/copiloto/excluir-tarefa` com `{ "tarefa": "T-AAAAMMDD-NN" }`.
   - Valida o id, chama o Copiloto e pede uma leitura nova do cockpit.
2. **Tela:**
   - na fila Você, o card de tarefa ganha "Excluir", e o primeiro clique vira "Confirmar";
   - na gaveta da tarefa, tanto na fila quanto no Mapa, entra "Excluir tarefa", também com segundo clique;
   - depois de excluir, a gaveta fecha e o aviso diz "Tarefa excluída: fica no vault como descartada."
   - se a tarefa tem sessão viva, o aviso diz que a sessão continua e que o Parar está na gaveta dela.
3. **Rascunho:** continua com Descartar, sem mudança.
4. **Cache do cockpit:** a releitura pedida depois de uma mudança, com outra leitura rodando, roda de novo quando ela termina.
   - Antes, ela se juntava à leitura que tinha começado antes da mudança, e o card voltava por até 45 s.
   - Vale também para responder e para parar.

## Segurança

- A rota segue a proteção das rotas do Copiloto:
  - Host deste computador;
  - Origin conferida;
  - JSON obrigatório;
  - só pedidos de 127.0.0.1 ou ::1.
- Só um id de tarefa no formato `T-AAAAMMDD-NN` chega ao Copiloto. O texto do registro é fixo.

## Critérios de aceite

- [x] O card de tarefa na fila Você tem Excluir. O primeiro clique pede confirmação, e o segundo exclui. Conferido em 29/10 no Chrome headless, com um vault de teste: o primeiro clique virou "Confirmar" sem abrir a gaveta, e o segundo excluiu em 0,6 s.
- [x] A tarefa excluída sai da fila e do Mapa na hora. A nota fica com status `descartada` e uma linha no Registro. Conferido pelo card e pela gaveta do Mapa.
  - A nota ganhou "- 29/10 23:27 · Descartada pela tela do cockpit.".
  - A leitura do servidor, 20 s depois, já não trazia nenhuma das duas.
  - Para isso, a releitura pedida no meio de outra leitura agora roda de novo quando ela termina. Antes, uma das tarefas voltava no cache por até 45 s.
  - Desfazer, voltando o status pelo `tarefa registrar`, devolveu as duas para a fila.
- [x] O rascunho não ganha Excluir e continua com Descartar. Há teste.
- [x] Pedido de outro site, sem JSON ou com id fora do formato é barrado antes de chegar ao Copiloto. Há testes: 403, 415 e 400, e o Copiloto não é chamado.

## Ajuste de 30/10: apagar sem abrir e Rotinas recolhível

> "quero que a parte da direita ali seja um toggle que eu possa expandir e que de mais espaço para a do meio e que [nela] eu possa
> deletar com um botao sem entrar na task" (30/10)

- **Apagar sem abrir:** o card de tarefa já tem Excluir. O card de rascunho ganha Descartar no próprio card, também com segundo clique. O descarte vai para a caixa de entrada e o Copiloto trata no próximo ciclo, como o Descartar da gaveta.
- **Rotinas recolhível:** em tela larga, a coluna Rotinas começa recolhida numa faixa de 46 px, com o selo da pior cor ("1 erro", "2 atenção" ou "11 ok"). O clique abre, e "Recolher" fecha. A escolha fica guardada no navegador. Em tela estreita, as colunas continuam como abas.

### Critérios de aceite do ajuste

- [x] Com Rotinas recolhida, a fila Você fica mais larga, e a página não rola. Medido em 30/10 a 1536x730: as colunas passaram de 494, 472 e 430 px para 500, 850 e 46 px.
- [x] O selo da faixa mostra a pior cor das rotinas. Há teste.
- [x] O rascunho é descartado pelo card sem abrir a gaveta: o primeiro clique vira "Confirmar", e o segundo grava o descarte. Conferido em 30/10 num COPILOTO_HOME de teste: o card mostrou "Descartado na tela · espera o ciclo", e a caixa de entrada recebeu `descartar R-01`.

## Fora do escopo

- Apagar o arquivo da nota.
- Excluir várias de uma vez.
- Parar junto a sessão da tarefa. O aviso diz que ela continua, e o Parar está na gaveta da sessão.
- Desfazer pela tela. Para desfazer, basta mudar o status da nota.

## Plano

Cada passo vem com o teste antes.

1. **Rota** (`tests/copiloto-api.test.cjs`):
   - leva o id ao Copiloto e relê o cockpit;
   - id fora do formato dá 400;
   - sem JSON dá 415;
   - Origin de outro site dá 403;
   - o `cli.py` recebe `tarefa registrar` com o texto fixo e `--status descartada`.
2. **Regra** (`tests/cockpit-view.test.cjs`):
   - `acoesDoItem` devolve `excluir` para tarefa, nunca para rascunho;
   - `avisoDaExclusao` cita as sessões vivas da tarefa.
3. **Tela:**
   - botão no card, na gaveta da fila e na gaveta do Mapa, com segundo clique;
   - versões novas dos scripts.
4. **Conferência:** Chrome headless com um vault de teste. O `COPILOTO_HOME` temporário tem um `config.json` que aponta para uma pasta com uma tarefa falsa, nunca para o vault dele.
