---
demanda: mapa-historia
status: implementado
data: 2026-10-30
---

# Mapa: uma bola por tarefa e a história de cada uma

## Pedido original

> "achei que o mapa ainda esta muito confuso ele não deveria ter o layout estatico assim e cada bola ali deveria ser uma
> tarefa grande e os grafos so aparecerem quando eu clico nela mostrando que dentro dela foram feitas tal coisas que levaram
> a tal outras coisas e assim ate o que precisa de ação minha para eu entender o que esta acontecendo e onde estou na tarefa
> com mais detalhes" (30/10)

## Dor real

Medido em 30/10:

- **O Mapa é uma grade fixa.**
  - Cada projeto é uma bola com as tarefas pequenas em órbita.
  - À direita ficam três caixas: Nuvem, Você e Rotinas no notebook, que já estão no Painel.
- **O clique numa tarefa mostra estrutura, não história.** O grafo é tarefa → sessões → subsessões. Não diz o que foi feito, nem em que ordem, nem onde a tarefa parou.
- **A história já existe nas notas** de `Seazone/Tarefas/`:
  - o "Por quê" é a origem;
  - o "Pronto quando" é a meta;
  - cada linha do "Registro" (`- 29/10 12:38 · ...`) é um passo.
- **Tamanho:** 18 tarefas abertas (12 esperando você, 5 travadas e 1 em execução). Os passos por tarefa têm mediana de 3 e máximo de 54. Cada passo tem mediana de 375 caracteres e máximo de 1.400.

## O que muda

1. **Mapa = bolas de tarefa.**
   - Cada tarefa aberta é uma bola grande, com o título dentro.
   - O tamanho cresce com os passos, com as sessões vivas e quando a tarefa precisa de você.
   - A cor é o estado: problema, atenção, bem ou sem sinal.
   - As bolas se arrumam sozinhas, sem se encostar, agrupadas por projeto, com o nome do projeto perto do grupo. A arrumação é sempre a mesma para os mesmos dados, para as bolas não pularem a cada leitura.
   - Sessões sem tarefa entram como bolas menores e tracejadas, uma por pasta.
   - Nuvem, Você e Rotinas saem do Mapa, porque já estão no Painel.
2. **Clique numa bola = a história da tarefa.**
   - Abre um fluxo de cartões, da esquerda para a direita, ligados por setas, no lugar das bolas, com "← Mapa" para voltar:
     - **Pedido:** quem pediu, quando e por quê;
     - **Passos do Registro**, na ordem: data e o começo do texto;
     - **Agora**, em destaque: o que precisa de você (decidir, rascunho para dar ok), o que trava (acesso pedido ou que falta) ou quem está trabalhando;
     - **Meta:** o "Pronto quando", tracejado, porque ainda não chegou.
   - As sessões da tarefa ficam penduradas no passo cujo texto cita o id delas; se nenhum cita, ficam no Agora. O rascunho pendente fica pendurado no Agora.
   - Com mais passos do que cabem, os mais antigos viram "+N anteriores", e dá para voltar e avançar.
   - O clique num cartão abre a gaveta:
     - no passo, o texto inteiro;
     - no Agora, a gaveta da tarefa, com Responder e Excluir;
     - na sessão, a conversa;
     - no rascunho, Revisar.
   - A bola tracejada de sessões sem tarefa abre o grafo de sessões de hoje.
3. **Copiloto:** `cli.py tarefa historia <id>` devolve o pedido, o por quê, a meta, os passos, o agora e os rascunhos pendentes da tarefa. O `cockpit --json` ganha `passos` por tarefa, só a contagem, para o tamanho da bola.
4. **Agenda:** `GET /api/tarefas/<id>/historia`, só deste computador, porque a nota pode ter dado sensível. A história é lida no clique, e a releitura de 30 s continua leve.

## Segurança

- `/api/tarefas/*` só atende este computador, até no GET, como `/api/sessoes/*`.
- O id da tarefa é validado (`T-AAAAMMDD-NN`) antes de chegar ao Copiloto.
- Os textos da nota viram texto na tela, nunca HTML. Links só com http(s), pelo `trechosDaFala`.

## Critérios de aceite

- [x] No Mapa, cada bola é uma tarefa aberta, com o título legível. Nenhuma bola encosta em outra nem sai da área, e a arrumação se repete com os mesmos dados.
- [x] O clique numa tarefa mostra pedido → passos → agora → meta, na ordem do Registro. O Agora diz o que precisa dele.
- [x] A tarefa com mais passos do que cabem mostra os últimos e "+N anteriores", e dá para navegar.
- [x] O clique num passo mostra o texto inteiro; no Agora, Responder e Excluir.
- [x] Em 1536×730 a tela cabe sem rolar.
- [x] Pedido de outro computador ou com id fora do formato é barrado antes de chegar ao Copiloto.

## Fora do escopo

- Editar passos ou a nota pela tela.
- Ligar passos por causa e efeito além da ordem do Registro. A ordem já conta a história.
- Tarefas fechadas no Mapa: elas saem, como hoje.

## Plano

Cada passo vem com o teste antes.

1. **Copiloto** (`copiloto/historia.py`, `tests/test_historia.py`):
   - seção da nota por título;
   - passos do Registro com data e texto;
   - o agora pelo status (esperando você: o último passo; travada: os acessos `pedido`/`falta`; em execução; na fila; fechada);
   - rascunhos pendentes da tarefa;
   - `tarefa historia <id>` no CLI;
   - `passos` no `trabalho` do cockpit.
2. **Agenda, regras** (`cockpit-view.js`):
   - `layoutBolhas`: sem encostar, dentro da área, agrupado por projeto e determinístico;
   - `raioDaTarefa`;
   - `resumoDoPasso`: a primeira frase, até N caracteres;
   - `fatiaDaHistoria`: os passos que cabem e quantos ficam antes e depois;
   - `sessoesNosPassos`: em que passo cada sessão fica.
3. **Agenda, rota:** `GET /api/tarefas/<id>/historia`, com `rotaSoLocal`.
4. **Agenda, tela:** o Mapa de bolas em SVG e a história em cartões HTML, com a gaveta de cada cartão.
5. **Conferência:** Chrome headless a 1536×730 com os dados reais, só lendo, mais uma tarefa de 54 passos para a navegação.

## Ajustes da implementação (30/10)

O que mudou em relação ao plano, depois da conferência com os dados reais (20 tarefas, 9 projetos e uma tarefa de 55 passos):

- **Tarefa fechada com sessão ativa** continua no Mapa, numa bola pontilhada, porque o Copiloto ainda manda ela no `trabalho`. Tarefa fechada sem sessão sai, como antes.
- **A história quebra em fileiras.** Os cartões têm tamanho fixo e a tela conta quantas fileiras cabem no quadro: em 1536×730 são 3, com até 13 passos à vista; em 1280×720, 2; em 1920×1080, 5. A seta que liga uma fileira à outra abre a de baixo, e o conjunto fica no meio do quadro.
- **O cartão do passo tira a hora que o Registro repete no começo** ("29/10 19h01: ..."), porque ela já está no topo do cartão. O texto inteiro fica na gaveta.
- **O Agora tem Responder e Excluir no topo**, sempre à vista, e os rascunhos para revisar embaixo.
- **O nome do projeto é medido depois de desenhado.** Ele fica dentro do desenho e, se encosta no nome de um projeto mais urgente, encurta; se nem curto cabe, vai para baixo do cacho.
- **A arrumação das bolas** mede as bolas pela altura do quadro e afasta os cachos na horizontal até usar a largura (até 1,8 vez). Afastar nunca faz dois cachos se encostarem.
- **A fila Você ganhou "Ver a história da tarefa"** na gaveta de cada item ligado a uma tarefa.

Conferido no Chrome sem janela, com os dados reais e só lendo: nenhuma bola encosta em outra ou sai do quadro, nenhum título passa da bola, nenhum nome de projeto encosta em outro, a página não rola e o console fica sem erro, em 1536×730, 1280×720 e 1920×1080.
