const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b-cloud";
const OLLAMA_FALLBACK_MODEL = process.env.OLLAMA_FALLBACK_MODEL || "";
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
const Planner = require("./planner-core");

async function interpretWithOllama(payload) {
  const today = Planner.dateKey(new Date());
  const schema = agendaSchema();
  const prompt = [
    "Voce e o motor de planejamento adaptativo de um assistente pessoal em portugues do Brasil.",
    "Seja conservador: voce propoe mudancas, nao toma decisoes irreversiveis. Quando houver duvida material, faca uma pergunta curta em summary e nao invente um dado.",
    "Seu trabalho e transformar objetivos em planos executaveis, encaixar etapas na rotina e adaptar o plano com feedback real.",
    "Diferencie: goal = resultado de longo prazo; task = proxima acao concreta; routine = comportamento recorrente; event = compromisso fixo.",
    "Quando houver um objetivo complexo, crie ou atualize uma meta em goals e produza de 6 a 12 etapas acionaveis em entries ligadas pelo mesmo goalRef.",
    "Crie no maximo uma meta nova por mensagem, exceto quando o usuario pedir explicitamente varias metas. Nunca altere uma meta existente em goals sem usar o id dela em ref.",
    "Um plano de longo prazo deve ter de 3 a 6 marcos nomeados. Cada entry deve indicar milestone, planOrder, instructions com 2 a 5 passos praticos e completionCriteria observavel.",
    "Regra obrigatoria: use no maximo 6 valores unicos de milestone e repita o mesmo nome nas etapas do mesmo marco; milestone nao e sinonimo de tarefa.",
    "A estrategia da meta deve explicar a sequencia escolhida, os pressupostos e como o plano sera revisado. successCriteria deve listar resultados verificaveis e weeklyMinutes deve definir uma carga semanal sustentavel.",
    "Nao use orientacoes vagas como apenas estudar ou praticar. Nomeie conteudos, habilidades, exercicios, entregaveis e evidencias concretas de dominio.",
    "Cada task precisa de um verbo de acao, uma estimativa realista e, quando fizer parte de uma meta, uma instrucao e criterio de conclusao concretos. Se nao puder especificar, nao crie a etapa.",
    "duration e a estimativa TOTAL da etapa em minutos, incluindo pausas. Etapas complexas podem exigir 240, 600 ou mais minutos. O motor dividira automaticamente em sessoes de ate 120 minutos ao longo de varios dias.",
    "Nao trate concluir etapas como prova de que a meta foi atingida. Metas so sao concluidas por confirmacao explicita.",
    "Nao invente data ou horario de prova/consulta desconhecido. Deixe null e faca a pergunta em summary. Declare pressupostos de nivel, prazo e esforco em summary.",
    "Uma revisao de tarefa existente deve usar updates com ID; nunca crie uma substituta sem uma exclusao explicitamente solicitada. Preserve dados e rotinas nao mencionados.",
    "Para feedback sobre so uma ocorrencia de rotina, use scope occurrence e occurrenceDate YYYY-MM-DD. complete em rotina refere-se so ao dia relatado, nunca a serie inteira.",
    "Para tarefas parcialmente cumpridas, nao use complete. Use adjust_duration com o esforco TOTAL revisado, mantendo o tempo ja concluido no contexto; explique a mudanca.",
    "planOrder determina sequencia de etapas na mesma meta. Distribua aprendizado e pratica por semanas com estimativas honestas, nao finja que alguem aprendera programacao em seis horas.",
    "Sem uma data de inicio informada, comece as proximas acoes no proximo dia disponivel. Nao deixe semanas vazias sem uma razao explicita.",
    "Use deadline para prazo final. Use date/time apenas quando o bloco ja deve acontecer em dia/horario especifico.",
    "Regra critica de datas: preserve TODA data explicita do usuario exatamente no item correspondente.",
    "Nao mova compromissos, exames, consultas, prazos ou tarefas com data futura para a semana atual.",
    "Se houver varias datas no texto, crie varios itens separados, cada um com a sua propria data ISO.",
    "Use date null somente quando o usuario nao informou data nem prazo.",
    "Use time null somente quando o usuario nao informou horario.",
    "Use datas ISO yyyy-mm-dd. Hoje e " + today + ".",
    "Datas relativas como 'daqui 4 meses', 'amanha' e 'semana que vem' devem ser calculadas a partir de hoje.",
    "Para tarefas com prazo futuro, use deadline; nao coloque o prazo em date. Consulta/reuniao/prova usa event com date.",
    "Quando o texto mencionar entrega, prazo ou submissao de relatorio, trabalho, prova, projeto, documento ou atividade academica, interprete como algo que o usuario precisa PRODUZIR antes da data, nao apenas entregar.",
    "Nesses casos, crie tarefas de preparacao acionaveis como pesquisar/rascunhar/escrever/revisar/coletar assinatura/enviar, com duracoes realistas de 45 a 120 minutos cada.",
    "Quando o usuario mencionar prova, exame, avaliacao ou teste, crie blocos de estudo antes da data: mapear conteudo, estudar teoria, resolver exercicios, simulado/lista dificil e revisao final.",
    "A prova em si deve ser um evento separado na data informada; os estudos devem ser tarefas antes da prova, divididas em varios dias quando houver tempo.",
    "Se o usuario disser que a prova/tarefa e dificil, aumente a prioridade e estime varias horas totais de preparacao.",
    "O prazo de producao vai em deadline; date e apenas uma data de execucao explicitamente combinada. Preparacao deve terminar ANTES da data de prova ou entrega.",
    "Use 15 minutos somente para microtarefas simples como enviar mensagem, confirmar horario, pagar conta ou assinar algo rapido.",
    "Para metas longas, crie goal com targetDate e vincule todas as etapas por goalRef. Nao crie uma entry type goal.",
    "Ao continuar uma meta do contexto, use em goalRef o id dessa meta existente. Ao criar meta nova, use o ref retornado em goals.",
    "Se intent for goal_plan, trabalhe somente na meta indicada por planningGoalId: preserve etapas validas, use updates para revisa-las e crie entries apenas para lacunas reais. Nunca duplique uma etapa existente.",
    "Para uma meta de emprego em programacao, adapte ao nivel e cargo desejado e cubra, quando relevante: linguagem principal, logica e estruturas de dados, Git, banco de dados, HTTP/APIs, testes, framework, projeto de portfolio, curriculo/GitHub, entrevistas e candidaturas.",
    "Se nivel, stack ou cargo ainda forem desconhecidos, a primeira etapa deve diagnosticar o nivel e escolher um alvo; nao invente uma especializacao silenciosamente.",
    "Para rotinas, use date null e preencha preferredDays quando houver dias da semana.",
    "Horarios pedidos pelo usuario sao fixos. 'Das 6 as 7 da noite' significa time 18:00 e duration 60; nunca interprete como 06:00.",
    "Em entries, marque timeLocked true somente quando o usuario informou ou confirmou explicitamente aquele horario. Horarios que voce sugeriu para encaixe devem usar timeLocked false.",
    "Considere o calendario existente antes de sugerir horario. Nao devolva dois itens que ocupem o mesmo intervalo; mantenha compromissos e horarios confirmados e mova apenas itens flexiveis.",
    "Quando o usuario pedir para corrigir, alterar, editar, mudar, apagar, excluir ou remover algo existente, use updates com o entryId do contexto. Nao crie uma nova entry para substituir a antiga.",
    "Use action edit para mudar titulo, tipo, data, horario, prazo, duracao, prioridade ou dias recorrentes. Use action delete apenas quando o usuario pedir explicitamente para excluir/apagar/remover.",
    "Uma correcao pode alterar varios itens existentes. Retorne um update separado para cada item afetado e explique cada mudanca em reason.",
    "Se mode for report, interprete o que foi feito, o que falhou e por que. Use updates para concluir, reagendar, ajustar duracao ou pausar tarefas existentes. Nao repita em entries uma tarefa existente que ja recebeu update.",
    "Nunca apague uma meta por causa de um dia ruim. Reduza carga, reagende e preserve o caminho para o objetivo.",
    "Use o contexto atual abaixo para referenciar entryId existente em updates. Se nao houver correspondencia segura, nao invente ID.",
    "Limite a resposta a 12 novas etapas, 8 atualizacoes e 1 relato. Prefira uma proposta menor e precisa a uma lista grande e duvidosa.",
    "Prioridade: 3 alta, 2 media, 1 baixa.",
    "preferredDays usa segunda=0, terca=1, quarta=2, quinta=3, sexta=4, sabado=5, domingo=6.",
    "Nao invente datas desta semana para itens sem data; deixe null.",
    "Responda somente JSON valido, sem markdown, no formato deste schema:",
    JSON.stringify(schema),
    "Contexto atual (pode estar vazio): " + JSON.stringify(payload.context || {}),
    "Modo escolhido pelo usuario: " + payload.mode,
    "Intencao estruturada: " + (payload.intent || "message"),
    "Meta selecionada: " + (payload.planningGoalId || "nenhuma"),
    "Mensagem: " + payload.message
  ].join("\n");

  const headers = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  try {
    const models = [...new Set([OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL].filter(Boolean))];
    const errors = [];
    for (const model of models) {
      const result = await callOllamaModel({ model, prompt, schema, headers });
      if (result.ok) return { mode: "ai", provider: "ollama", model, ...guardProposal(result.parsed, payload) };
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
  try {
    const body = { model, messages: [{ role: "user", content: prompt }], stream: false, options: { temperature: 0 } };
    if (!model.includes("cloud") && !OLLAMA_HOST.includes("ollama.com")) body.format = schema;
    const response = await fetch(OLLAMA_HOST + "/api/chat", { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!response.ok) return { ok: false, error: "HTTP " + response.status + ". Verifique o modelo e o login no Ollama." };
    const data = await response.json();
    const parsed = parseJsonFromModel(data.message?.content || "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Resposta JSON invalida.");
    for (const field of ["goals", "entries", "reports", "updates"]) if (parsed[field] !== undefined && !Array.isArray(parsed[field])) throw new Error("Resposta invalida: " + field);
    return { ok: true, parsed };
  } catch (error) { return { ok: false, error: error.name === "TimeoutError" ? "Tempo limite de 90 segundos." : error.message }; }
}

function agendaSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      goals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            strategy: { type: "string" },
            successCriteria: { type: "array", items: { type: "string" } },
            weeklyMinutes: { type: "number" },
            targetDate: { anyOf: [{ type: "string" }, { type: "null" }] },
            priority: { type: "number" },
            status: { type: "string", enum: ["active", "paused", "completed"] }
          },
          required: ["ref", "title", "description", "strategy", "successCriteria", "weeklyMinutes", "targetDate", "priority", "status"]
        }
      },
      entries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["task", "event", "routine"] },
            text: { type: "string" },
            date: { anyOf: [{ type: "string" }, { type: "null" }] },
            time: { anyOf: [{ type: "string" }, { type: "null" }] },
            deadline: { anyOf: [{ type: "string" }, { type: "null" }] },
            duration: { type: "number" },
            priority: { type: "number" },
            preferredDays: { type: "array", items: { type: "number" } },
            timeLocked: { type: "boolean" },
            goalRef: { anyOf: [{ type: "string" }, { type: "null" }] },
            phase: { anyOf: [{ type: "string" }, { type: "null" }] },
            milestone: { anyOf: [{ type: "string" }, { type: "null" }] },
            instructions: { type: "array", items: { type: "string" } },
            completionCriteria: { anyOf: [{ type: "string" }, { type: "null" }] },
            planOrder: { type: "number" },
            status: { type: "string", enum: ["pending", "active", "paused", "completed"] }
          },
          required: ["type", "text", "date", "time", "deadline", "duration", "priority", "preferredDays", "timeLocked", "goalRef", "phase", "milestone", "instructions", "completionCriteria", "planOrder", "status"]
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
      },
      updates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            scope: { type: "string", enum: ["all", "occurrence"] },
            occurrenceDate: { type: ["string", "null"] },
            entryId: { anyOf: [{ type: "string" }, { type: "null" }] },
            action: { type: "string", enum: ["complete", "reschedule", "adjust_duration", "pause", "resume", "edit", "delete"] },
            newText: { anyOf: [{ type: "string" }, { type: "null" }] },
            newType: { anyOf: [{ type: "string", enum: ["task", "event", "routine"] }, { type: "null" }] },
            newDate: { anyOf: [{ type: "string" }, { type: "null" }] },
            newTime: { anyOf: [{ type: "string" }, { type: "null" }] },
            newDeadline: { anyOf: [{ type: "string" }, { type: "null" }] },
            duration: { anyOf: [{ type: "number" }, { type: "null" }] },
            newPriority: { anyOf: [{ type: "number" }, { type: "null" }] },
            newPreferredDays: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] },
            newInstructions: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            newMilestone: { anyOf: [{ type: "string" }, { type: "null" }] },
            newCompletionCriteria: { anyOf: [{ type: "string" }, { type: "null" }] },
            newPlanOrder: { anyOf: [{ type: "number" }, { type: "null" }] },
            reason: { type: "string" }
          },
          required: ["entryId", "action", "newText", "newType", "newDate", "newTime", "newDeadline", "duration", "newPriority", "newPreferredDays", "newInstructions", "newMilestone", "newCompletionCriteria", "newPlanOrder", "reason"]
        }
      }
    },
    required: ["summary", "goals", "entries", "reports", "updates"]
  };
}

function guardProposal(raw, payload) {
  const proposal = {
    summary: String(raw.summary || "").slice(0, 1500),
    goals: Array.isArray(raw.goals) ? raw.goals.slice(0, 1) : [],
    entries: Array.isArray(raw.entries) ? raw.entries.slice(0, 12) : [],
    reports: Array.isArray(raw.reports) ? raw.reports.slice(0, 1) : [],
    updates: Array.isArray(raw.updates) ? raw.updates.slice(0, 8) : []
  };
  const existingGoalIds = new Set((payload.context?.goals || []).map(goal => goal.id));
  const existingEntryIds = new Set((payload.context?.entries || []).map(entry => entry.id));
  for (const goal of proposal.goals) {
    if (!String(goal.title || "").trim()) throw new Error("A IA retornou uma meta sem titulo.");
    if (existingGoalIds.has(goal.ref) || existingGoalIds.has(goal.id)) continue;
    const sameTitle = (payload.context?.goals || []).some(item => String(item.title || "").trim().toLowerCase() === String(goal.title || "").trim().toLowerCase());
    if (sameTitle) throw new Error("A IA tentou recriar uma meta existente sem referenciar seu ID.");
  }
  for (const update of proposal.updates) {
    if (!existingEntryIds.has(update.entryId)) throw new Error("A IA tentou editar um item fora do contexto atual.");
    if (!String(update.reason || "").trim()) throw new Error("A IA precisa explicar cada alteracao proposta.");
  }
  for (const entry of proposal.entries) {
    if (!String(entry.text || "").trim()) throw new Error("A IA retornou uma etapa sem titulo.");
    if (entry.type === "task" && entry.goalRef && (!Array.isArray(entry.instructions) || !entry.instructions.length || !String(entry.completionCriteria || "").trim())) {
      throw new Error("A IA retornou uma etapa de meta sem instrucoes ou criterio de conclusao.");
    }
  }
  return proposal;
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
module.exports = { interpret: interpretWithOllama, guardProposal, agendaSchema };
