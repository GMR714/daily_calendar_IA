# Assistente de Semana e Metas

MVP local para organizar semana, compromissos, rotinas, metas e relatos diarios com suporte futuro a IA, Google Calendar e WhatsApp.

## Como rodar

Abra `index.html` no navegador.

Opcionalmente, para testar os endpoints de integracao:

```powershell
node server.js
```

Depois acesse `http://localhost:8787`.

## Telegram barato/local

O caminho mais simples nao usa webhook publico. O servidor faz polling no Telegram enquanto estiver ligado.

1. Crie um bot no Telegram com o `@BotFather`.
2. Copie o token.
3. Rode:

```powershell
$env:TELEGRAM_BOT_TOKEN="seu_token_do_botfather"
$env:AI_PROVIDER="ollama"
$env:OLLAMA_HOST="http://localhost:11434"
$env:OLLAMA_MODEL="minimax-m2.5:cloud"
node server.js
```

4. Abra o bot no Telegram e envie textos como:

```text
tenho uma prova dificil dia 22
entrega do relatorio dia 25 com assinatura do orientador
academia segunda quarta sexta por 1 hora
```

As mensagens do Telegram sao interpretadas pela IA, salvas em `agenda-data.json` e sincronizadas com o app web quando ele abrir/recarregar.

## O que ja funciona no MVP

- Cadastro de metas de longo prazo, rotinas recorrentes e compromissos pontuais.
- Entrada unica por mensagem natural: o app decide se e tarefa, compromisso, rotina, meta ou relato do dia.
- Exemplos rapidos ajudam a preencher pedidos comuns como prova dificil, entrega academica, rotina e relato.
- Quando o Ollama estiver configurado, textos longos sao interpretados por LLM no endpoint `/api/interpret`.
- Botao unico de audio para ditar a mensagem quando Web Speech API estiver disponivel.
- Planejamento automatico da semana por blocos de tempo.
- Entregas academicas viram plano de producao antes do prazo, nao apenas uma tarefa curta no dia da entrega.
- Provas viram plano de estudo antes da data, com teoria, exercicios, simulado e revisao final.
- Navegacao por semanas para ver blocos futuros no calendario.
- Painel de hoje e proximos prazos para orientar o que fazer primeiro.
- Integracao inicial com Telegram por polling local, sem precisar expor webhook publico.
- Pomodoros automaticos: tarefas longas ganham ciclos de foco e pausas curtas.
- Alarmes no navegador para aviso 10 minutos antes, inicio, pausas e fim dos blocos.
- Relato diario por texto ou gravacao de audio no navegador.
- Ajuste simples da agenda com base no motivo do que nao foi feito.
- Exportacao `.ics` para importar em Google Calendar, Apple Calendar ou Outlook.
- Endpoints base para WhatsApp webhook e chamada de IA.

## Integracoes planejadas

- Ollama: interpretar mensagens longas usando modelos locais ou cloud.
- OpenAI: opcional para transcrever audio futuramente.
- Google Calendar: criar/editar eventos direto na agenda.
- WhatsApp Cloud API: receber mensagens e audios pelo telefone.

## Observacao sobre WhatsApp

Para integrar WhatsApp de forma oficial, o caminho e usar WhatsApp Business Platform / Cloud API da Meta, com webhooks em um servidor publico. O WhatsApp pessoal comum nao oferece API oficial para automacao.

## Usar Ollama

Padrao do projeto:

```powershell
$env:AI_PROVIDER="ollama"
$env:OLLAMA_HOST="http://localhost:11434"
$env:OLLAMA_MODEL="minimax-m2.5:cloud"
$env:OLLAMA_FALLBACK_MODEL="gemma4:31b-cloud"
node server.js
```

Antes disso, faca login e baixe o modelo cloud no Ollama:

```powershell
ollama signin
ollama pull minimax-m2.5:cloud
ollama pull gemma4:31b-cloud
```

Tambem e possivel usar a API cloud direta da Ollama:

```powershell
$env:AI_PROVIDER="ollama"
$env:OLLAMA_HOST="https://ollama.com"
$env:OLLAMA_API_KEY="sua_chave_ollama"
$env:OLLAMA_MODEL="minimax-m2.5:cloud"
node server.js
```

Alternativa:

```powershell
$env:OLLAMA_MODEL="gemma4:31b-cloud"
node server.js
```

Instrucao principal para a IA: preservar datas explicitas, separar textos longos em varios itens, nao mover itens futuros para a semana atual e deixar `date: null` quando o usuario nao informou data.
