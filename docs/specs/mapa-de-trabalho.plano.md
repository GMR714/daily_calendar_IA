---
demanda: mapa-de-trabalho
status: proposto
data: 2026-10-29
---

# Plano: Mapa de trabalho

Cada passo vem com o teste antes. Cada entrega fecha com um PR no copiloto e um na agenda.

## Entrega 1: Mapa por projeto e tarefa, grafo e leitura

1. **Copiloto, ligação** (`copiloto/trabalho.py`, `tests/test_trabalho.py`):
   - a tarefa se liga à sessão pela `sessao` curta ou longa, e pelo nome que começa com o id dela;
   - sessão sem tarefa vai para "Sem tarefa", numa pseudotarefa por pasta;
   - tarefa fechada só entra se ainda tem sessão ativa;
   - a cor do projeto é a pior das tarefas dele, e os projetos vêm da pior cor para a melhor;
   - das subsessões: ativas primeiro, depois as mais recentes, até 8, com total e ativas contados.
2. **Copiloto, conversa** (`copiloto/conversa.py`, `tests/test_conversa.py`):
   - as falas saem das linhas do `.jsonl`: as suas, as do Claude e uma linha por ferramenta;
   - ficam de fora lembrete do sistema, resultado de ferramenta, linha meta e linha de subagente;
   - a leitura do fim pagina pela posição no arquivo;
   - linha gigante é pulada sem ser guardada;
   - no começo do arquivo, a posição para as anteriores vem vazia.
3. **Copiloto, CLI** (`__main__.py`):
   - `sessao ler` (com `--sub`, `--antes` e `--limite`);
   - `cockpit --json` com `trabalho`.

   Conferir com as sessões reais, só lendo.
4. **Agenda, rota** (`sessoes-command.js`, `tests/sessoes-api.test.cjs`):
   - `GET /api/sessoes/<sessão>/conversa`;
   - id inválido dá 400;
   - os argumentos vão certos ao CLI;
   - falha do Copiloto dá 503;
   - pedido de fora deste computador é barrado.
5. **Agenda, regras do Mapa** (`cockpit-view.js`, `tests/cockpit-view.test.cjs`):
   - `layoutTrabalho`: cada projeto na sua célula, as tarefas em volta, "+N" acima de 8 e tudo dentro da área;
   - `grafoDoItem`: nós e arestas do projeto ou da tarefa, com "+N" nas subsessões.
6. **Agenda, tela** (`cockpit.js`, `cockpit.css`, `cockpit.html`):
   - área "Trabalho";
   - grafo com trilha e "Voltar";
   - gaveta da sessão com a conversa e "Carregar anteriores";
   - gaveta da subsessão e da tarefa.
7. **Conferência:**
   - Chrome headless em 1536×730 e 1024×700, com os dados reais e só leitura;
   - abrir a conversa da sessão de 242 MB e medir o tempo.

## Entrega 2: responder e parar

1. **Copiloto** (`copiloto/sessoes.py`, `tests/test_sessoes.py`), com o `claude` falso nos testes:
   - responder decide entre `interativa`, `na-fila` e `entregue`;
   - entregar faz stop, espera o processo sair e só então roda `--bg --resume` com o id longo, sem flags, na pasta da sessão;
   - a fila junta as respostas da mesma sessão, na ordem, e só entrega para quem parou;
   - parar recusa sessão interativa.
2. **Copiloto, CLI e ciclo:**
   - `sessao responder` (stdin), `sessao entregar` e `sessao parar`;
   - o `ciclo.ps1` chama `sessao entregar`.
3. **Agenda, rotas** (`tests/sessoes-api.test.cjs`):
   - `POST .../responder` e `POST .../parar`;
   - 415 sem JSON;
   - Origin de outro site dá 403;
   - texto vazio ou com mais de 8000 caracteres dá 400;
   - o laço de entrega roda a cada 20 s enquanto houver fila e para quando ela esvazia.
4. **Agenda, tela:**
   - caixa de resposta na gaveta da sessão, com o rótulo do botão conforme o estado;
   - "Parar" com segundo clique;
   - a gaveta não é redesenhada enquanto ele digita.
5. **Conferência:**
   - ponta a ponta com uma sessão de teste criada para isso, nunca com as sessões dele;
   - a sessão retoma com o texto e no mesmo id.

## Entrega 3: ditado e Ouvir

1. **Copiloto** (`tests/test_resumo_voz.py`):
   - teto de palavras cortando na última frase completa;
   - limpeza de código, caminho e id;
   - guardado enquanto a conversa não muda;
   - resumo mínimo sem IA quando o `claude -p` falha.
2. **Copiloto, CLI:** `sessao resumo`, conferido numa sessão real.
3. **Agenda:**
   - rota `GET /api/sessoes/<sessão>/resumo`;
   - regras puras do ditado (juntar o texto parcial ao final e saber se o navegador tem suporte), com teste.
4. **Agenda, tela:**
   - botão "Ditar", com a falta de suporte explicada;
   - "Ouvir" com voz pt-BR e "Parar de ouvir".
5. **Conferência:**
   - o resumo de uma sessão real dura no máximo 40 s;
   - o ditado é testado por ele, porque o Chrome headless não tem microfone.
