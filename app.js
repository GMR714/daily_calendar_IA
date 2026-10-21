const STORAGE_KEY = "smart-week-planner-v1";
const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const defaultState = { entries: [], reports: [], plan: [], alarmFired: [], projects: [], opens: [] };
const OBSIDIAN_VAULT = "Obsidian Vault";
let mediaRecorder = null;
let audioChunks = [];
let speechRecognition = null;
let alarmInterval = null;
let alarmsEnabled = false;
let inputMode = "auto";
let weekOffset = 0;
let calendarView = "week";
let monthCursor = startOfMonth(new Date());
const state = loadState();

const el = {
  quickMessage: document.querySelector("#quickMessage"),
  addQuickEntry: document.querySelector("#addQuickEntry"),
  voiceMessage: document.querySelector("#voiceMessage"),
  interpretationPreview: document.querySelector("#interpretationPreview"),
  modeButtons: document.querySelectorAll("[data-mode]"),
  quickExamples: document.querySelectorAll("[data-example]"),
  prevWeek: document.querySelector("#prevWeek"),
  todayWeek: document.querySelector("#todayWeek"),
  nextWeek: document.querySelector("#nextWeek"),
  toggleCalendarView: document.querySelector("#toggleCalendarView"),
  generatePlan: document.querySelector("#generatePlan"),
  enableAlarms: document.querySelector("#enableAlarms"),
  exportIcs: document.querySelector("#exportIcs"),
  clearData: document.querySelector("#clearData"),
  weekGrid: document.querySelector("#weekGrid"),
  entriesList: document.querySelector("#entriesList"),
  weekTitle: document.querySelector("#weekTitle"),
  calendarEyebrow: document.querySelector("#calendarEyebrow"),
  focusTitle: document.querySelector("#focusTitle"),
  focusDetail: document.querySelector("#focusDetail"),
  focusTimer: document.querySelector("#focusTimer"),
  alarmStatus: document.querySelector("#alarmStatus"),
  statGoals: document.querySelector("#statGoals"),
  statItems: document.querySelector("#statItems"),
  statReports: document.querySelector("#statReports"),
  statFocus: document.querySelector("#statFocus"),
  todayAgenda: document.querySelector("#todayAgenda"),
  deadlineList: document.querySelector("#deadlineList"),
  checklist: document.querySelector("#checklist"),
  checklistMetrics: document.querySelector("#checklistMetrics")
};

on(el.addQuickEntry, "click", addQuickEntry);
on(el.quickMessage, "input", updateInterpretationPreview);
on(el.quickMessage, "keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) addQuickEntry();
});
on(el.voiceMessage, "click", toggleVoiceMessage);
on(el.generatePlan, "click", generatePlan);
on(el.enableAlarms, "click", enableAlarms);
on(el.exportIcs, "click", exportIcs);
on(el.clearData, "click", clearData);
on(el.prevWeek, "click", () => changeWeek(-1));
on(el.todayWeek, "click", () => {
  if (calendarView === "month") monthCursor = startOfMonth(new Date());
  else weekOffset = 0;
  generatePlan();
});
on(el.nextWeek, "click", () => changeWeek(1));
on(el.toggleCalendarView, "click", toggleCalendarView);
el.modeButtons.forEach(button => {
  on(button, "click", () => setInputMode(button.dataset.mode));
});
el.quickExamples.forEach(button => {
  on(button, "click", () => useQuickExample(button));
});
on(el.checklist, "click", handleChecklistClick);
on(el.checklist, "change", handleChecklistChange);
state.opens = window.Checklist.recordOpen(state.opens, todayKey());
persist();
render();
updateInterpretationPreview();
tickAlarms();
syncFromServer();

function on(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...structuredClone(defaultState), ...JSON.parse(raw) } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncToServer();
}

async function syncFromServer() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) return;
    const data = await response.json();
    const before = state.entries.length + state.reports.length;
    state.entries = mergeItems(state.entries, data.entries);
    state.reports = mergeItems(state.reports, data.reports);
    state.projects = mergeItems(state.projects, data.projects);
    state.opens = Array.from(new Set([...state.opens, ...(data.opens || [])])).sort();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const after = state.entries.length + state.reports.length;
    if (after !== before) generatePlan();
    else renderChecklist();
  } catch {
    // App still works offline/local-only.
  }
}

async function syncToServer() {
  try {
    await fetch("/api/state/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: state.entries, reports: state.reports, projects: state.projects, opens: state.opens })
    });
  } catch {
    // Keep local state if the server is unavailable.
  }
}

function mergeItems(current = [], incoming = []) {
  return window.AgendaMerge.mergeById(current, incoming);
}

// Tarefas vindas da rodada diária (source "sync") vivem no checklist, não na semana.
function agendaEntries() {
  return state.entries.filter(entry => entry.source !== "sync");
}

function setInputMode(mode) {
  inputMode = mode;
  el.modeButtons.forEach(button => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  updateInterpretationPreview();
}

function useQuickExample(button) {
  if (!el.quickMessage) return;
  setInputMode(button.dataset.exampleMode || "auto");
  el.quickMessage.value = button.dataset.example || "";
  updateInterpretationPreview();
  el.quickMessage.focus();
}

function changeWeek(delta) {
  if (calendarView === "month") {
    monthCursor = addMonths(monthCursor, delta);
  } else {
    weekOffset += delta;
  }
  generatePlan();
}

function toggleCalendarView() {
  calendarView = calendarView === "week" ? "month" : "week";
  if (calendarView === "month") monthCursor = startOfMonth(getVisibleWeekStart());
  generatePlan();
}

async function enableAlarms() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission();
  }
  alarmsEnabled = true;
  if (el.enableAlarms) el.enableAlarms.textContent = "Alarmes ativos";
  if (el.alarmStatus) el.alarmStatus.textContent = notificationAllowed() ? "Notificacoes ativas" : "Som e painel ativos";
  playAlarmSound(0.04);
  if (!alarmInterval) alarmInterval = window.setInterval(tickAlarms, 15000);
  tickAlarms();
}

async function addQuickEntry() {
  if (!el.quickMessage) return;
  const text = el.quickMessage.value.trim();
  if (!text) return;
  setWorkingState(true);
  const aiResult = await interpretWithServer(text);
  if (aiResult?.mode === "ai") {
    applyAiInterpretation(aiResult);
  } else {
    applyLocalInterpretation(text);
    showLocalMode(aiResult);
  }
  el.quickMessage.value = "";
  persist();
  generatePlan();
  setWorkingState(false);
}

async function interpretWithServer(text) {
  try {
    const response = await fetch("/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: inputMode,
        message: text,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    });
    if (!response.ok) return { mode: "error", message: `Servidor respondeu ${response.status}` };
    return response.json();
  } catch (error) {
    return { mode: "error", message: error.message };
  }
}

function applyAiInterpretation(result) {
  const createdAt = new Date().toISOString();
  const hasExecutionPlan = result.entries.some(entry => isAcademicPrepTask(entry.text));
  result.entries.forEach(entry => {
    expandEntry(entry, { hasExecutionPlan }).forEach(expanded => state.entries.push({
      id: crypto.randomUUID(),
      type: expanded.type,
      text: expanded.text,
      date: expanded.date,
      time: expanded.time,
      duration: normalizeDuration(expanded.duration, expanded.text),
      priority: Math.min(3, Math.max(1, Number(expanded.priority || 2))),
      preferredDays: Array.isArray(expanded.preferredDays) ? expanded.preferredDays : [],
      createdAt
    }));
  });
  result.reports.forEach(report => {
    state.reports.push({
      id: crypto.randomUUID(),
      text: report.text,
      mood: report.mood,
      blockers: report.blockers,
      source: "ai",
      createdAt
    });
  });
  if (result.reports.length) adaptFromReports();
  showAiResult(result);
}

function expandEntry(entry, context = {}) {
  if (context.hasExecutionPlan && (isExamEntry(entry) || isAcademicDeliverable(entry.text))) {
    return [entry];
  }
  if (isExamEntry(entry)) return expandExamEntry(entry);
  if (!isAcademicDeliverable(entry.text)) return [moveAcademicPrepBeforeDue(entry)];

  const dueDate = entry.date;
  const base = {
    type: "task",
    date: null,
    time: null,
    priority: Math.max(2, Number(entry.priority || 2)),
    preferredDays: []
  };

  const tasks = [
    { ...base, text: `Planejar estrutura - ${entry.text}`, duration: 45 },
    { ...base, text: `Escrever rascunho - ${entry.text}`, duration: 90 },
    { ...base, text: `Revisar e finalizar - ${entry.text}`, duration: 60 },
    { ...base, text: `Coletar assinatura e preparar envio - ${entry.text}`, duration: 30 }
  ];

  if (dueDate) {
    return tasks.map((task, index) => ({
      ...task,
      date: toInputDate(addDays(new Date(`${dueDate}T12:00`), index - tasks.length)),
      priority: index === tasks.length - 1 ? 3 : task.priority
    })).concat({
      ...entry,
      type: "event",
      text: `Prazo final - ${entry.text}`,
      duration: 30,
      priority: 3
    });
  }

  return tasks;
}

function expandExamEntry(entry) {
  const dueDate = entry.date;
  const priority = Math.max(3, Number(entry.priority || 2));
  const base = {
    type: "task",
    date: null,
    time: null,
    priority,
    preferredDays: []
  };
  const tasks = [
    { ...base, text: `Mapear conteudo e montar plano de estudo - ${entry.text}`, duration: 60 },
    { ...base, text: `Estudar teoria principal - ${entry.text}`, duration: 120 },
    { ...base, text: `Resolver exercicios - ${entry.text}`, duration: 120 },
    { ...base, text: `Fazer simulado ou lista dificil - ${entry.text}`, duration: 120 },
    { ...base, text: `Revisao final e pontos fracos - ${entry.text}`, duration: 90 }
  ];

  if (!dueDate) return tasks;

  const due = new Date(`${dueDate}T12:00`);
  const offsets = [-6, -5, -4, -2, -1];
  return tasks.map((task, index) => ({
    ...task,
    date: toInputDate(addDays(due, offsets[index]))
  })).concat({
    ...entry,
    type: "event",
    text: `Prova - ${entry.text.replace(/^prova\s*-\s*/i, "")}`,
    duration: Math.max(90, normalizeDuration(entry.duration, entry.text)),
    priority: 3,
    preferredDays: []
  });
}

function isExamEntry(entry) {
  return /\b(prova|exame|avaliacao|avaliação|teste)\b/i.test(entry.text) && !isAcademicPrepTask(entry.text);
}

function isAcademicDeliverable(text) {
  return /\b(entrega|prazo|submissao|submissão)\b/i.test(text)
    && /\b(relatorio|relatório|trabalho|projeto|atividade|tcc|documento)\b/i.test(text)
    && !isAcademicPrepTask(text);
}

function isAcademicPrepTask(text) {
  return /\b(mapear|pesquisar|revisar|rascunhar|escrever|formatar|finalizar|coletar assinatura|agendar assinatura|preparar envio|estudar|resolver exercicios|resolver exercícios|simulado|lista dificil|lista difícil|pontos fracos|plano de estudo)\b/i.test(text);
}

function moveAcademicPrepBeforeDue(entry) {
  if (!entry.date || !isAcademicPrepTask(entry.text)) return entry;
  const lower = normalizeText(entry.text);
  let offset = -2;
  if (lower.includes("pesquisar") || lower.includes("revisar conteudo")) offset = -5;
  if (lower.includes("rascunhar") || lower.includes("escrever")) offset = -4;
  if (lower.includes("formatar") || lower.includes("finalizar") || lower.includes("revisar")) offset = -2;
  if (lower.includes("assinatura") || lower.includes("envio")) offset = -1;
  if (lower.includes("plano de estudo")) offset = -6;
  if (lower.includes("estudar")) offset = -5;
  if (lower.includes("exercicios") || lower.includes("exercícios")) offset = -4;
  if (lower.includes("simulado") || lower.includes("lista dificil") || lower.includes("lista difícil")) offset = -2;
  return { ...entry, date: toInputDate(addDays(new Date(`${entry.date}T12:00`), offset)) };
}

function normalizeDuration(value, text = "") {
  if ((isAcademicDeliverable(text) || isAcademicPrepTask(text)) && Number(value) < 45) return 60;
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 60;
  return Math.max(15, Math.round(duration / 15) * 15);
}

function applyLocalInterpretation(text) {
  const interpreted = interpretMessage(text);
  if (interpreted.intent === "report") {
    state.reports.push({ id: crypto.randomUUID(), text: interpreted.text, source: "message", createdAt: new Date().toISOString() });
    adaptFromReports();
  } else {
    const { intent, ...entry } = interpreted;
    state.entries.push({ id: crypto.randomUUID(), ...entry, createdAt: new Date().toISOString() });
  }
}

function setWorkingState(isWorking) {
  if (el.addQuickEntry) {
    el.addQuickEntry.disabled = isWorking;
    el.addQuickEntry.textContent = isWorking ? "Pensando..." : "Enviar";
  }
  if (isWorking && el.interpretationPreview) {
    el.interpretationPreview.innerHTML = `
      <strong>Pensando com IA</strong>
      <p>Estou separando tarefas, compromissos, rotinas, metas e relatos do seu texto.</p>
    `;
  }
}

function showAiResult(result) {
  if (!el.interpretationPreview) return;
  const entryPreview = result.entries.slice(0, 5).map(entry => `
    <li>${escapeHtml(labelFor(entry.type))}: ${escapeHtml(entry.text)}${entry.date ? ` (${escapeHtml(entry.date)})` : ""}</li>
  `).join("");
  el.interpretationPreview.innerHTML = `
    <strong>Organizado com IA</strong>
    <p>${escapeHtml(result.summary || "Separei sua mensagem em itens praticos.")}</p>
    <div class="preview-tags">
      <span>${result.entries.length} tarefa(s)</span>
      <span>${result.reports.length} relato(s)</span>
    </div>
    ${entryPreview ? `<ul class="result-list">${entryPreview}</ul>` : ""}
  `;
}

function showLocalMode(result) {
  if (!el.interpretationPreview) return;
  el.interpretationPreview.innerHTML = `
    <strong>Modo local usado</strong>
    <p>${escapeHtml(result?.message || "A IA nao respondeu, entao usei a interpretacao simples do navegador.")}</p>
  `;
}

function updateInterpretationPreview() {
  if (!el.quickMessage || !el.interpretationPreview) return;
  const text = el.quickMessage.value.trim();
  if (!text) {
    el.interpretationPreview.innerHTML = `
      <strong>Como vou entender</strong>
      <p>Vou decidir se sua mensagem e tarefa, compromisso, rotina, meta ou relato do dia.</p>
    `;
    return;
  }

  const entry = interpretMessage(text);
  if (entry.intent === "report") {
    el.interpretationPreview.innerHTML = `
      <strong>Relato do dia detectado</strong>
      <p>${escapeHtml(entry.text)}</p>
      <div class="preview-tags">
        <span>salva historico</span>
        <span>ajusta planejamento</span>
      </div>
    `;
    return;
  }

  const missing = [];
  if (!entry.date && entry.type === "event") missing.push("sem data: vou tratar como tarefa flexivel");
  if (!entry.time && entry.date) missing.push("sem hora: vou usar 09:00");
  if (!hasDuration(text)) missing.push(`duracao padrao: ${entry.duration} min`);

  el.interpretationPreview.innerHTML = `
    <strong>${labelFor(entry.type)} detectado</strong>
    <p>${escapeHtml(entry.text)}</p>
    <div class="preview-tags">
      <span>${entry.date || "sem data fixa"}</span>
      <span>${entry.time || (entry.date ? "09:00" : "horario automatico")}</span>
      <span>${entry.duration} min</span>
      <span>prioridade ${entry.priority}</span>
    </div>
    ${missing.length ? `<p class="muted">${missing.join(" · ")}</p>` : ""}
  `;
}

function toggleVoiceMessage() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    el.interpretationPreview.innerHTML = `
      <strong>Audio indisponivel neste navegador</strong>
      <p>Use o campo de texto por enquanto. Quando plugarmos OpenAI/WhatsApp, o audio sera transcrito no servidor.</p>
    `;
    return;
  }

  if (speechRecognition) {
    speechRecognition.stop();
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "pt-BR";
  speechRecognition.interimResults = true;
  speechRecognition.continuous = false;
  el.voiceMessage.textContent = "Ouvindo...";

  speechRecognition.onresult = event => {
    const transcript = Array.from(event.results).map(result => result[0].transcript).join(" ");
    el.quickMessage.value = transcript;
    updateInterpretationPreview();
  };
  speechRecognition.onend = () => {
    speechRecognition = null;
    el.voiceMessage.textContent = "Audio";
  };
  speechRecognition.start();
}

function interpretMessage(text) {
  const lower = normalizeText(text);
  const intent = inputMode === "auto" ? inferIntent(lower) : inputMode;
  if (intent === "report") {
    return { intent, type: "report", text: cleanEntryText(text), date: null, time: null, duration: 0, priority: 2, preferredDays: [] };
  }
  const date = inferDate(lower);
  const time = inferTime(lower);
  const duration = inferDuration(lower);
  const type = inferType(lower, date);
  const priority = inferPriority(lower, type);
  const preferredDays = inferPreferredDays(lower);

  return {
    intent,
    type,
    text: cleanEntryText(text),
    date,
    time: time || (date ? "09:00" : null),
    duration,
    priority,
    preferredDays
  };
}

function inferIntent(lower) {
  const reportSignals = [
    "hoje fiz",
    "eu fiz",
    "nao consegui",
    "não consegui",
    "consegui fazer",
    "meu dia",
    "relato",
    "estava cansado",
    "fiquei cansado",
    "por causa",
    "porque"
  ].map(normalizeText);
  const hasReportSignal = reportSignals.some(signal => lower.includes(signal));
  const hasPastAction = /\b(fiz|consegui|falhei|terminei|adi(a|ei)|atras(ei|ou))\b/.test(lower);
  const hasSchedulingSignal = /\b(agendar|marcar|consulta|medico|reuniao|meta|objetivo|amanha|hoje as|daqui|seg|segunda|ter|quarta|quinta|sexta|sabado|domingo|\d+x)\b/.test(lower);
  if (hasReportSignal || (hasPastAction && !hasSchedulingSignal)) return "report";
  return "entry";
}

function inferType(lower, date) {
  if (/\b(meta|objetivo|longo prazo|ate o fim|ate final)\b/.test(lower)) return "goal";
  if (/\b(todo dia|diario|diaria|semanal|toda semana|seg|segunda|ter|terca|terça|qua|quarta|qui|quinta|sex|sexta|sab|sábado|sabado|dom|domingo|\d+x)\b/.test(lower)) return "routine";
  if (date || /\b(medico|médico|consulta|dentista|reuniao|reunião|exame|evento|aniversario|aniversário)\b/.test(lower)) return "event";
  return "task";
}

function inferPriority(lower, type) {
  if (/\b(urgente|importante|alta prioridade|prioridade alta|essencial)\b/.test(lower)) return 3;
  if (/\b(baixa prioridade|quando der|sem pressa)\b/.test(lower)) return 1;
  return type === "event" ? 3 : 2;
}

function inferDate(lower) {
  const today = new Date();
  if (/\bhoje\b/.test(lower)) return toInputDate(today);
  if (/\bamanha|amanhã\b/.test(lower)) return toInputDate(addDays(today, 1));
  if (/\bdepois de amanha|depois de amanhã\b/.test(lower)) return toInputDate(addDays(today, 2));

  const relative = lower.match(/daqui\s+(?:a\s+)?(\d+)\s+(dia|dias|semana|semanas|mes|meses|mês|meses)/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const date = new Date(today);
    if (unit.startsWith("dia")) date.setDate(date.getDate() + amount);
    if (unit.startsWith("semana")) date.setDate(date.getDate() + amount * 7);
    if (unit.startsWith("mes") || unit.startsWith("mês")) date.setMonth(date.getMonth() + amount);
    return toInputDate(date);
  }

  const numeric = lower.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = numeric[3] ? normalizeYear(Number(numeric[3])) : today.getFullYear();
    const date = new Date(year, month, day);
    if (!numeric[3] && date < startOfDay(today)) date.setFullYear(date.getFullYear() + 1);
    return toInputDate(date);
  }

  const weekday = nextWeekday(lower, today);
  return weekday ? toInputDate(weekday) : null;
}

function inferTime(lower) {
  const explicit = lower.match(/\b(?:as|às|a\s+)?(\d{1,2})(?::|h)(\d{2})?\b/);
  if (!explicit) return null;
  const hour = Math.min(23, Number(explicit[1]));
  const minute = explicit[2] ? Math.min(59, Number(explicit[2])) : 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function inferDuration(lower) {
  const hourMatch = lower.match(/\b(?:por\s+)?(\d+(?:[,.]\d+)?)\s*(h|hora|horas)\b/);
  if (hourMatch) return Math.max(15, Math.round(Number(hourMatch[1].replace(",", ".")) * 60 / 15) * 15);
  const minuteMatch = lower.match(/\b(?:por\s+)?(\d+)\s*(min|minuto|minutos)\b/);
  if (minuteMatch) return Math.max(15, Math.round(Number(minuteMatch[1]) / 15) * 15);
  return 60;
}

function hasDuration(text) {
  return /\b\d+(?:[,.]\d+)?\s*(h|hora|horas|min|minuto|minutos)\b/i.test(text);
}

function nextWeekday(lower, fromDate) {
  const names = [
    ["domingo", "dom"],
    ["segunda", "seg"],
    ["terca", "terça", "ter"],
    ["quarta", "qua"],
    ["quinta", "qui"],
    ["sexta", "sex"],
    ["sabado", "sábado", "sab"]
  ];
  const target = names.findIndex(options => options.some(name => lower.includes(name)));
  if (target < 0) return null;
  const date = new Date(fromDate);
  const distance = (target - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + distance);
  return date;
}

function normalizeText(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanEntryText(value) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeYear(year) {
  return year < 100 ? 2000 + year : year;
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saveReport() {
  const text = el.dailyReport.value.trim();
  if (!text && audioChunks.length === 0) return;
  state.reports.push({ id: crypto.randomUUID(), text, audioCount: audioChunks.length, createdAt: new Date().toISOString() });
  el.dailyReport.value = "";
  audioChunks = [];
  el.recordStatus.textContent = "Relato salvo. A proxima reorganizacao vai considerar esse historico.";
  adaptFromReports();
  persist();
  generatePlan();
}

async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    el.recordAudio.textContent = "Gravar audio";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    el.recordStatus.textContent = "Seu navegador nao liberou gravacao de audio.";
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];
  mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
  mediaRecorder.onstop = () => {
    stream.getTracks().forEach(track => track.stop());
    el.recordStatus.textContent = `Audio registrado em ${audioChunks.length} parte(s).`;
  };
  mediaRecorder.start();
  el.recordStatus.textContent = "Gravando...";
  el.recordAudio.textContent = "Parar";
}

function adaptFromReports() {
  const lastReport = state.reports.at(-1)?.text.toLowerCase() || "";
  const fatigueWords = ["cansado", "exausto", "sono", "ansioso", "atrasado", "correria"];
  if (!fatigueWords.some(word => lastReport.includes(word))) return;
  state.entries = state.entries.map(entry => {
    if (entry.type === "task" || entry.type === "goal") {
      return { ...entry, duration: Math.max(30, Math.round((entry.duration * 0.85) / 15) * 15) };
    }
    return entry;
  });
}

function generatePlan() {
  const weekStart = getVisibleWeekStart();
  const scheduled = [];
  const datedEntries = agendaEntries().filter(entry => entry.date);
  const fixedDatedEntries = datedEntries.filter(entry => entry.time || entry.type === "event");
  const floatingDatedEntries = datedEntries
    .filter(entry => !entry.time && entry.type !== "event")
    .sort((a, b) => new Date(a.date) - new Date(b.date) || b.priority - a.priority);
  const flexible = agendaEntries()
    .filter(entry => !entry.date)
    .sort((a, b) => b.priority - a.priority || typeWeight(b.type) - typeWeight(a.type));

  fixedDatedEntries.forEach(entry => {
    const date = new Date(`${entry.date}T${entry.time || "09:00"}`);
    if (isSameWeek(date, weekStart)) scheduled.push(blockFromEntry(entry, date));
  });

  const slots = buildSlots(weekStart, scheduled);
  floatingDatedEntries.forEach(entry => {
    const targetDate = new Date(`${entry.date}T12:00`);
    if (!isSameWeek(targetDate, weekStart)) return;
    const scheduleMinutes = productiveDuration(entry);
    const slot = slots.find(candidate => isSameDay(candidate.date, targetDate) && candidate.minutes >= scheduleMinutes);
    if (!slot) return;
    scheduled.push(blockFromEntry(entry, slot.date));
    slot.date = addMinutes(slot.date, scheduleMinutes + 15);
    slot.minutes -= scheduleMinutes + 15;
  });

  flexible.forEach(entry => {
    const preferredDays = Array.isArray(entry.preferredDays) ? entry.preferredDays : [];
    const occurrences = entry.type === "routine" ? Math.max(preferredDays.length, inferOccurrences(entry.text)) : entry.type === "goal" ? 2 : 1;
    for (let i = 0; i < occurrences; i += 1) {
      const preferredDay = preferredDays[i % preferredDays.length];
      const scheduleMinutes = productiveDuration(entry);
      const slot = slots.find(candidate => {
        const day = (candidate.date.getDay() + 6) % 7;
        return candidate.minutes >= scheduleMinutes && (preferredDay === undefined || preferredDay === day);
      }) || slots.find(candidate => candidate.minutes >= scheduleMinutes);
      if (!slot) break;
      scheduled.push(blockFromEntry(entry, slot.date));
      slot.date = addMinutes(slot.date, scheduleMinutes + 15);
      slot.minutes -= scheduleMinutes + 15;
    }
  });

  state.plan = scheduled.sort((a, b) => new Date(a.start) - new Date(b.start));
  pruneOldAlarms();
  persist();
  render();
}

function buildSlots(weekStart, scheduled) {
  const slots = [];
  for (let day = 0; day < 7; day += 1) {
    const base = addDays(weekStart, day);
    const isWeekend = day >= 5;
    const ranges = isWeekend ? [["10:00", "12:00"], ["15:00", "17:00"]] : [["08:00", "11:30"], ["14:00", "18:00"], ["19:30", "21:00"]];
    ranges.forEach(([start, end]) => {
      const startDate = withTime(base, start);
      const endDate = withTime(base, end);
      const hasConflict = scheduled.some(item => overlaps(startDate, endDate, new Date(item.start), new Date(item.end)));
      if (!hasConflict) slots.push({ date: startDate, minutes: diffMinutes(startDate, endDate) });
    });
  }
  return slots;
}

function blockFromEntry(entry, start) {
  const end = addMinutes(start, productiveDuration(entry));
  return {
    id: crypto.randomUUID(),
    entryId: entry.id,
    type: entry.type,
    title: entry.text,
    start: start.toISOString(),
    end: end.toISOString(),
    duration: productiveDuration(entry),
    pomodoros: buildPomodoros(start, productiveDuration(entry), entry.type)
  };
}

function productiveDuration(entry) {
  if (entry.type === "event") return entry.duration;
  if (entry.duration <= 30) return entry.duration;
  const focusBlocks = Math.ceil(entry.duration / 25);
  const breaks = Math.max(0, focusBlocks - 1) * 5;
  return entry.duration + breaks;
}

function buildPomodoros(start, totalMinutes, type) {
  if (type === "event" || totalMinutes <= 30) {
    return [{ kind: "focus", start: start.toISOString(), end: addMinutes(start, totalMinutes).toISOString() }];
  }

  const segments = [];
  let cursor = new Date(start);
  let remaining = totalMinutes;
  while (remaining > 0) {
    const focus = Math.min(25, remaining);
    segments.push({ kind: "focus", start: cursor.toISOString(), end: addMinutes(cursor, focus).toISOString() });
    cursor = addMinutes(cursor, focus);
    remaining -= focus;
    if (remaining > 5) {
      segments.push({ kind: "break", start: cursor.toISOString(), end: addMinutes(cursor, 5).toISOString() });
      cursor = addMinutes(cursor, 5);
      remaining -= 5;
    }
  }
  return segments;
}

function inferOccurrences(text) {
  const lower = text.toLowerCase();
  const explicit = lower.match(/(\d+)x|(\d+) vezes/);
  if (explicit) return Number(explicit[1] || explicit[2]);
  const dayMentions = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"].filter(day => lower.includes(day)).length;
  return Math.max(1, dayMentions || 3);
}

function inferPreferredDays(lower) {
  const dayMap = [
    ["seg", "segunda"],
    ["ter", "terca", "terça"],
    ["qua", "quarta"],
    ["qui", "quinta"],
    ["sex", "sexta"],
    ["sab", "sabado", "sábado"],
    ["dom", "domingo"]
  ];
  return dayMap.reduce((days, aliases, index) => {
    if (aliases.some(alias => lower.includes(alias))) days.push(index);
    return days;
  }, []);
}

function render() {
  const weekStart = getVisibleWeekStart();
  if (el.calendarEyebrow) el.calendarEyebrow.textContent = calendarView === "month" ? "Mes exibido" : "Semana exibida";
  if (el.toggleCalendarView) el.toggleCalendarView.textContent = calendarView === "month" ? "Ver semana" : "Ver mes";
  if (el.weekTitle) {
    el.weekTitle.textContent = calendarView === "month"
      ? monthCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : `${formatDate(weekStart)} a ${formatDate(addDays(weekStart, 6))}`;
  }
  if (el.statGoals) el.statGoals.textContent = agendaEntries().filter(entry => entry.type === "goal").length;
  if (el.statItems) el.statItems.textContent = agendaEntries().length;
  if (el.statReports) el.statReports.textContent = state.reports.length;
  if (el.statFocus) el.statFocus.textContent = formatFocusHours(state.plan);
  if (calendarView === "month") renderMonth(monthCursor);
  else renderWeek(weekStart);
  renderChecklist();
  renderInsights();
  renderEntries();
}

function todayKey() {
  return window.Checklist.localDay(new Date().toISOString());
}

function formatDay(day) {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

function obsidianLink(note) {
  return `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(note)}`;
}

function renderChecklist() {
  if (!el.checklist) return;
  const today = todayKey();
  renderChecklistMetrics(today);
  const { groups, paused } = window.Checklist.buildChecklist({ entries: state.entries, projects: state.projects, today });
  if (!groups.length && !paused.length) {
    el.checklist.innerHTML = `<p class="muted">Nenhuma tarefa aberta. A rodada diaria traz as proximas a partir das suas sessoes.</p>`;
    return;
  }
  const goals = agendaEntries().filter(entry => entry.type === "goal");
  el.checklist.innerHTML = groups.map(group => renderProjectGroup(group, goals)).join("")
    + (paused.length ? renderPausedProjects(paused) : "");
}

function renderChecklistMetrics(today) {
  if (!el.checklistMetrics) return;
  const metrics = window.Checklist.checklistMetrics({ entries: state.entries, opens: state.opens, today });
  const parts = [
    `Aberto em ${metrics.openDays} de 7 dias`,
    `${metrics.manualTasks} ${metrics.manualTasks === 1 ? "tarefa criada" : "tarefas criadas"} a mao`
  ];
  if (metrics.acceptance !== null) {
    parts.push(`${Math.round(metrics.acceptance * 100)}% das sugestoes aceitas (${metrics.confirmed} de ${metrics.confirmed + metrics.dismissed})`);
  }
  el.checklistMetrics.textContent = parts.join(" · ");
}

function renderProjectGroup(group, goals) {
  const { project } = group;
  const idle = group.idleDays === null ? "" : group.idleDays <= 0 ? "mexido hoje" : `parado ha ${group.idleDays} ${group.idleDays === 1 ? "dia" : "dias"}`;
  const facts = [
    idle,
    group.deadline ? `prazo ${formatDay(group.deadline)}` : "",
    project.note ? `<a href="${escapeHtml(obsidianLink(project.note))}">nota no Obsidian</a>` : ""
  ].filter(Boolean).join(" · ");
  const priority = Number(project.priority || 2);
  const priorityOptions = [[3, "Alta"], [2, "Media"], [1, "Baixa"]]
    .map(([value, label]) => `<option value="${value}"${priority === value ? " selected" : ""}>${label}</option>`).join("");
  const goalOptions = goals
    .map(goal => `<option value="${escapeHtml(goal.id)}"${project.goalId === goal.id ? " selected" : ""}>${escapeHtml(goal.text)}</option>`).join("");
  return `
    <article class="project-group" data-project-id="${escapeHtml(project.id)}">
      <header class="project-head">
        <div class="project-title">
          <strong>${escapeHtml(project.name)}</strong>
          <span class="tag">${escapeHtml(project.area)}</span>
          ${group.isNew ? `<span class="tag tag-new">novo: defina prioridade e meta</span>` : ""}
          <small>${facts}</small>
        </div>
        <div class="project-controls">
          <label>Prioridade<select data-field="priority">${priorityOptions}</select></label>
          <label>Meta<select data-field="goalId"><option value="">Sem meta</option>${goalOptions}</select></label>
          <label>Prazo<input type="date" data-field="deadline" value="${escapeHtml(project.deadline || "")}" /></label>
          <button type="button" data-project-action="pause">Pausar</button>
        </div>
      </header>
      <ol class="task-list">${group.tasks.map(renderChecklistTask).join("")}</ol>
      ${group.doneToday.length ? `<ul class="done-today">${group.doneToday.map(renderDoneToday).join("")}</ul>` : ""}
    </article>
  `;
}

function renderChecklistTask(task) {
  const suggested = task.status === "sugerida";
  return `
    <li class="task${suggested ? " suggested" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="task-main">
        <strong>${escapeHtml(task.text)}</strong>
        ${suggested ? `<span class="tag">sugerida</span>` : ""}
        ${task.date ? `<span class="tag tag-due">ate ${formatDay(task.date)}</span>` : ""}
        ${task.context ? `<p>${escapeHtml(task.context)}</p>` : ""}
      </div>
      <div class="task-actions">
        ${suggested ? `<button type="button" data-action="confirm">Confirmar</button>` : ""}
        <button type="button" data-action="done">Feito</button>
        <button type="button" data-action="dismiss" class="danger">Descartar</button>
      </div>
    </li>
  `;
}

function renderDoneToday(task) {
  const by = task.doneBy
    ? ` pela sessao de ${formatDay(task.doneBy.day)}${task.doneBy.evidence ? `: ${escapeHtml(task.doneBy.evidence)}` : ""}`
    : "";
  return `
    <li data-task-id="${escapeHtml(task.id)}">
      <span>Feita: <strong>${escapeHtml(task.text)}</strong>, concluida${by}</span>
      <button type="button" data-action="undo">Desfazer</button>
    </li>
  `;
}

function renderPausedProjects(paused) {
  const rows = paused.map(group => `
    <div class="paused-row" data-project-id="${escapeHtml(group.project.id)}">
      <span>${escapeHtml(group.project.name)} <small>${group.tasks.length} ${group.tasks.length === 1 ? "tarefa" : "tarefas"}</small></span>
      <button type="button" data-project-action="resume">Retomar</button>
    </div>
  `).join("");
  return `<details class="paused-projects"><summary>${paused.length} ${paused.length === 1 ? "projeto pausado" : "projetos pausados"}</summary>${rows}</details>`;
}

function handleChecklistClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const now = new Date().toISOString();
  const taskId = button.closest("[data-task-id]")?.dataset.taskId;
  const projectId = button.closest("[data-project-id]")?.dataset.projectId;
  if (button.dataset.action && taskId) {
    state.entries = state.entries.map(entry => (entry.id === taskId ? window.Checklist.applyTaskAction(entry, button.dataset.action, now) : entry));
  } else if (button.dataset.projectAction && projectId) {
    updateProject(projectId, { paused: button.dataset.projectAction === "pause" }, now);
  } else {
    return;
  }
  persist();
  renderChecklist();
}

function handleChecklistChange(event) {
  const field = event.target.dataset.field;
  const projectId = event.target.closest("[data-project-id]")?.dataset.projectId;
  if (!field || !projectId) return;
  const value = field === "priority" ? Number(event.target.value) : event.target.value || null;
  updateProject(projectId, { [field]: value }, new Date().toISOString());
  persist();
  renderChecklist();
}

function updateProject(projectId, changes, now) {
  state.projects = state.projects.map(project => (project.id === projectId ? window.Checklist.applyProjectChange(project, changes, now) : project));
}

function renderInsights() {
  renderTodayAgenda();
  renderDeadlines();
}

function renderTodayAgenda() {
  if (!el.todayAgenda) return;
  const today = new Date();
  const blocks = state.plan
    .filter(item => isSameDay(new Date(item.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  if (!blocks.length) {
    el.todayAgenda.innerHTML = `<p class="muted">Nenhum bloco planejado para hoje nesta visao. Use Hoje ou Reorganizar semana.</p>`;
    return;
  }

  el.todayAgenda.innerHTML = blocks.slice(0, 6).map(item => `
    <div class="compact-item ${item.type}">
      <time>${formatTime(item.start)}-${formatTime(item.end)}</time>
      <span>${escapeHtml(item.title)}</span>
    </div>
  `).join("");
}

function renderDeadlines() {
  if (!el.deadlineList) return;
  const today = startOfDay(new Date());
  const upcoming = agendaEntries()
    .filter(entry => entry.date && new Date(`${entry.date}T12:00`) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || b.priority - a.priority)
    .slice(0, 6);

  if (!upcoming.length) {
    el.deadlineList.innerHTML = `<p class="muted">Sem prazos futuros cadastrados.</p>`;
    return;
  }

  el.deadlineList.innerHTML = upcoming.map(entry => {
    const date = new Date(`${entry.date}T12:00`);
    return `
      <div class="compact-item ${entry.type}">
        <time>${formatDate(date)} · ${daysUntilLabel(date)}</time>
        <span>${escapeHtml(entry.text)}</span>
      </div>
    `;
  }).join("");
}

function formatFocusHours(plan) {
  const minutes = plan
    .filter(item => item.type !== "event")
    .reduce((total, item) => total + Number(item.duration || 0), 0);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function getVisibleWeekStart() {
  return addDays(getMonday(new Date()), weekOffset * 7);
}

function renderWeek(weekStart) {
  if (!el.weekGrid) return;
  el.weekGrid.className = "week-grid";
  el.weekGrid.innerHTML = "";
  for (let day = 0; day < 7; day += 1) {
    const date = addDays(weekStart, day);
    const column = document.createElement("article");
    column.className = "day-column";
    column.innerHTML = `<h3>${weekDays[day]} ${formatDate(date)}</h3>`;
    const blocks = state.plan.filter(item => isSameDay(new Date(item.start), date));
    if (blocks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Sem blocos.";
      column.append(empty);
    }
    blocks.forEach(item => {
      const block = document.createElement("div");
      block.className = `block ${item.type}`;
      block.innerHTML = `
        <time>${formatTime(item.start)}-${formatTime(item.end)}</time>
        <span>${escapeHtml(item.title)}</span>
        ${renderPomodoroTags(item)}
      `;
      column.append(block);
    });
    el.weekGrid.append(column);
  }
}

function renderMonth(monthStart) {
  if (!el.weekGrid) return;
  el.weekGrid.className = "month-grid";
  el.weekGrid.innerHTML = "";
  weekDays.forEach(day => {
    const heading = document.createElement("div");
    heading.className = "month-heading";
    heading.textContent = day;
    el.weekGrid.append(heading);
  });

  const firstCell = getMonday(monthStart);
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(firstCell, index);
    const dayItems = getItemsForDate(date);
    const cell = document.createElement("button");
    cell.className = [
      "month-cell",
      date.getMonth() !== monthStart.getMonth() ? "muted-month" : "",
      isSameDay(date, new Date()) ? "today" : ""
    ].filter(Boolean).join(" ");
    cell.type = "button";
    cell.innerHTML = `
      <strong>${date.getDate()}</strong>
      <span>${dayItems.length ? `${dayItems.length} item(ns)` : ""}</span>
      ${dayItems.slice(0, 3).map(item => `<small class="${item.type}">${escapeHtml(item.text || item.title)}</small>`).join("")}
    `;
    cell.addEventListener("click", () => {
      calendarView = "week";
      weekOffset = Math.round((getMonday(date) - getMonday(new Date())) / (7 * 24 * 60 * 60 * 1000));
      generatePlan();
    });
    el.weekGrid.append(cell);
  }
}

function getItemsForDate(date) {
  const planned = state.plan.filter(item => isSameDay(new Date(item.start), date));
  const entries = agendaEntries().filter(entry => entry.date && isSameDay(new Date(`${entry.date}T12:00`), date));
  const plannedIds = new Set(planned.map(item => item.entryId));
  return planned.concat(entries.filter(entry => !plannedIds.has(entry.id)));
}

function renderPomodoroTags(item) {
  if (!Array.isArray(item.pomodoros) || item.pomodoros.length <= 1) return "";
  const focusCount = item.pomodoros.filter(segment => segment.kind === "focus").length;
  const breakCount = item.pomodoros.filter(segment => segment.kind === "break").length;
  return `<div class="pomodoro-tags"><span>${focusCount} foco</span><span>${breakCount} pausas</span></div>`;
}

function tickAlarms() {
  const now = new Date();
  renderFocus(now);
  if (!alarmsEnabled) return;

  alarmEvents().forEach(event => {
    const alarmTime = new Date(event.at);
    const diff = alarmTime - now;
    if (diff <= 0 && diff > -20000 && !state.alarmFired.includes(event.id)) {
      fireAlarm(event);
      state.alarmFired.push(event.id);
      persist();
    }
  });
}

function renderFocus(now = new Date()) {
  if (!el.focusTitle || !el.focusDetail || !el.focusTimer) return;
  const active = state.plan.find(item => now >= new Date(item.start) && now < new Date(item.end));
  const next = state.plan.find(item => new Date(item.start) > now);

  if (active) {
    const segment = currentPomodoro(active, now);
    el.focusTitle.textContent = segment?.kind === "break" ? "Pausa curta" : active.title;
    el.focusDetail.textContent = segment?.kind === "break" ? "Respira, levanta e volta no proximo bloco." : `${labelFor(active.type)} em andamento.`;
    el.focusTimer.textContent = formatCountdown(new Date(segment?.end || active.end) - now);
    return;
  }

  if (next) {
    el.focusTitle.textContent = `Proximo: ${next.title}`;
    el.focusDetail.textContent = `Comeca ${formatTime(next.start)}. Vou avisar 10 min antes e no inicio.`;
    el.focusTimer.textContent = formatCountdown(new Date(next.start) - now);
    return;
  }

  el.focusTitle.textContent = "Sem bloco ativo";
  el.focusDetail.textContent = "Sua agenda esta livre no momento.";
  el.focusTimer.textContent = "--:--";
}

function currentPomodoro(item, now) {
  return (item.pomodoros || []).find(segment => now >= new Date(segment.start) && now < new Date(segment.end));
}

function alarmEvents() {
  return state.plan.flatMap(item => {
    const events = [
      { id: `${item.id}:before`, at: addMinutes(new Date(item.start), -10).toISOString(), title: "Em 10 minutos", body: item.title },
      { id: `${item.id}:start`, at: item.start, title: "Hora de comecar", body: item.title },
      { id: `${item.id}:end`, at: item.end, title: "Bloco concluido", body: item.title }
    ];

    (item.pomodoros || []).forEach((segment, index) => {
      if (index === 0) return;
      events.push({
        id: `${item.id}:segment:${index}`,
        at: segment.start,
        title: segment.kind === "break" ? "Pausa de 5 minutos" : "Voltar ao foco",
        body: item.title
      });
    });

    return events;
  });
}

function fireAlarm(event) {
  playAlarmSound(0.12);
  if (notificationAllowed()) {
    new Notification(event.title, { body: event.body, tag: event.id });
  }
}

function playAlarmSound(volume) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

function notificationAllowed() {
  return "Notification" in window && Notification.permission === "granted";
}

function pruneOldAlarms() {
  const activeIds = new Set(alarmEvents().map(event => event.id));
  state.alarmFired = (state.alarmFired || []).filter(id => activeIds.has(id));
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderEntries() {
  if (!el.entriesList) return;
  el.entriesList.innerHTML = "";
  const entries = agendaEntries();
  if (entries.length === 0) {
    el.entriesList.innerHTML = `<p class="muted">Adicione compromissos, rotinas e metas para montar a semana.</p>`;
    return;
  }
  entries.forEach(entry => {
    const card = document.createElement("article");
    card.className = "entry-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.text)}</strong>
        <small>${labelFor(entry.type)} - ${entry.duration} min - prioridade ${entry.priority}${entry.date ? ` - ${entry.date}` : ""}</small>
      </div>
      <button data-id="${entry.id}" aria-label="Remover">Excluir</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      state.entries = state.entries.filter(item => item.id !== entry.id);
      state.plan = state.plan.filter(item => item.entryId !== entry.id);
      persist();
      render();
    });
    el.entriesList.append(card);
  });
}

function exportIcs() {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agenda Inteligente//PT-BR"];
  state.plan.forEach(item => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id}@agenda-inteligente`);
    lines.push(`DTSTAMP:${icsDate(new Date())}`);
    lines.push(`DTSTART:${icsDate(new Date(item.start))}`);
    lines.push(`DTEND:${icsDate(new Date(item.end))}`);
    lines.push(`SUMMARY:${escapeIcs(item.title)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "agenda-inteligente.ics";
  link.click();
  URL.revokeObjectURL(url);
}

function clearData() {
  if (!confirm("Limpar todos os dados locais?")) return;
  state.entries = [];
  state.reports = [];
  state.plan = [];
  persist();
  render();
}

function getMonday(date) {
  const copy = new Date(date);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date, months) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return startOfMonth(copy);
}

function startOfMonth(date) {
  const copy = new Date(date);
  copy.setDate(1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addMinutes(date, minutes) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() + minutes);
  return copy;
}

function withTime(date, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const copy = new Date(date);
  copy.setHours(hours, minutes, 0, 0);
  return copy;
}

function diffMinutes(start, end) {
  return Math.round((end - start) / 60000);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function isSameWeek(date, weekStart) {
  return date >= weekStart && date < addDays(weekStart, 7);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDate(date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function daysUntilLabel(date) {
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / (24 * 60 * 60 * 1000));
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanha";
  if (diff < 0) return `${Math.abs(diff)} dia(s) atras`;
  return `em ${diff} dia(s)`;
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function typeWeight(type) {
  return { event: 4, goal: 3, routine: 2, task: 1 }[type] || 0;
}

function labelFor(type) {
  return { event: "Compromisso", goal: "Meta", routine: "Rotina", task: "Tarefa" }[type] || type;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeIcs(value) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
