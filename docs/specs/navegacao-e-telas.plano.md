---
spec: docs/specs/navegacao-e-telas.md
status: proposto
data: 2026-10-29
---

# Plano técnico: navegação única e telas que cabem na tela

## Decisões técnicas

| Tema | Decisão | Por quê |
|------|---------|---------|
| Menu | `nav-rail.js` (UMD, como o `planner-core.js`) monta o menu nas duas páginas a partir de uma lista de itens testável | Um menu só, sem framework e sem dependência |
| Telas da agenda | `#agenda` e `#checklist` na mesma página (`body[data-tela]`). `#metas` e `#ajustes` abrem o "Meus planos" | Trocar de tela não recarrega a página nem refaz a sincronização |
| Cockpit | Continua em `/cockpit`, com o mesmo menu | Já é uma página; juntar as duas não traz ganho agora |
| Escala do calendário | `agenda-layout.js` (UMD) calcula px por minuto pela altura útil (mín. 34 px/h, máx. 96 px/h) e escolhe a densidade do bloco pela altura em px | Hoje a escala é 1,3 px/min fixa, e a densidade sai dos minutos: um bloco de 1 h fica apertado quando a hora encolhe |
| Redesenho | O calendário refaz o desenho ao redimensionar a janela (com espera de 150 ms) e ao voltar para `#agenda` | A escala depende da altura |
| Cantinho | `POST /api/overlay/abrir` chama `launchOverlay`, que pode ser trocado no teste; o padrão é `cmd /c start "" iniciar-painel.cmd` com `detached` | Mesma checagem de Origin dos outros POST; o comando é fixo, sem entrada do usuário |
| CSS | Novas regras no fim do `product.css` (agenda), `nav-rail.css` (menu) e `cockpit.css` reescrito | Não mexer no `styles.css` base |

## Passos (teste antes)

1. `tests/agenda-layout.test.cjs` → `agenda-layout.js`: escala e densidade.
2. `tests/nav-rail.test.cjs` → `nav-rail.js`: itens, ativo e destinos.
3. `tests/overlay-api.test.cjs` → rota `POST /api/overlay/abrir` no `server-runtime.js`.
4. Agenda: telas por hash, barra do calendário e caixa de mensagem compactas (`product-ui.js`, `product.css`). Escala dinâmica no `renderWeek` (`app.js`).
5. Cockpit: chips, três colunas com rolagem interna e linhas compactas (`cockpit.html`, `cockpit.js`, `cockpit.css`).
6. Prints headless em 1536×730, 2560×950, 1024×700 e 390×780, e conferir os critérios da spec.
