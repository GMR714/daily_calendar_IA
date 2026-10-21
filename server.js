const http = require("http");
const fs = require("fs");
const path = require("path");
const { mergeById } = require("./agenda-merge");

const PORT = Number(process.env.PORT || 8787);
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "agenda-inteligente";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const AI_PROVIDER = process.env.AI_PROVIDER || "ollama";
const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "minimax-m2.5:cloud";
const OLLAMA_FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || "gemma4:31b-cloud";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_POLLING = process.env.TELEGRAM_POLLING !== "false";
const DATA_FILE = path.join(__dirname, "agenda-data.json");

const publicFiles = {
  "/": "index.html",
  "/index.html": "index.html",
  "/styles.css": "styles.css",
  "/agenda-merge.js": "agenda-merge.js",
  "/checklist.js": "checklist.js",
  "/app.js": "app.js"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && publicFiles[url.pathname]) {
    return serveFile(res, publicFiles[url.pathname]);
  }

  if (req.method === "GET" && url.pathname === "/webhooks/whatsapp") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) return send(res, 200, challenge || "");
    return send(res, 403, "Forbidden");
  }

  if (req.method === "POST" && url.pathname === "/webhooks/whatsapp") {
    const body = await readJson(req);
    console.log("WhatsApp webhook recebido:", JSON.stringify(body, null, 2));
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/plan") {
    const body = await readJson(req);
    const plan = await callPlanner(body);
    return json(res, 200, plan);
  }

  if (req.method === "POST" && url.pathname === "/api/interpret") {
    const body = await readJson(req);
    const result = await interpretWithAi(body);
    return json(res, 200, result);
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    return json(res, 200, loadAgendaData());
  }

  if (req.method === "POST" && url.pathname === "/api/state/merge") {
    const body = await readJson(req);
    const data = mergeAgendaData(loadAgendaData(), body);
    saveAgendaData(data);
    return json(res, 200, data);
  }

  return send(res, 404, "Not found");
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Agenda Inteligente rodando em http://localhost:${PORT}`);
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_POLLING) startTelegramPolling();
    if (!TELEGRAM_BOT_TOKEN) console.log("Telegram desativado: defina TELEGRAM_BOT_TOKEN para iniciar o bot.");
  });
}

function serveFile(res, fileName) {
  const filePath = path.join(__dirname, fileName);
  const ext = path.extname(filePath);
  const types = { ".html": "text/html;charset=utf-8", ".css": "text/css;charset=utf-8", ".js": "application/javascript;charset=utf-8" };
  fs.readFile(filePath, (err, content) => {
    if (err) return send(res, 500, "Erro ao ler arquivo");
    send(res, 200, content, types[ext] || "text/plain;charset=utf-8");
  });
}

// projects e opens vêm da rodada diária (sync/) e do checklist; o navegador não os
// manda, então a mescla nunca pode apagá-los.
function loadAgendaData(file = DATA_FILE) {
  const empty = { entries: [], reports: [], projects: [], opens: [] };
  try {
    if (!fs.existsSync(file)) return empty;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      opens: Array.isArray(parsed.opens) ? parsed.opens : []
    };
  } catch {
    return empty;
  }
}

function saveAgendaData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function mergeAgendaData(current, incoming) {
  return {
    entries: mergeById(current.entries, incoming.entries),
    reports: mergeById(current.reports, incoming.reports),
    projects: mergeById(current.projects, incoming.projects),
    opens: Array.from(new Set([...(current.opens || []), ...(Array.isArray(incoming.opens) ? incoming.opens : [])])).sort()
  };
}

function saveInterpretation(result, source) {
  const data = loadAgendaData();
  const createdAt = new Date().toISOString();
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const reports = Array.isArray(result.reports) ? result.reports : [];

  entries.forEach(entry => {
    data.entries.push({
      id: `telegram-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: entry.type,
      text: entry.text,
      date: entry.date,
      time: entry.time,
      duration: normalizeServerDuration(entry.duration),
      priority: Math.min(3, Math.max(1, Number(entry.priority || 2))),
      preferredDays: Array.isArray(entry.preferredDays) ? entry.preferredDays : [],
      source,
      createdAt
    });
  });

  reports.forEach(report => {
    data.reports.push({
      id: `telegram-report-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: report.text,
      mood: report.mood,
      blockers: Array.isArray(report.blockers) ? report.blockers : [],
      source,
      createdAt
    });
  });

  saveAgendaData(data);
  return { entries: entries.length, reports: reports.length };
}

function normalizeServerDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 60;
  return Math.max(15, Math.round(duration / 15) * 15);
}

async function callPlanner(payload) {
  if (!OPENAI_API_KEY) {
    return { mode: "local", message: "Defina OPENAI_API_KEY para ativar planejamento por IA.", received: payload };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: "Voce organiza agendas pessoais em portugues do Brasil. Responda JSON com eventos, prioridades, riscos e ajustes sugeridos." },
        { role: "user", content: JSON.stringify(payload) }
      ]
    })
  });

  if (!response.ok) return { mode: "error", status: response.status, text: await response.text() };
  return response.json();
}

async function startTelegramPolling() {
  console.log("Telegram polling ativo.");
  let offset = 0;
  while (true) {
    try {
      const updates = await telegramRequest("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      for (const update of updates.result || []) {
        offset = update.update_id + 1;
        await handleTelegramUpdate(update);
      }
    } catch (error) {
      console.error("Erro no Telegram polling:", error.message);
      await delay(4000);
    }
  }
}

async function handleTelegramUpdate(update) {
  const message = update.message;
  if (!message?.chat?.id) return;
  const chatId = message.chat.id;
  const text = message.text || message.caption || "";

  if (text.startsWith("/start")) {
    await sendTelegramMessage(chatId, [
      "Agenda Inteligente pronta.",
      "Mande uma tarefa, prova, entrega, rotina ou relato do dia.",
      "Ex: tenho uma prova dificil dia 22",
      "Por enquanto, texto e o caminho mais confiavel; audio fica para a proxima etapa."
    ].join("\n"));
    return;
  }

  if (!text.trim()) {
    await sendTelegramMessage(chatId, "Recebi sua mensagem, mas por enquanto eu interpreto melhor texto. Envie escrito o que quer planejar.");
    return;
  }

  await sendTelegramMessage(chatId, "Pensando e organizando sua agenda...");
  const result = await interpretWithAi({
    mode: "auto",
    message: text,
    timezone: "America/Sao_Paulo"
  });

  if (result.mode !== "ai") {
    await sendTelegramMessage(chatId, `Nao consegui usar a IA agora. ${result.message || "Tente novamente em instantes."}`);
    return;
  }

  const saved = saveInterpretation(result, { type: "telegram", chatId });
  await sendTelegramMessage(chatId, formatTelegramSummary(result, saved));
}

function formatTelegramSummary(result, saved) {
  const lines = [
    result.summary || "Organizei sua mensagem.",
    "",
    `Salvei ${saved.entries} item(ns) e ${saved.reports} relato(s).`
  ];

  const entries = (result.entries || []).slice(0, 6);
  if (entries.length) {
    lines.push("", "Itens:");
    entries.forEach(entry => {
      const date = entry.date ? ` - ${entry.date}` : "";
      const time = entry.time ? ` ${entry.time}` : "";
      lines.push(`• ${entry.text}${date}${time}`);
    });
  }

  lines.push("", "Abra o app web ou recarregue para sincronizar.");
  return lines.join("\n");
}

async function sendTelegramMessage(chatId, text) {
  return telegramRequest("sendMessage", { chat_id: chatId, text });
}

async function telegramRequest(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Telegram ${method} HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function interpretWithAi(payload) {
  if (AI_PROVIDER === "ollama") {
    return interpretWithOllama(payload);
  }

  if (!OPENAI_API_KEY) {
    return {
      mode: "local",
      message: "Defina OPENAI_API_KEY para ativar interpretacao por LLM."
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [
            "Voce e um planejador pessoal em portugues do Brasil.",
            "Interprete mensagens longas do usuario e separe em entradas de agenda e relatos.",
            "Crie tarefas acionaveis, compromissos com data quando houver, rotinas recorrentes e metas.",
            "Preserve datas explicitas e nunca mova itens futuros para a semana atual.",
            "Entregas de relatorio/trabalho/projeto devem virar plano de producao antes do prazo, com blocos realistas, nao uma tarefa unica de 15 minutos.",
            "Provas e exames devem virar plano de estudo antes da data, com exercicios, simulado e revisao; a prova fica separada como evento final.",
            "Quando faltar data/hora, deixe null para o app encaixar automaticamente.",
            "Use datas ISO yyyy-mm-dd. Hoje e " + today + ".",
            "Para tarefas longas, estime duracao realista em minutos.",
            "Prioridade: 3 alta, 2 media, 1 baixa.",
            "preferredDays usa segunda=0, terca=1, quarta=2, quinta=3, sexta=4, sabado=5, domingo=6."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            mode: payload.mode,
            message: payload.message,
            timezone: payload.timezone || "America/Sao_Paulo"
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "agenda_interpretation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              entries: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["task", "event", "routine", "goal"] },
                    text: { type: "string" },
                    date: { type: ["string", "null"] },
                    time: { type: ["string", "null"] },
                    duration: { type: "number" },
                    priority: { type: "number" },
                    preferredDays: {
                      type: "array",
                      items: { type: "number" }
                    }
                  },
                  required: ["type", "text", "date", "time", "duration", "priority", "preferredDays"]
                }
              },
              reports: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    mood: { type: ["string", "null"] },
                    blockers: {
                      type: "array",
                      items: { type: "string" }
                    }
                  },
                  required: ["text", "mood", "blockers"]
                }
              }
            },
            required: ["summary", "entries", "reports"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    return { mode: "error", status: response.status, message: await response.text() };
  }

  const data = await response.json();
  const content = data.output_text || extractResponseText(data);
  try {
    return { mode: "ai", model: OPENAI_MODEL, ...JSON.parse(content) };
  } catch {
    return { mode: "error", status: 500, message: "Nao consegui ler o JSON retornado pela IA.", raw: content };
  }
}

async function interpretWithOllama(payload) {
  const today = new Date().toISOString().slice(0, 10);
  const schema = agendaSchema();
  const prompt = [
    "Voce e um planejador pessoal em portugues do Brasil.",
    "Interprete a mensagem e separe em entradas de agenda e relatos.",
    "Crie tarefas acionaveis, compromissos com data quando houver, rotinas recorrentes e metas.",
    "Regra critica de datas: preserve TODA data explicita do usuario exatamente no item correspondente.",
    "Nao mova compromissos, exames, consultas, prazos ou tarefas com data futura para a semana atual.",
    "Se houver varias datas no texto, crie varios itens separados, cada um com a sua propria data ISO.",
    "Use date null somente quando o usuario nao informou data nem prazo.",
    "Use time null somente quando o usuario nao informou horario.",
    "Use datas ISO yyyy-mm-dd. Hoje e " + today + ".",
    "Datas relativas como 'daqui 4 meses', 'amanha' e 'semana que vem' devem ser calculadas a partir de hoje.",
    "Para tarefas com prazo futuro, mantenha date como o prazo e type task, a menos que seja consulta/reuniao/evento, nesse caso use event.",
    "Quando o texto mencionar entrega, prazo ou submissao de relatorio, trabalho, prova, projeto, documento ou atividade academica, interprete como algo que o usuario precisa PRODUZIR antes da data, nao apenas entregar.",
    "Nesses casos, crie tarefas de preparacao acionaveis como pesquisar/rascunhar/escrever/revisar/coletar assinatura/enviar, com duracoes realistas de 45 a 120 minutos cada.",
    "Quando o usuario mencionar prova, exame, avaliacao ou teste, crie blocos de estudo antes da data: mapear conteudo, estudar teoria, resolver exercicios, simulado/lista dificil e revisao final.",
    "A prova em si deve ser um evento separado na data informada; os estudos devem ser tarefas antes da prova, divididas em varios dias quando houver tempo.",
    "Se o usuario disser que a prova/tarefa e dificil, aumente a prioridade e estime varias horas totais de preparacao.",
    "A data do item principal deve ser o prazo final; nao use duracao curta como 15 minutos para produzir relatorios ou trabalhos.",
    "Use 15 minutos somente para microtarefas simples como enviar mensagem, confirmar horario, pagar conta ou assinar algo rapido.",
    "Para metas longas, use type goal e date somente se o usuario informou um prazo real.",
    "Para rotinas, use date null e preencha preferredDays quando houver dias da semana.",
    "Prioridade: 3 alta, 2 media, 1 baixa.",
    "preferredDays usa segunda=0, terca=1, quarta=2, quinta=3, sexta=4, sabado=5, domingo=6.",
    "Nao invente datas desta semana para itens sem data; deixe null.",
    "Responda somente JSON valido, sem markdown, no formato deste schema:",
    JSON.stringify(schema),
    "Modo escolhido pelo usuario: " + payload.mode,
    "Mensagem: " + payload.message
  ].join("\n");

  const headers = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  try {
    const models = [...new Set([OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL].filter(Boolean))];
    const errors = [];
    for (const model of models) {
      const result = await callOllamaModel({ model, prompt, schema, headers });
      if (result.ok) return { mode: "ai", provider: "ollama", model, ...result.parsed };
      errors.push(`${model}: ${result.error}`);
    }
    return {
      mode: "local",
      provider: "ollama",
      message: `Nao consegui usar os modelos Ollama configurados. ${errors.join(" | ")}`
    };
  } catch (error) {
    return {
      mode: "local",
      provider: "ollama",
      message: `Nao consegui conectar ao Ollama em ${OLLAMA_HOST}. ${error.message}`
    };
  }
}

async function callOllamaModel({ model, prompt, schema, headers }) {
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    options: { temperature: 0 }
  };

  const canUseSchema = !OLLAMA_HOST.includes("ollama.com") && !model.includes("-cloud");
  body.format = canUseSchema ? schema : "json";

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}: ${await response.text()}` };
  }

  const data = await response.json();
  return { ok: true, parsed: parseJsonFromModel(data.message?.content || "") };
}

function agendaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      entries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["task", "event", "routine", "goal"] },
            text: { type: "string" },
            date: { anyOf: [{ type: "string" }, { type: "null" }] },
            time: { anyOf: [{ type: "string" }, { type: "null" }] },
            duration: { type: "number" },
            priority: { type: "number" },
            preferredDays: { type: "array", items: { type: "number" } }
          },
          required: ["type", "text", "date", "time", "duration", "priority", "preferredDays"]
        }
      },
      reports: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string" },
            mood: { anyOf: [{ type: "string" }, { type: "null" }] },
            blockers: { type: "array", items: { type: "string" } }
          },
          required: ["text", "mood", "blockers"]
        }
      }
    },
    required: ["summary", "entries", "reports"]
  };
}

function parseJsonFromModel(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("O modelo nao retornou JSON valido.");
  }
}

function extractResponseText(data) {
  const parts = data.output?.flatMap(item => item.content || []) || [];
  const textPart = parts.find(part => part.type === "output_text" || part.text);
  return textPart?.text || "";
}

function readJson(req) {
  return new Promise(resolve => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

function send(res, status, body, type = "text/plain;charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store, max-age=0"
  });
  res.end(body);
}

module.exports = { loadAgendaData, mergeAgendaData };
