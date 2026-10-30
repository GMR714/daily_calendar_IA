---
demanda: mapa-de-trabalho
status: proposto
data: 2026-10-29
---

# Mapa de trabalho: projeto → tarefa → sessão → subsessão

## Pedido original

> "isso nao esta aqui so para bonito quero que cada bola seja uma tarefa/projeto e que quando eu clicar nela abra um grafo
> de cada seção/subseção no que esta trabalhando e consiga administrar melhor direto dali quero que nesse app de controle eu
> realmente consiga responder a seção ou mandar o prompt por audio, ler a seção se eu quiser tambem." (29/10)

"Seção" aqui é sessão do Claude.

## Dor real

Medido em 29/10:

- **Mapa:** cada bola é uma sessão viva do Claude. Não diz de que tarefa ou projeto ela é, e o clique só abre o detalhe da sessão, com o comando `claude attach` para copiar.
- **Tarefas e projetos:** o vault tem 36 tarefas em `Seazone/Tarefas/`, 22 abertas, em 7 projetos (propriedade `projeto`). 35 delas guardam a sessão que trabalha nelas (`sessao`). O cockpit não usa essa ligação.
- **Sessões esperando você:** 4 das 7 sessões ativas estavam "esperando você". Responder exigia abrir um terminal e dar `claude attach`.
- **Subsessões:** são os subagentes, que ficam gravados em `~/.claude/projects/<pasta>/<sessão>/subagents/`. Uma sessão sozinha ("Desafio do Marios") tinha 86, e o cockpit não mostra nenhum.
- **Ler a sessão:** só pelo terminal. A conversa da "Desafio do Marios" tem 242 MB, então não dá para ler o arquivo inteiro.

## Decisões dele (29/10)

- **Bolas:** projeto com as tarefas abertas em volta. As sessões sem tarefa ficam numa bola "Sem tarefa", agrupadas por pasta.
- **Responder a uma sessão que está trabalhando:** a resposta espera e é entregue quando ela parar. Nada é interrompido, e há um botão Parar.
- **Áudio:** ditado do Chrome. O texto cai na caixa para revisar antes de mandar.
- **Ouvir:** "um super resumo para nao ficar ouvindo codigo etc... deve ter no maximo 40 segundos mas focando em ter menos".

## O que muda

Três entregas. Cada uma tem um PR no copiloto (dados e comandos) e um na agenda (tela).

### Entrega 1: Mapa por projeto e tarefa, grafo e leitura

1. **Copiloto:** o `cockpit --json` ganha o bloco `trabalho`.
   - `projetos`: cada um com cor, tarefas abertas, sessões vivas e a lista de tarefas. Cada tarefa traz status, cor, link do Obsidian e sessões.
   - Entram as tarefas abertas e as fechadas que ainda têm sessão ativa.
   - A sessão se liga à tarefa pela `sessao` da nota (id curto ou longo) ou pelo nome, que começa com o id da tarefa (`T-20261029-01 ...`).
   - A sessão sem tarefa vai para o projeto "Sem tarefa", numa pseudotarefa por pasta.
   - `sessoes`: cada sessão ativa traz estado, cor, se está na memória, se dá para responder, o que disse por último e as subsessões. Das subsessões vêm o total, as ativas e até 8 itens, primeiro as ativas e depois as mais recentes.
2. **Copiloto:** `cli.py sessao ler <sessão> [--sub <subagente>] [--antes <posição>] [--limite 30]`.
   - Devolve as falas (as suas, as do Claude e cada ferramenta numa linha) da mais antiga para a mais nova, e a posição para pedir as anteriores.
   - Lê do fim do arquivo, em blocos. Pula linha gigante (resultado de ferramenta) sem guardá-la na memória.
   - Não mostra a saída das ferramentas, que pode trazer segredo e ser enorme.
3. **Agenda:** `GET /api/sessoes/<sessão>/conversa?antes=&sub=` chama o `sessao ler`. Só atende pedido deste computador.
4. **Agenda, Mapa:**
   - a área "Notebook · agentes" vira "Trabalho": cada projeto é uma bola, com as tarefas em volta;
   - "Nuvem", "Você" e "Rotinas no notebook" continuam;
   - clicar num projeto ou numa tarefa abre o grafo dele no mesmo quadro, com trilha e "Voltar";
   - no grafo de projeto: tarefas → sessões → subsessões. No grafo de tarefa: sessões → subsessões;
   - mais de 8 de um tipo vira "+N".
5. **Agenda, gaveta:**
   - sessão: estado, pasta e a conversa, com as falas mais novas embaixo e "Carregar anteriores";
   - subsessão: descrição e conversa, só para leitura;
   - tarefa: status, projeto, prazo e o link da nota.

### Entrega 2: responder e parar

1. **Copiloto:** `cli.py sessao responder` (stdin: `sessao`, `texto`, `origem`).
   - **Sessão interativa** (aberta num terminal): recusa e manda responder por lá.
   - **Sessão trabalhando:** guarda em `estado/para_sessoes.jsonl` e devolve `na-fila`.
   - **Sessão parada ou esperando você:** entrega na hora, como a orquestradora já faz em todo ciclo. Se o processo está vivo, dá `claude stop` e espera ele sair. Depois roda `claude --bg --resume <id longo> "<texto>"`, sem flags e na pasta da sessão.
2. **Copiloto:** `cli.py sessao entregar` entrega o que está na fila para quem já parou. Respostas para a mesma sessão vão juntas, na ordem. Quem chama é a agenda, a cada 20 s enquanto houver fila. O ciclo também chama, como reserva.
   - A sessão que termina o passo some do `claude agents` por um instante. Por isso a entrega lê a lista com `--all`, e a resposta de uma sessão que não aparece espera até 30 min antes de falhar.
3. **Copiloto:** `cli.py sessao parar <sessão>` roda `claude stop`. A conversa fica guardada.
4. **Agenda:**
   - `POST /api/sessoes/<sessão>/responder` e `POST /api/sessoes/<sessão>/parar`, com a mesma proteção das rotas `/api/copiloto/*`;
   - na gaveta da sessão, caixa de resposta com "Enviar" ou "Mandar quando parar", conforme o estado;
   - "Parar" pede um segundo clique.

### Entrega 3: ditado e Ouvir

1. **Ditar:** botão de microfone na caixa de resposta.
   - Usa o reconhecimento de voz do Chrome em pt-BR. O texto cai na caixa para revisar; nada é enviado sozinho.
   - O Chrome manda o áudio ao serviço de voz do Google, como ele aceitou.
   - Sem suporte no navegador, o botão some e a dica diz que o ditado pede Chrome ou Edge.
2. **Copiloto:** `cli.py sessao resumo <sessão>` faz um resumo para ouvir.
   - Usa `claude -p --model haiku --tools "" --safe-mode`, sem CLAUDE.md, hooks nem MCP, sem gravar sessão e com teto de gasto. A conversa vai pela entrada padrão e leva só as falas.
   - O resumo diz o que pediram, onde parou e o que espera de você. Não traz código, caminho de arquivo nem id.
   - Alvo de 60 palavras (cerca de 25 s). Acima de 90 palavras (cerca de 40 s), o texto é cortado na última frase completa.
   - Guarda o resultado enquanto a conversa não muda.
   - Se o `claude -p` falhar (limite de uso, por exemplo), monta um resumo mínimo sem IA: o nome, o estado e a primeira frase da última fala.
3. **Agenda:** botão "Ouvir" na gaveta da sessão. Lê o resumo com a voz pt-BR do navegador e mostra o texto. "Parar de ouvir" interrompe.
   - Uma fala por frase: a voz do Google no Chrome para no meio de falas longas.
   - A voz preferida é a natural do Edge, depois a do Google, depois qualquer pt-BR.

## Segurança

- As rotas novas seguem a fase 1:
  - Host deste computador;
  - Origin conferida nos POST;
  - JSON obrigatório;
  - só pedidos de 127.0.0.1 ou ::1.
- `/api/sessoes/*` só atende este computador até no GET, porque a conversa pode ter dado sensível.
- Ids validados antes de chegar ao Copiloto:
  - a sessão é um UUID ou o id curto de 8 caracteres;
  - o subagente tem só letras e números.

  Para responder e parar, a sessão também precisa estar na lista do `claude agents`.
- O texto da resposta vai como argumento do `claude`, sem passar por um shell, com até 8000 caracteres.
- O ambiente do CLI continua sem `ANTHROPIC_*`.

## Critérios de aceite

- [x] No Mapa, cada bola é um projeto ou uma tarefa, e as sessões sem tarefa estão em "Sem tarefa", por pasta.
- [x] O clique num projeto ou numa tarefa mostra as sessões e subsessões dele, cada uma com estado e cor. O clique numa sessão abre a conversa.
- [x] A conversa de uma sessão de 242 MB abre em poucos segundos, das falas mais novas para trás. Medido em 29/10: de 0,6 a 1,3 s, e as anteriores em 0,65 s.
- [x] Responder a uma sessão esperando você faz ela retomar com o texto, no mesmo chat e sem cópia. Responder a uma sessão trabalhando não a interrompe: a resposta vai quando ela parar. Conferido em 29/10 com sessões de teste. Pela tela, a sessão retomou com o mesmo id em cerca de 6 s e respondeu "quarta" e depois "quinta". Pelo CLI, a resposta a uma sessão trabalhando ficou na fila e foi entregue quando ela parou.
- [x] Sessão aberta num terminal não aceita resposta pela tela, e a gaveta explica por quê. Conferido em 29/10 com dados falsos: a gaveta mostra "Aberta num terminal: responda por lá.", sem caixa de resposta e sem Parar.
- [ ] O ditado põe o texto na caixa, e nada é enviado sem o clique dele. Conferido em 29/10 sem microfone, no Chrome headless: o clique em Ditar mostra o aviso do microfone, a caixa fica vazia e a página não envia nada. Falta ele testar com o microfone.
- [x] O Ouvir fala no máximo 40 s, sem código. O normal fica em cerca de 25 s. Medido em 29/10 no Chrome, com a voz do Google pt-BR: 22,9 s e 27,3 s de fala. Nas três sessões reais resumidas, de 46 a 61 palavras, sem código, caminho nem id. O primeiro resumo levou de 8 a 14 s; o guardado, cerca de 1,5 s.
- [x] Pedido de outro site ou de outra máquina é barrado antes de chegar ao Copiloto. Nos testes de `tests/sessoes-api.test.cjs`: Origin de outro site dá 403, POST sem JSON dá 415 e `/api/sessoes/*` só atende este computador, até no GET.
- [x] Em 1536×730 o cockpit cabe sem a página rolar. Também em 1024×700. A largura do desenho acompanha a da tela.

## Fora do escopo

- **Responder sessão interativa** (terminal): continua pelo terminal.
- **Apagar sessão** (`claude rm`).
- **Abrir sessão nova para uma tarefa:** pode vir depois, como "Retomar tarefa".
- **Whisper local:** o áudio ficaria no notebook, mas pede o modelo instalado.
