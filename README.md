# Agenda Inteligente

Agenda pessoal para transformar objetivos em etapas executaveis, reservar tempo na rotina e revisar o plano com feedback. Usa Ollama, incluindo modelos cloud, ou Claude Code autenticado localmente; nao exige uma chave da OpenAI.

## Iniciar

Requer **Node.js 22.17 ou mais recente**. No Windows, abra `iniciar.cmd`. Ou execute:

```powershell
npm start
```

Abra http://localhost:8787. Nao e necessario instalar dependencias para executar o servidor ou os testes de unidade. Se a porta estiver ocupada, altere `PORT` em `.env` ou encerre a instancia anterior.

### Painel Flutuante

No Windows, clique em **Cantinho** no menu lateral da agenda (ou execute `iniciar-painel.cmd`) para abrir um painel compacto, sempre por cima das outras janelas. Arraste qualquer lateral ou canto para redimensionar. O botao de circulo no cabecalho alterna a opacidade do fundo entre 100%, 24% e sem fundo; o botao **A** alterna o texto entre preto, branco e cinza neutro opacos. O cinza foi escolhido para equilibrar o contraste sobre fundos brancos e pretos; sobre tons intermediarios, use preto ou branco conforme a leitura. No modo branco, o fundo ganha contraste escuro quando visivel. Tamanho, posicao, transparencia e cor do texto ficam salvos em `%LOCALAPPDATA%\DailyCalendarIA\overlay-settings.json`. A aba **Hoje** mostra horarios e cores das metas, atualiza a cada minuto e permite concluir o bloco exato. A aba **Notas** salva automaticamente um bloco de notas em `%LOCALAPPDATA%\DailyCalendarIA\notes.txt`.

O Pomodoro fica visivel no topo, com iniciar, pausar e reiniciar. Ele alterna 25 minutos de foco com 5 de pausa, oferece uma pausa de 15 minutos a cada quatro focos e avisa por som e notificacao quando a fase termina. Continua contando quando o painel esta minimizado; ao reabrir, recupera o tempo salvo. Os avisos dependem de o painel estar aberto.

A aba **IA** tem os modos **Planejar** e **Relatar**. A IA interpreta a mensagem, mostra cada mudanca proposta e so grava depois de **Aplicar**. O icone no cabecalho abre o calendario completo no navegador. O painel inicia o servidor em segundo plano quando necessario e, ao fechar, encerra somente a instancia que ele mesmo abriu.

Para a interpretacao com IA, configure pelo menos um motor. A agenda manual continua funcionando sem IA.

```powershell
ollama signin
ollama pull gemma4:31b-cloud
```

O padrao e `gemma4:31b-cloud`. Uma falha nunca transforma silenciosamente uma mensagem longa em uma unica tarefa. O texto permanece no campo para tentar novamente.

## Configuracao

O servidor carrega `.env` automaticamente, quando existir. `.env.example` lista as opcoes sem segredos. As variaveis ja definidas no ambiente prevalecem.

```dotenv
PORT=8787
HOST=127.0.0.1
AGENDA_HOSTS=
TZ=America/Sao_Paulo
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma4:31b-cloud
OLLAMA_FALLBACK_MODEL=
AI_PROVIDER=ollama
CLAUDE_CLI_MODEL=sonnet
CLAUDE_CLI_EFFORT=high
CLAUDE_CLI_TIMEOUT_MS=120000
```

Tambem existe suporte a `OLLAMA_HOST=https://ollama.com` com `OLLAMA_API_KEY`. A disponibilidade dos modelos, limites e eventuais cobrancas dependem da conta Ollama. O projeto nao garante uso cloud ilimitado.

### Claude Code Sem API Key

Execute `claude setup-token` uma vez no terminal e conclua a autenticacao da sua assinatura. A agenda reutiliza essa sessao local; nao pede nem grava uma API key. Depois, atualize a pagina e escolha **Claude Code (assinatura)** em **Meus planos > Disponibilidade e ajustes**. Para tambem usar Claude no Telegram, defina `AI_PROVIDER=claude` no `.env` e reinicie o servidor.

Cada mensagem inicia um processo `claude -p` com `stream-json` e schema de saida. O processo usa `restricted`, `safe-mode`, `dontAsk`, politica de negacao, sem plugins/MCP e sem persistencia de sessao. A unica ferramenta liberada e a interna `StructuredOutput`, necessaria para validar o JSON; shell, arquivos, web e subagentes permanecem bloqueados. Ele so pode devolver uma proposta; a agenda continua exigindo sua confirmacao antes de gravar qualquer alteracao. Ha no maximo duas execucoes simultaneas e cada uma tem timeout configuravel.

Este caminho deve permanecer para sua agenda pessoal local. Antes de oferecer o produto para outras pessoas, use a autenticacao por API ou obtenha autorizacao da Anthropic para o tipo de uso.

## Fluxo De Uso

1. Defina sua disponibilidade e carga diaria em **Acoes > Disponibilidade e ajustes**.
2. Envie suas rotinas fixas, compromissos e objetivos na caixa de mensagem. Pode usar ditado quando o navegador oferecer reconhecimento de voz.
3. Revise a **proposta**: novas metas, etapas, estimativas, correcoes e exclusoes. Nada muda antes de confirmar.
4. Acompanhe o calendario em **Dia**, **Semana** ou **Mes**. Cores podem representar categorias ou metas. Espacos livres permanecem visiveis.
5. Abra um bloco para ver instrucoes, criterio de conclusao e registrar o tempo realizado. Uma sessao parcial nao conclui a tarefa inteira.
6. Conte o que atrapalhou na mesma caixa de mensagem, selecionando **Relato**. A IA propoe ajustes para voce revisar.

O calendario e a caixa de mensagem ficam na mesma tela. **Meus planos** reune metas, tarefas, relatos e ajustes em secoes recolhiveis, sem exigir navegar entre paginas. Filtros e cores ficam recolhidos junto ao calendario.

**Meus planos > Metas** mostra estrategia, marcos, proximas acoes e criterios de sucesso. `Criar plano com IA` e `Revisar plano com IA` usam as etapas ja existentes. Concluir as etapas mede o progresso do plano; nao marca automaticamente a meta de vida como atingida.

**Meus planos > Todas as tarefas e rotinas** permite editar os itens fora do calendario. Os campos mais frequentes aparecem primeiro; instrucoes, categoria, prioridade, meta e estado ficam em **Mais detalhes**. Para uma rotina, o editor diferencia a serie inteira de apenas uma ocorrencia. E possivel mover ou cancelar uma ocorrencia sem apagar as demais.

## Regras Do Planejador

- Compromissos e rotinas com horario confirmado reservam o calendario primeiro.
- Horarios fixos em conflito nao sao deslocados em silencio: um item fica pendente, com aviso para revisao.
- Tarefas flexiveis usam os intervalos restantes, respeitando a disponibilidade, dias preferidos, carga diaria de tarefas, carga semanal da meta e prazos.
- `duration` representa o esforco total estimado, incluindo pausas. Trabalhos longos sao distribuidos em sessoes de ate 120 minutos. Pomodoros ficam dentro de cada intervalo, sem aumentar sua duracao.
- As etapas seguem `planOrder`; dependencias explicitas podem usar `dependsOn` com IDs de tarefas existentes. Uma etapa bloqueada nao e executada antes de sua dependencia.
- Consultas e provas futuras permanecem nas datas informadas. Preparacao e entrega sao itens separados.
- O que nao cabe no prazo aparece como pendencia; o sistema nao sobrepoe blocos para fingir que tudo cabe.
- Navegar pelo calendario nao modifica tarefas. O comando **Acoes > Replanejar a partir de agora** recalcula os itens flexiveis a partir do momento atual.
- Nao existe deduplicacao destrutiva por palavras parecidas. Correcoes da IA usam IDs, com validacao antes de aplicar.

O planejamento flexivel considera pelo menos 90 dias a partir de hoje e estende o horizonte ao navegar para datas posteriores, ate aproximadamente tres anos. Ocorrencias futuras ainda sao planejamento, nao comprovacao de execucao; use os registros de sessao e relatos para acompanhar o que realmente aconteceu.

## Telegram

Integracao por long polling, sem servidor publico ou webhook. O computador e o processo Node precisam permanecer ligados.

1. Crie um bot com o BotFather. Se um token ja foi exposto em conversa ou repositorio, revogue-o e gere outro.
2. Defina `TELEGRAM_BOT_TOKEN` em `.env` e reinicie o servidor.
3. Envie `/start` ao bot. Ele informa seu chat ID, mas ainda nao mostra nem altera a agenda.
4. Defina `TELEGRAM_ALLOWED_CHAT_ID` com esse ID e reinicie. Somente esse chat tera acesso.

Comandos:

- `/hoje`: blocos do dia.
- `/semana`: proximos sete dias.
- `/confirmar`: aplica a proposta pendente.
- `/cancelar`: descarta a proposta.
- `/ajuda`: comandos disponiveis.

Mensagens normais geram propostas, como na interface. Uma proposta antiga e recusada se a agenda mudar antes da confirmacao. O navegador consulta mudancas a cada 15 segundos e identifica conflitos de edicao.

**Audio anexado no Telegram ainda nao e transcrito.** Use o ditado do teclado para enviar texto. O ditado na pagina depende do navegador e pode usar o servico de reconhecimento do proprio navegador, nao o Ollama.

## Cockpit Da IA

O item **Cockpit** do menu lateral abre `/cockpit`, uma tela com o que os agentes do Claude Code estao fazendo, o que espera sua decisao e as rotinas agendadas. Os dados vem do Copiloto (`cli.py cockpit --json`). A aba **Painel** junta o semaforo (problema, atencao, bem, sem sinal), o que olhar agora, os agentes com o contexto de cada um, a fila **Voce** e as rotinas na linha das 24 h. **Mapa** desenha o trabalho: cada bola grande e um projeto, com as tarefas abertas em volta; as sessoes sem tarefa ficam em **Sem tarefa**, por pasta. O clique num projeto ou numa tarefa abre o grafo das sessoes do Claude e das subsessoes (subagentes) dela; o clique numa sessao abre a conversa, das falas mais novas para tras, com **Carregar anteriores**. **Hoje** lista as sessoes do dia por frente. Os numeros do topo filtram a tela; `/` busca, `r` atualiza e `Esc` fecha o detalhe. **Levar para a agenda** cria uma tarefa de 30 minutos e prioridade alta para hoje, sem repetir o mesmo item.

Na gaveta de uma sessao em segundo plano, a caixa embaixo da conversa responde a ela (`Ctrl+Enter` envia). Se a sessao esta parada ou esperando voce, **Enviar** a retoma na hora, no mesmo chat (`claude --bg --resume`, na pasta da sessao). Se esta trabalhando, o botao vira **Mandar quando parar**: a resposta espera na fila do Copiloto (`cli.py sessao responder`), e a agenda tenta entregar a cada 20 s enquanto houver fila; o ciclo do Copiloto tambem entrega, como reserva. Nada interrompe a sessao, a nao ser **Parar**, que pede um segundo clique e roda `claude stop`; a conversa fica guardada, e a proxima resposta a retoma. Sessao aberta num terminal nao recebe resposta pela tela: a gaveta pede para responder por la.

**Ouvir**, na gaveta de qualquer sessao, pede ao Copiloto um resumo curto (`cli.py sessao resumo`): o que foi pedido, onde a sessao parou e o que espera de voce, sem codigo, caminho ou id. O alvo e cerca de 25 s de fala, e o teto e 40 s. O texto fica escrito acima da conversa, e a voz pt-BR do navegador o le, frase por frase; **Parar de ouvir** interrompe. O primeiro resumo leva de 8 a 14 s; enquanto a conversa nao muda, o Copiloto devolve o mesmo em cerca de 1 s. **Ditar**, ao lado de **Enviar**, usa o reconhecimento de voz do navegador em portugues: o texto cai na caixa para voce revisar, e nada e enviado sem o clique. Na primeira vez, o navegador pede para usar o microfone. Sem suporte (fora do Chrome e do Edge), no lugar do botao aparece a dica.

Na fila **Voce**, **Revisar** abre o rascunho inteiro, com **Aprovar e enviar**, **Pedir ajuste** e **Descartar**. **Responder** manda sua resposta a uma tarefa, e a gaveta traz o link da nota no Obsidian. A resposta vai para a caixa de entrada do Copiloto (`cli.py entrada gravar`), e o proximo ciclo trata pelo mesmo caminho do `ok R-NN` da DM. Ate la, o item mostra "espera o ciclo". **Rodar agora**, no topo, pede um ciclo na hora; ele espera a vez e nunca derruba o que esta rodando. A tela nao envia nada: quem envia e a orquestradora.

**Excluir**, no card de tarefa da fila e na gaveta da tarefa (tambem pelo Mapa), fecha a tarefa como descartada. O primeiro clique vira **Confirmar**, e o segundo exclui. A tarefa sai da tela na hora, e a nota fica no vault com `status: descartada` e uma linha no registro (`cli.py tarefa registrar ... --status descartada`). Para desfazer, volte o status da nota. Se a tarefa tem sessao viva, o aviso diz que ela continua; o **Parar** esta na gaveta da sessao. O rascunho tem **Descartar** no proprio card, tambem com segundo clique; o Copiloto descarta no proximo ciclo.

Na tela larga, **Rotinas** fica recolhida numa faixa a direita, com o selo da pior cor (por exemplo, "1 erro" ou "11 ok"), e a fila **Voce** ganha o espaco. O clique na faixa abre a coluna, e **Recolher** fecha; a escolha fica guardada. Em tela estreita, as colunas continuam como abas.

O servidor roda o Copiloto quando a tela pede e guarda a leitura por 45 s; a tela atualiza sozinha a cada 30 s. Sem o Copiloto, so a tela do cockpit mostra o erro, e a agenda continua igual. O caminho padrao e o abaixo; mude no `.env` se o Copiloto estiver em outra pasta.

```dotenv
COCKPIT_CLI=C:\Dev\Dev Seazone\copiloto\cli.py
COCKPIT_PYTHON=py
```

## Dados E Seguranca

- `agenda-data.json` e a fonte compartilhada entre navegador e Telegram.
- Cada gravacao tem revisao e escrita atomica. As 30 versoes anteriores ficam em `.agenda-backups/`.
- Arquivos corrompidos causam erro explicito; nao sao substituidos por uma agenda vazia.
- A sincronizacao compara a versao anterior, a edicao local e a versao do servidor. Alteracoes independentes sao combinadas; conflitos ficam visiveis, sem sobrescrever em silencio.
- O servidor so atende quem chega por `localhost`, `127.0.0.1` ou `[::1]`. Um site que aponte o proprio nome para este computador (DNS rebinding) recebe 403; para abrir a agenda por outro nome, inclua-o em `AGENDA_HOSTS`. Pedidos que alteram dados precisam vir da propria agenda, e as acoes que fazem este computador agir (abrir o painel, falar com o Copiloto) so valem vindas dele. A conversa das sessoes (`/api/sessoes/*`) tambem: ela pode ter dado sensivel. A saida das ferramentas nao aparece na tela. Responder e parar so valem para sessoes que aparecem no `claude agents`, e o texto da resposta vai como argumento do `claude`, sem passar por um shell, com ate 8000 caracteres.
- O resumo do **Ouvir** e feito por um `claude -p` haiku da sua assinatura, sem ferramentas e sem gravar sessao, que le so as falas, nunca a saida das ferramentas. No **Ditar**, o navegador manda o audio ao servico de voz dele (Google no Chrome, Microsoft no Edge); a agenda so recebe o texto.
- O navegador guarda rascunhos e alteracoes pendentes durante falhas de conexao. Uma copia local anterior pode ser exportada em Ajustes.
- Para restaurar manualmente um backup do servidor, pare o servidor, preserve o arquivo atual e substitua `agenda-data.json` por uma copia valida da pasta de backups. Reinicie e use a versao do servidor no navegador se houver conflito.
- `.env`, dados, backups, logs e cursor do Telegram ficam fora do Git.
- O servidor e pessoal e local, ligado a `127.0.0.1` por padrao. **Nao exponha essa porta na internet:** nao existe autenticacao multiusuario nem TLS.
- Mensagens e contexto da agenda sao enviados ao motor escolhido para a interpretacao. Modelos cloud do Ollama e a API Claude processam esse contexto remotamente.

## Limites Importantes

Os alarmes funcionam com a pagina aberta, permissoes adequadas e sem suspensao do computador. O navegador pode atrasar timers em segundo plano; nao use este sistema como unico alarme para compromissos criticos. Nao existem notificacoes push com o aplicativo fechado.

WhatsApp e sincronizacao bidirecional com Google Calendar nao estao implementados. A exportacao `.ics` e manual. O aplicativo nao deve afirmar que essas integracoes estao ativas.

## Verificacao

```powershell
npm test
npm run check
```

Os testes usam somente arquivos temporarios, nunca a agenda real. Cobrem encaixe sem sobreposicao, duracoes, datas futuras, recorrencia, conflitos, armazenamento e propostas da API.

Teste visual opcional: instale Playwright em um ambiente de desenvolvimento ou aponte `PLAYWRIGHT_MODULE` para uma instalacao existente; execute `node tests/ui.cjs`. `BROWSER_CHANNEL=msedge` usa o Edge instalado. O teste cria uma agenda isolada e captura desktop e celular em `.cache/`.

`node tests/ollama-smoke.cjs` faz uma chamada real ao Ollama com um exemplo ficticio, sem gravar na agenda. Pode consumir a cota do provedor e nao faz parte de `npm test`.

## Estrutura

- `planner-core.js`: regras puras compartilhadas de planejamento, validacao, propostas e sincronizacao.
- `agenda-store.js`: armazenamento atomico, revisoes e backups.
- `server-runtime.js`: API local e confirmacao de propostas.
- `overlay-core.js`: checklist de hoje e conclusao protegida de uma sessao.
- `overlay.ps1`, `iniciar-painel.cmd`: painel flutuante nativo do Windows.
- `ollama.js`, `claude.js`: adaptadores de IA que retornam somente uma proposta estruturada.
- `ai-provider.js`: selecao isolada de Ollama ou Claude por mensagem.
- `telegram.js`: autorizacao por chat, comandos e propostas.
- `app.js`, `product-ui.js`: calendario, editores, feedback e sincronizacao.
- `styles.css`, `product.css`: estilos base e interface reorganizada.
- `cockpit-source.js`: leitura do Copiloto para o cockpit, com cache e erro legivel.
- `cockpit-view.js`: regras puras da tela do cockpit (grupos, filtros, contexto, o que mudou, texto sem markdown, mapa de trabalho, grafo, conversa, o que da para fazer com cada sessao, voz do Ouvir e ditado).
- `cockpit.html`, `cockpit.js`, `cockpit.css`: tela Cockpit da IA.
- `nav-rail.js`, `nav-rail.css`: menu lateral unico da agenda e do cockpit (Agenda, Checklist, Cockpit, Cantinho, Planos, Ajustes).
- `agenda-layout.js`: escala do calendario pela altura da tela, para o dia caber sem rolar.
