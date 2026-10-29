---
demanda: vault-por-tarefa
status: em revisão (PR)
data: 2026-10-29
substitui: decisão 7 e o `Diário/` de docs/specs/mapeamento-obsidian.md
---

# Vault organizado por tarefa, não por dia

## Pedido original

> "não gostei do jeito que organizou meu obsidian criando uma nota por dia, eu ia preferir
> que criasse uma nota por tarefa ou task etc; fica confuso de navegar, a conexão com dias
> fica muito fragmentada. Conserte isso e siga um padrão melhor que escale para o futuro"

## Dor real

- Hoje a rodada grava `Diário/AAAA-MM-DD.md` (46 notas de 03/09 a 28/10). Cada dia mistura
  todos os projetos; cada projeto liga para os dias. Para seguir um assunto é preciso pular
  de dia em dia, e o grafo vira uma teia de projeto ↔ data.
- As tarefas (165 até 29/10) só existem no app de agenda. No vault elas aparecem como
  bullets "Próximos passos sugeridos" espalhados pelos dias, sem nota, sem link, sem estado.

## Padrão novo

**Entidade vira nota; data vira propriedade.** Os nós do vault são projetos e tarefas. O dia
deixa de ser nota e passa a ser campo (`criada`, `concluida`) e título de seção no histórico
do projeto. As visões por data saem de consultas (Bases), não de pastas por dia.

```
Projetos.md                                       índice: projetos por área + sessões avulsas
Projetos/Tarefas.base                             visões: abertas, sugeridas, concluídas, todas
Projetos/<Área>/<Projeto>.md                      hub do projeto
Projetos/<Área>/<Projeto>/Tarefas/<Título>.md     uma nota por tarefa
```

### Nota do projeto (hub)

Blocos `auto`, nesta ordem, com "## Minhas notas" livre no fim:

1. **Estado atual** e **Onde está cada coisa**: iguais a hoje.
2. **Tarefas**: abertas (confirmadas, depois sugeridas) e as concluídas mais recentes, cada uma
   com link para a nota da tarefa.
3. **Histórico**: o "feito no dia" que antes ia para o `Diário/`, agrupado por mês, do mais novo
   para o mais velho. Cada dia é um item com subitens dobráveis, com o que mudou e as tarefas
   concluídas naquele dia (com link). Dia sem resumo aparece como pendente.
4. **Sessões**: igual a hoje.

O bloco antigo `recente` ("Últimos dias", com links para `Diário/`) é removido.

### Nota da tarefa

- Propriedades: `tipo: tarefa`, `id`, `titulo`, `status` (sugerida, confirmada, feita,
  descartada), `area`, `projeto` (link para o hub), `criada`, `concluida`, `prazo`.
  Mesmo `tipo`, `status` e `criada` das notas de `Seazone/Tarefas/` do copiloto.
- Bloco `auto:tarefa`: projeto e status, **Contexto** (o texto que o app mostra) e **Registro**
  com datas (sugerida a partir das sessões de DD/MM, concluída pela rodada com a evidência,
  feita ou descartada no app).
- "## Minhas notas" livre.
- O arquivo é achado pelo `id`, não pelo nome: se o título mudar no app, a nota fica onde está.
- Nome = título sem caracteres proibidos, até 80 caracteres; título repetido na mesma pasta
  ganha o fim do id.
- Tarefa descartada não ganha nota. Se já tinha nota, a nota fica e só o status muda.

### Fonte da verdade

Continua a mesma: tarefas e status no `agenda-data.json` (é no app que se confirma, descarta e
marca feito); resumos no cache `sync-data/summaries`. O vault é uma projeção dos dois, regravada
por inteiro a cada rodada: só muda o arquivo cujo conteúdo mudou, e o que está fora dos blocos
`auto` nunca é tocado.

### Sessões avulsas

Sem `Diário/`, a lista de sessões avulsas (pastas fora de projeto) vai para o `Projetos.md`,
últimos 30 dias. Como cada rodada só vê o dia anterior, a lista acumula em
`sync-data/avulsas.json`.

## Fora de escopo

- Mudar o que a IA resume (o prompt e o cache ficam como estão; nada é resumido de novo).
- Ligar cada item de "feito no dia" à tarefa que ele avançou (pediria um campo novo no resumo).
  Fica como próximo passo, se o histórico por projeto não bastar.
- Gravar a nota da tarefa na hora do clique no app: a nota reflete o app na rodada seguinte.
- Juntar estas tarefas com as de `Seazone/Tarefas/` (copiloto). Os campos já batem; juntar as
  duas numa Base só é uma decisão à parte.

## Plano

| Fatia | O quê | Teste primeiro |
|---|---|---|
| 1 | `vault.js`: inserir bloco novo na ordem certa (antes do próximo bloco ou de "## Minhas notas"), remover bloco legado, recusar escrita em `Diário/` | `vault.test.js` |
| 2 | `vault.js`: caminho e nota da tarefa, blocos `tarefas` e `historico`, índice com tarefas abertas e avulsas, `Tarefas.base` | `vault.test.js` |
| 3 | `run.js`: agenda antes do vault; regrava todos os projetos e todas as tarefas; avulsas acumuladas; modo `--so-vault` (sem ler sessões nem chamar a IA) | `run.test.js` |
| 4 | Migração do vault real: backup, `--so-vault`, `Diário/` vai para o backup, texto do `Projetos.md` | conferência na prévia (`--dry-run`) antes de gravar |

Migração (uma vez, depois do merge e da pasta principal atualizada, antes das 06:00):

1. Copiar `Diário/`, `Projetos/` e `Projetos.md` para `.sync-backup/antes-das-tarefas-2026-10-29/`.
2. Semear `sync-data/avulsas.json` com as "Sessões avulsas" dos diários.
3. `node sync/run.js --vault --so-vault --dry-run` e conferir a prévia.
4. `node sync/run.js --vault --so-vault`.
5. Mover `Diário/` para o backup e trocar no `Projetos.md` a frase que cita o `Diário/`.
