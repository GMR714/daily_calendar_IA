---
demanda: responder-pela-tela
status: proposto
data: 2026-10-29
---

# Plano: responder ao Copiloto pela tela

Cada passo vem com o teste antes.

1. **Proteção da API** (`request-guard.js`, `tests/protecao-api.test.cjs`):
   - Host com nome de outro site é barrado, até em GET;
   - os nomes locais entram;
   - `AGENDA_HOSTS` libera um nome a mais;
   - Origin `null` ou de outro site é barrada em qualquer POST;
   - comando só vale vindo de 127.0.0.1 ou ::1.
2. **Rotas do Copiloto** (`copiloto-command.js`, `tests/copiloto-api.test.cjs`):
   - validação do pedido;
   - 415 sem JSON;
   - 503 com a mensagem do Copiloto;
   - texto pela entrada padrão;
   - ambiente sem `ANTHROPIC_*`;
   - releitura do cockpit depois de responder.
3. **Copiloto** (`feat/caixa-de-entrada`, testes em `tests/test_entrada.py`, `test_novidades.py`, `test_vez.py`, `test_cockpit.py`, `test_vault.py`):
   - caixa de entrada;
   - evento `resposta`, inclusive o que vem da DM;
   - `ciclo agora`;
   - modo `agora` no `ciclo.ps1`;
   - mensagem inteira, resposta pendente e link da nota no cockpit;
   - commit do vault.
4. **Regras da gaveta** (`cockpit-view.js`, `tests/cockpit-view.test.cjs`):
   - ações por tipo de item;
   - rótulo da resposta que espera;
   - link só com o esquema `obsidian://open`.
5. **Tela** (`cockpit.js`, `cockpit.css`, `cockpit.html`):
   - botões na linha e na gaveta;
   - "Rodar agora" com contador;
   - a gaveta não é redesenhada enquanto ele digita.
6. **Conferência no navegador:**
   - Chrome headless em 1536×730, 1024×700 e 504×780;
   - aprovar de ponta a ponta numa cópia do estado do Copiloto, com um rascunho falso (R-99): grava na caixa da cópia, o `novidades` põe na fila da cópia e o copiloto real fica intocado.
