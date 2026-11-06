---
demanda: cockpit-pela-tailnet
status: entregue
data: 2026-11-06
---

# O cockpit e a agenda de outra máquina, pela tailnet

## Pedido original

> "agora tenho o tailscale em outro pc tambem entao quero ter visibilidade e gerenciar tudo dali" (06/11)

## Como fica

- O servidor continua escutando só em `127.0.0.1`. Quem leva o pedido de outra máquina é o `tailscale serve` deste
  computador, que publica a agenda só na tailnet (nunca o `funnel`, que abriria para a internet):
  `tailscale serve --bg --http 80 http://127.0.0.1:8787`.
- O `tailscale serve` repassa o pedido com o `Host` do nome da máquina na tailnet, o `X-Forwarded-For` de quem pediu e o
  `Tailscale-User-Login`. O cliente não forja esse login, porque o próprio `tailscale serve` o preenche. O navegador
  deste computador não manda nenhum dos dois.
- Pedido com esses cabeçalhos só entra quando o login está em `AGENDA_TAILSCALE_LOGINS`, separado por vírgula.
  Sem a lista, ninguém entra pela tailnet. Máquina com tag, sem pessoa, também não entra.
- O nome da máquina na tailnet vai em `AGENDA_HOSTS`, como qualquer nome que não é local.
- A origem `https://` do mesmo nome vale. Fica pronta para quando o HTTPS da tailnet for ligado
  (`tailscale serve --bg 8787`), que faz do navegador remoto um contexto seguro, com o ditado e o copiar.
- Pela tailnet, o botão Mestra abre a conversa dela na gaveta, com a caixa de resposta. A janela dela abriria no
  computador da agenda, longe de quem pediu.

## Configuração (no `.env`, fora do repositório)

```
AGENDA_HOSTS=<nome-da-maquina>.<tailnet>.ts.net,<nome-da-maquina>,<ip-da-maquina-na-tailnet>
AGENDA_TAILSCALE_LOGINS=<login-do-tailscale>
```

## Pronto quando

- De outra máquina da tailnet, `http://<nome-da-maquina>.<tailnet>.ts.net/cockpit` abre o cockpit com os dados, e as
  ações (responder, prioridades, aceitar, reprovar, rodar agora) funcionam para o login da lista.
- Login fora da lista, ou pedido sem login pelo proxy, recebe 403.
- Testes em `tests/protecao-api.test.cjs`.
