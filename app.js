const STORAGE_KEY = "smart-week-planner-v1";
const weekDays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"];
const calendarCategoryDefinitions = {
  all: { label: "Tudo", color: "#46515f", background: "#f2f4f5" },
  fixed: { label: "Compromissos", color: "#b73b3b", background: "#fff0ee" },
  work: { label: "Trabalho", color: "#355f7d", background: "#eaf2f7" },
  study: { label: "Estudo", color: "#68489a", background: "#f2edfa" },
  project: { label: "Projetos", color: "#17705d", background: "#e8f6f1" },
  career: { label: "Carreira", color: "#a56312", background: "#fff3dc" },
  health: { label: "Saude", color: "#397745", background: "#edf7ee" },
  routine: { label: "Rotina", color: "#795845", background: "#f7f0eb" },
  admin: { label: "Administrativo", color: "#66717e", background: "#eff2f4" },
  personal: { label: "Pessoal", color: "#8a4d72", background: "#f8edf3" }
};const defaultPreferences = {
  dailyFocusLimit: 240,
  weekdayStart: "08:00",
  weekdayEnd: "21:00",
  pomodoroFocus: 25,
  pomodoroBreak: 5
};
const defaultState = { goals: [], entries: [], reports: [], projects: [], opens: [], plan: [], planWarnings: [], alarmFired: [], preferences: defaultPreferences };
const OBSIDIAN_VAULT = "Obsidian Vault";
const CHECKLIST_OPEN_GROUPS = 3;
let speechRecognition = null;
let alarmInterval = null;
let alarmsEnabled = false;
let inputMode = "auto";
let weekOffset = 0;
let calendarView = window.innerWidth < 820 ? "day" : "week";
let selectedDay = startOfDay(new Date());
let monthCursor = startOfMonth(new Date());
let serverSyncReady = false;
let planningGoalId = null;
let calendarCategoryFilter = "all";
let showFreeTime = true;
let syncBase = null;
try { syncBase = JSON.parse(localStorage.getItem(STORAGE_KEY + "-base") || "null"); } catch {}
let syncDirty = localStorage.getItem(STORAGE_KEY + "-dirty") === "true";
let syncBusy = false;
let aiBusy = false;
let pendingProposal = null;
let aiProvider = localStorage.getItem(STORAGE_KEY + "-ai-provider") || "";
let allScheduledBlocks = [];
let checklistMoreOpen = false;
const checklistExpanded = new Set();
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
  calendarViewButtons: document.querySelectorAll("[data-calendar-view]"),
  calendarFilters: document.querySelector("#calendarFilters"),
  toggleFreeTime: document.querySelector("#toggleFreeTime"),
  generatePlan: document.querySelector("#generatePlan"),
  enableAlarms: document.querySelector("#enableAlarms"),
  exportIcs: document.querySelector("#exportIcs"),
  clearData: document.querySelector("#clearData"),
  weekGrid: document.querySelector("#weekGrid"),
  checklist: document.querySelector("#checklist"),
  checklistMetrics: document.querySelector("#checklistMetrics"),
  planWarnings: document.querySelector("#planWarnings"),
  goalLegend: document.querySelector("#goalLegend"),
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
  recentCheckins: document.querySelector("#recentCheckins"),
  goalsBoard: document.querySelector("#goalsBoard"),
  newGoal: document.querySelector("#newGoal"),
  newEntry: document.querySelector("#newEntry"),
  prefStart: document.querySelector("#prefStart"),
  prefEnd: document.querySelector("#prefEnd"),
  prefFocusLimit: document.querySelector("#prefFocusLimit"),
  savePreferences: document.querySelector("#savePreferences"),
  entryDialog: document.querySelector("#entryDialog"),
  entryForm: document.querySelector("#entryForm"),
  entryDialogTitle: document.querySelector("#entryDialogTitle"),
  editEntryId: document.querySelector("#editEntryId"),
  editOccurrenceDate: document.querySelector("#editOccurrenceDate"),
  editText: document.querySelector("#editText"),
  editInstructions: document.querySelector("#editInstructions"),
  editType: document.querySelector("#editType"),
  editCalendarCategory: document.querySelector("#editCalendarCategory"),
  editGoalId: document.querySelector("#editGoalId"),
  editDate: document.querySelector("#editDate"),
  editTime: document.querySelector("#editTime"),
  editDeadline: document.querySelector("#editDeadline"),
  editDuration: document.querySelector("#editDuration"),
  editMilestone: document.querySelector("#editMilestone"),
  editCompletionCriteria: document.querySelector("#editCompletionCriteria"),
  editPriority: document.querySelector("#editPriority"),
  editStatus: document.querySelector("#editStatus"),
  editScope: document.querySelector("#editScope"),
  editScopeLabel: document.querySelector("#editScopeLabel"),
  weekdayFieldset: document.querySelector("#weekdayFieldset"),
  deleteEntry: document.querySelector("#deleteEntry"),
  closeEntryDialog: document.querySelector("#closeEntryDialog"),
  goalDialog: document.querySelector("#goalDialog"),
  goalForm: document.querySelector("#goalForm"),
  editGoalRecordId: document.querySelector("#editGoalRecordId"),
  goalTitleInput: document.querySelector("#goalTitleInput"),
  goalDescriptionInput: document.querySelector("#goalDescriptionInput"),
  goalStrategyInput: document.querySelector("#goalStrategyInput"),
  goalCriteriaInput: document.querySelector("#goalCriteriaInput"),
  goalWeeklyMinutesInput: document.querySelector("#goalWeeklyMinutesInput"),
  goalTargetInput: document.querySelector("#goalTargetInput"),
  goalPriorityInput: document.querySelector("#goalPriorityInput"),
  goalStatusInput: document.querySelector("#goalStatusInput"),
  deleteGoal: document.querySelector("#deleteGoal"),
  closeGoalDialog: document.querySelector("#closeGoalDialog")
};

on(el.addQuickEntry, "click", addQuickEntry);
on(el.quickMessage, "input", updateInterpretationPreview);
on(el.quickMessage, "keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) addQuickEntry();
});
on(el.voiceMessage, "click", toggleVoiceMessage);
on(el.generatePlan, "click", () => {
  recordManualChange("reschedule", "Agenda", "Sessoes flexiveis reorganizadas a partir de agora");
  persist();
  generatePlan();
});
on(el.enableAlarms, "click", enableAlarms);
on(el.exportIcs, "click", exportIcs);
on(el.clearData, "click", clearData);
on(el.savePreferences, "click", savePreferences);
on(el.newGoal, "click", () => openGoalEditor());
on(el.newEntry, "click", () => openEntryEditor());
on(el.entryForm, "submit", saveEntryEditor);
on(el.deleteEntry, "click", deleteEditedEntry);
on(el.closeEntryDialog, "click", () => el.entryDialog?.close());
on(el.editType, "change", updateEditorVisibility);
on(el.goalForm, "submit", saveGoalEditor);
on(el.deleteGoal, "click", deleteEditedGoal);
on(el.closeGoalDialog, "click", () => el.goalDialog?.close());
on(el.prevWeek, "click", () => changeWeek(-1));
on(el.todayWeek, "click", () => {
  if (calendarView === "month") monthCursor = startOfMonth(new Date());
  else { weekOffset = 0; selectedDay = startOfDay(new Date()); }
  generatePlan();
});
on(el.nextWeek, "click", () => changeWeek(1));
on(el.toggleCalendarView, "click", toggleCalendarView);
el.calendarViewButtons.forEach(button => on(button, "click", () => setCalendarView(button.dataset.calendarView)));
on(el.toggleFreeTime, "change", () => {
  showFreeTime = Boolean(el.toggleFreeTime.checked);
  render();
});
el.modeButtons.forEach(button => {
  on(button, "click", () => setInputMode(button.dataset.mode));
});
el.quickExamples.forEach(button => {
  on(button, "click", () => useQuickExample(button));
});
on(el.checklist, "click", handleChecklistClick);
on(el.checklist, "change", handleChecklistChange);
// "toggle" não borbulha: escuta na captura para lembrar se "Mais projetos" está aberto.
el.checklist?.addEventListener("toggle", event => {
  if (event.target.classList.contains("more-projects")) checklistMoreOpen = event.target.open;
}, true);
hydratePreferenceFields();
el.quickMessage.value = localStorage.getItem(STORAGE_KEY + "-draft") || "";
autoScheduleBacklog();
generatePlan();
updateInterpretationPreview();
tickAlarms();
alarmInterval = window.setInterval(tickAlarms, 1000);
recordTodayOpen();
syncFromServer();
window.setInterval(syncFromServer, 15000);

function on(element, eventName, handler) {
  if (element) element.addEventListener(eventName, handler);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const loaded = { ...structuredClone(defaultState), ...Planner.normalize(raw ? JSON.parse(raw) : {}) };
    migrateLegacyGoals(loaded);
    return loaded;
  } catch { return structuredClone(defaultState); }
}

function migrateLegacyGoals(target) {
  const legacyGoals = (target.entries || []).filter(entry => entry.type === "goal");
  legacyGoals.forEach(entry => {
    if (target.goals.some(goal => normalizeText(goal.title) === normalizeText(entry.text))) return;
    target.goals.push({
      id: `goal-${entry.id}`,
      title: entry.text,
      description: "Meta migrada da versao anterior.",
      targetDate: entry.deadline || entry.date || null,
      priority: entry.priority || 2,
      status: entry.status === "completed" ? "completed" : "active",
      progress: entry.status === "completed" ? 100 : 0,
      createdAt: entry.createdAt || new Date().toISOString()
    });
  });
  target.entries = (target.entries || []).filter(entry => entry.type !== "goal");
}

function persist() {
  state.planningAt = new Date().toISOString();
  syncDirty = true;
  saveLocalSnapshot();
  syncToServer();
}

async function syncFromServer() {
  if (syncBusy || document.querySelector("dialog[open]")) return;
  try {
    if (serverSyncReady && syncDirty) return await syncToServer();
    const response = await fetch("/api/state", { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error((await response.json()).error || "Servidor indisponivel.");
    const data = await response.json();
    if (syncBase && !syncDirty && data.revision === syncBase.revision) {
      serverSyncReady = true;
      syncStatus("Agenda sincronizada", false);
      return;
    }
    if (!syncBase && (state.entries.length || state.goals.length || state.reports.length)) {
      localStorage.setItem(STORAGE_KEY + "-recovery", JSON.stringify(state));
      if (!data.entries.length && !data.goals.length && !data.reports.length && confirm("Importar a agenda que estava salva neste navegador para o servidor?")) {
        syncBase = data; syncDirty = true; serverSyncReady = true;
        return await syncToServer();
      }
    }
    serverSyncReady = true;
    if (syncDirty && syncBase) return await syncToServer();
    acceptServerState(data);
    recordTodayOpen();
    syncStatus("Agenda sincronizada", false);
  } catch (error) { syncStatus("Sem sincronizacao: " + error.message + " Alteracoes locais preservadas.", true); }
}

async function syncToServer() {
  if (!serverSyncReady || syncBusy || !syncDirty || !syncBase) return !syncDirty;
  syncBusy = true;
  const sent = dataSnapshot();
  try {
    syncStatus("Salvando...", false);
    const response = await fetch("/api/state/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base: syncBase, incoming: sent }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) showSyncConflict(result);
      throw new Error(result.error || "Conflito de edicao. Revise as alteracoes locais.");
    }
    const editedWhileSaving = JSON.stringify(dataSnapshot()) !== JSON.stringify(sent);
    const merged = Planner.merge(result.data, sent, dataSnapshot());
    if (merged.conflicts.length) { showSyncConflict(merged); throw new Error("Edicoes simultaneas precisam de revisao."); }
    syncBase = result.data;
    Object.assign(state, merged.data);
    state.revision = result.data.revision;
    state.planningAt = result.data.planningAt;
    syncDirty = editedWhileSaving;
    saveLocalSnapshot();
    generatePlan();
    syncStatus(syncDirty ? "Salvando alteracoes adicionais..." : "Agenda sincronizada", false);
    return !syncDirty;
  } catch (error) { syncStatus(error.message + " Seus dados locais continuam salvos.", true); return false; }
  finally { syncBusy = false; }
}

function mergeItems(current = [], incoming = []) {
  const map = new Map();
  current.forEach(item => {
    if (item?.id) map.set(item.id, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach(item => {
    if (item?.id) map.set(item.id, { ...map.get(item.id), ...item });
  });
  return Array.from(map.values());
}

function deduplicateEntries(entries = []) { return Planner.normalize({ entries }).entries; }

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

function savePreferences() {
  const preferences = { ...state.preferences, weekdayStart: el.prefStart.value, weekdayEnd: el.prefEnd.value, dailyFocusLimit: Number(el.prefFocusLimit.value) };
  try { Planner.validate(Planner.normalize({ ...state, preferences })); }
  catch (error) { alert(error.message); return; }
  state.preferences = preferences;
  recordManualChange("edit", "Disponibilidade", "Horarios e carga atualizados");
  persist();
  generatePlan();
}

function hydratePreferenceFields() {
  if (el.prefStart) el.prefStart.value = state.preferences.weekdayStart || "08:00";
  if (el.prefEnd) el.prefEnd.value = state.preferences.weekdayEnd || "21:00";
  if (el.prefFocusLimit) el.prefFocusLimit.value = state.preferences.dailyFocusLimit || 240;
}

function populateGoalOptions(selectedId = "") {
  if (!el.editGoalId) return;
  el.editGoalId.innerHTML = `<option value="">Sem meta</option>` + state.goals
    .filter(goal => goal.status !== "completed" || goal.id === selectedId)
    .map(goal => `<option value="${goal.id}" ${goal.id === selectedId ? "selected" : ""}>${escapeHtml(goal.title)}</option>`)
    .join("");
}

function openEntryEditor(entryId = "", occurrenceDate = "", defaults = {}) {
  const entry = state.entries.find(item => item.id === entryId);
  if (!el.entryDialog) return;
  const draft = entry || { type: "task", duration: 60, priority: 2, status: "pending", preferredDays: [], ...defaults };
  const override = occurrenceDate ? draft.overrides?.[occurrenceDate] : null;
  const effective = { ...draft, ...(override || {}) };
  el.editEntryId.value = draft.id || "";
  el.editOccurrenceDate.value = occurrenceDate;
  el.entryDialogTitle.textContent = !entry ? "Nova tarefa" : draft.type === "routine" && occurrenceDate ? "Editar ocorrencia" : "Editar tarefa";
  el.editText.value = effective.text || "";
  el.editInstructions.value = normalizeStringList(effective.instructions).join("\n");
  el.editMilestone.value = effective.milestone || "";
  el.editCompletionCriteria.value = effective.completionCriteria || "";
  el.editType.value = draft.type || "task";
  el.editCalendarCategory.value = effective.calendarCategory || "";
  populateGoalOptions(draft.goalId || "");
  el.editDate.value = effective.date || occurrenceDate || "";
  el.editTime.value = effective.time || "";
  el.editDeadline.value = draft.deadline || "";
  el.editDuration.value = effective.duration || 60;
  el.editPriority.value = String(draft.priority || 2);
  el.editStatus.value = draft.completionDates?.includes(occurrenceDate) ? "completed" : effective.cancelled ? "paused" : draft.status || "pending";
  el.editScope.value = draft.type === "routine" && occurrenceDate ? "occurrence" : "all";
  document.querySelectorAll("#weekdayFieldset input[type=checkbox]").forEach(input => {
    input.checked = (draft.preferredDays || []).includes(Number(input.value));
  });
  el.deleteEntry.hidden = !entry;
  updateEditorVisibility();
  el.entryDialog.showModal();
}

function updateEditorVisibility() {
  const isRoutine = el.editType?.value === "routine";
  if (el.weekdayFieldset) el.weekdayFieldset.hidden = !isRoutine;
  if (el.editScopeLabel) el.editScopeLabel.hidden = !(isRoutine && el.editOccurrenceDate?.value);
}

function saveEntryEditor(event) {
  event.preventDefault();
  let entry = state.entries.find(item => item.id === el.editEntryId?.value);
  const occurrenceDate = el.editOccurrenceDate.value;
  const scope = el.editScope.value;
  const values = {
    text: el.editText.value.trim(),
    date: el.editDate.value || null,
    time: el.editTime.value || null,
    duration: normalizeDuration(el.editDuration.value, el.editText.value),
    priority: Number(el.editPriority.value || 2),
    instructions: normalizeStringList(el.editInstructions.value),
    milestone: el.editMilestone.value.trim() || null,
    completionCriteria: el.editCompletionCriteria.value.trim() || null,
    calendarCategory: el.editCalendarCategory.value || null
  };

  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      type: el.editType.value,
      goalId: el.editGoalId.value || null,
      deadline: el.editDeadline.value || null,
      status: el.editStatus.value,
      preferredDays: Array.from(document.querySelectorAll("#weekdayFieldset input:checked")).map(input => Number(input.value)),
      completionDates: [],
      overrides: {},
      autoScheduled: false,
      timeLocked: Boolean(values.time),
      createdAt: new Date().toISOString(),
      ...values
    };
    state.entries.push(entry);
  } else if (entry.type === "routine" && occurrenceDate && scope === "occurrence") {
    entry.overrides = { ...(entry.overrides || {}), [occurrenceDate]: { ...values, timeLocked: Boolean(values.time), cancelled: el.editStatus.value === "paused" } };
    if (el.editStatus.value === "completed") entry.completionDates = [...new Set([...(entry.completionDates || []), occurrenceDate])];
    else entry.completionDates = (entry.completionDates || []).filter(date => date !== occurrenceDate);
  } else {
    Object.assign(entry, values, {
      type: el.editType.value,
      goalId: el.editGoalId.value || null,
      deadline: el.editDeadline.value || null,
      status: el.editStatus.value,
      preferredDays: Array.from(document.querySelectorAll("#weekdayFieldset input:checked")).map(input => Number(input.value)),
      autoScheduled: false,
      timeLocked: Boolean(values.time)
    });
  }
  recordManualChange(el.editEntryId.value ? "edit" : "create", entry.text, scope === "occurrence" ? "Ocorrencia " + occurrenceDate : "Tarefa atualizada");
  el.entryDialog.close();
  autoScheduleBacklog();
  updateGoalProgress();
  persist();
  generatePlan();
}

function deleteEditedEntry() {
  const entry = state.entries.find(item => item.id === el.editEntryId.value);
  if (!entry) return;
  const occurrence = entry.type === "routine" && el.editScope.value === "occurrence" && el.editOccurrenceDate.value;
  if (!confirm(occurrence ? "Excluir somente esta ocorrencia?" : "Excluir esta tarefa e todas as suas ocorrencias?")) return;
  if (occurrence) entry.overrides = { ...entry.overrides, [occurrence]: { cancelled: true } };
  else state.entries = state.entries.filter(item => item.id !== entry.id);
  recordManualChange("delete", entry.text, occurrence ? "Somente " + occurrence : "Toda a tarefa");
  el.entryDialog.close(); persist(); generatePlan();
}

function completeEntry(entryId, occurrenceDate = "") {
  const entry = state.entries.find(item => item.id === entryId);
  if (!entry) return;
  if (entry.type === "routine") {
    const date = occurrenceDate || toInputDate(new Date());
    entry.completionDates = Array.from(new Set([...(entry.completionDates || []), date]));
  } else {
    entry.status = "completed";
    entry.completedMinutes = entry.duration;
    entry.completedAt = new Date().toISOString();
  }
  recordManualChange("complete", entry.text, occurrenceDate || "Tarefa completa");
  updateGoalProgress();
  persist();
  generatePlan();
}

function openGoalEditor(goalId = "") {
  if (!el.goalDialog) return;
  const goal = state.goals.find(item => item.id === goalId);
  el.editGoalRecordId.value = goal?.id || "";
  el.goalTitleInput.value = goal?.title || "";
  el.goalDescriptionInput.value = goal?.description || "";
  el.goalStrategyInput.value = goal?.strategy || "";
  el.goalCriteriaInput.value = normalizeStringList(goal?.successCriteria).join("\n");
  el.goalWeeklyMinutesInput.value = Number(goal?.weeklyMinutes || 240);
  el.goalTargetInput.value = goal?.targetDate || "";
  el.goalPriorityInput.value = String(goal?.priority || 2);
  el.goalStatusInput.value = goal?.status || "active";
  el.deleteGoal.hidden = !goal;
  el.goalDialog.showModal();
}

function saveGoalEditor(event) {
  event.preventDefault();
  const existing = state.goals.find(goal => goal.id === el.editGoalRecordId.value);
  const values = {
    title: el.goalTitleInput.value.trim(),
    description: el.goalDescriptionInput.value.trim(),
    strategy: el.goalStrategyInput.value.trim(),
    successCriteria: normalizeStringList(el.goalCriteriaInput.value),
    weeklyMinutes: Math.max(30, Number(el.goalWeeklyMinutesInput.value || 240)),
    targetDate: el.goalTargetInput.value || null,
    priority: Number(el.goalPriorityInput.value || 2),
    status: el.goalStatusInput.value
  };
  if (existing) Object.assign(existing, values);
  else state.goals.push({ id: crypto.randomUUID(), ...values, progress: 0, createdAt: new Date().toISOString() });
  recordManualChange(existing ? "edit" : "create", values.title, "Meta atualizada");
  el.goalDialog.close();
  persist();
  generatePlan();
  renderProductExtras();
}

function deleteEditedGoal() {
  const id = el.editGoalRecordId.value;
  if (!id || !confirm("Excluir a meta? As tarefas permanecerao sem vinculo.")) return;
  state.goals = state.goals.filter(goal => goal.id !== id);
  state.entries.forEach(entry => { if (entry.goalId === id) entry.goalId = null; });
  el.goalDialog.close();
  persist();
  render();
}

function changeWeek(delta) {
  if (calendarView === "day") { selectedDay = addDays(selectedDay, delta); }
  else if (calendarView === "month") {
    monthCursor = addMonths(monthCursor, delta);
  } else {
    weekOffset += delta;
  }
  generatePlan();
}

function setCalendarView(view) {
  if (!["day", "week", "month"].includes(view) || view === calendarView) return;
  if (view === "day") selectedDay = weekOffset === 0 ? startOfDay(new Date()) : getVisibleWeekStart();
  calendarView = view;
  if (view === "month") monthCursor = startOfMonth(getVisibleWeekStart());
  generatePlan();
}
function toggleCalendarView() {
  calendarView = calendarView === "week" ? "month" : "week";
  if (calendarView === "month") monthCursor = startOfMonth(getVisibleWeekStart());
  generatePlan();
}

async function enableAlarms() {
  if (alarmsEnabled) {
    alarmsEnabled = false;
    el.enableAlarms.textContent = "Ativar alarmes";
    el.alarmStatus.textContent = "Alarmes pausados";
    return;
  }
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

async function addQuickEntry(message = null, requestedGoalId = null) {
  if (aiBusy) return false;
  const text = typeof message === "string" ? message.trim() : el.quickMessage.value.trim();
  if (!text) return false;
  if (pendingProposal && !confirm("Substituir a proposta ainda nao confirmada?")) return false;
  aiBusy = true; planningGoalId = requestedGoalId || null; pendingProposal = null;
  setWorkingState(true);
  try {
    await syncFromServer();
    if (!serverSyncReady || syncDirty) throw new Error("Sincronize as alteracoes antes de pedir um novo plano.");
    const result = await interpretWithServer(text);
    if (result.mode !== "ai" || !result.proposalId) throw new Error(result.message || "IA indisponivel.");
    pendingProposal = { ...result, originalMessage: text };
    showProposal(result);
    return true;
  } catch (error) {
    el.interpretationPreview.innerHTML = "<strong>Nenhuma alteracao aplicada</strong><p>" + escapeHtml(error.message) + "</p>";
    return false;
  } finally { planningGoalId = null; aiBusy = false; setWorkingState(false); }
}

async function interpretWithServer(text) {
  const response = await fetch("/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(190000), body: JSON.stringify({ message: text, mode: inputMode, intent: planningGoalId ? "goal_plan" : "message", planningGoalId, provider: aiProvider, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "A IA nao respondeu.");
  return result;
}

function applyAiInterpretation(result) { pendingProposal = result; showProposal(result); }

function updateGoalProgress() {
  state.goals.forEach(goal => {
    const tasks = state.entries.filter(entry => entry.goalId === goal.id && entry.type === "task");
    const total = tasks.reduce((sum, task) => sum + task.duration, 0);
    const done = tasks.reduce((sum, task) => sum + (task.status === "completed" ? task.duration : Number(task.completedMinutes || 0)), 0);
    goal.progress = total ? Math.min(100, Math.round(done / total * 100)) : 0;
  });
}

function autoScheduleBacklog() { /* Scheduling is derived by Planner; entries retain their original constraints. */ }

function resolveEntryDeadline(entry) {
  const raw = entry.deadline || state.goals.find(goal => goal.id === entry.goalId)?.targetDate;
  return raw ? new Date(`${raw}T23:59:00`) : null;
}

function formatInputTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isEntryActive(entry) {
  return entry.status !== "completed" && entry.status !== "paused";
}

function normalizeDuration(value, text = "") {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 60;
  return Math.max(15, Math.round(duration / 15) * 15);
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
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const reports = Array.isArray(result.reports) ? result.reports : [];
  const goals = Array.isArray(result.goals) ? result.goals : [];
  const updates = Array.isArray(result.updates) ? result.updates : [];
  const entryPreview = entries.slice(0, 5).map(entry => `
    <li>${escapeHtml(labelFor(entry.type))}: ${escapeHtml(entry.text)}${entry.date ? ` (${escapeHtml(entry.date)})` : ""}</li>
  `).join("");
  const updatePreview = updates.slice(0, 8).map(update => `<li>${escapeHtml(formatUpdateNotice(update))}</li>`).join("");
  el.interpretationPreview.innerHTML = `
    <strong>Organizado com IA</strong>
    <p>${escapeHtml(result.summary || "Separei sua mensagem em itens praticos.")}</p>
    <div class="preview-tags">
      <span>${goals.length} meta(s)</span>
      <span>${entries.length} etapa(s)</span>
      <span>${updates.length} ajuste(s)</span>
      <span>${reports.length} check-in(s)</span>
    </div>
    ${entryPreview ? `<ul class="result-list">${entryPreview}</ul>` : ""}
    ${updatePreview ? `<div class="change-notice"><strong>Alteracoes realizadas</strong><ul class="result-list">${updatePreview}</ul></div>` : ""}
  `;
}

function formatUpdateNotice(update) {
  const target = update.targetText || update.newText || "Tarefa";
  if (update.action === "delete") return `${target}: excluida`;
  if (update.action === "complete") return `${target}: marcada como concluida`;
  if (update.action === "pause") return `${target}: pausada`;
  if (update.action === "resume") return `${target}: retomada`;
  const changes = [];
  if (update.newText) changes.push(`nome para "${update.newText}"`);
  if (update.newDate) changes.push(`data para ${update.newDate}`);
  if (update.newTime) changes.push(`horario para ${update.newTime}`);
  if (update.newDeadline) changes.push(`prazo para ${update.newDeadline}`);
  if (update.duration) changes.push(`duracao para ${update.duration} min`);
  if (update.newPriority) changes.push(`prioridade para ${update.newPriority}`);
  if (Array.isArray(update.newPreferredDays)) changes.push("dias da recorrencia atualizados");
  return `${target}: ${changes.join(", ") || update.reason || "atualizada"}`;
}

function updateInterpretationPreview() {
  localStorage.setItem(STORAGE_KEY + "-draft", el.quickMessage.value);
  if (pendingProposal || aiBusy) return;
  el.interpretationPreview.innerHTML = "";
}

function toggleVoiceMessage() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { el.interpretationPreview.textContent = "Ditado indisponivel neste navegador. Use o microfone do teclado do celular ou digite a mensagem."; return; }
  if (speechRecognition) { speechRecognition.stop(); return; }
  const original = el.quickMessage.value.trim();
  speechRecognition = new Recognition();
  speechRecognition.lang = "pt-BR"; speechRecognition.interimResults = true; speechRecognition.continuous = false;
  el.voiceMessage.textContent = "Parar";
  speechRecognition.onresult = event => { el.quickMessage.value = [original, Array.from(event.results).map(result => result[0].transcript).join(" ")].filter(Boolean).join(" "); updateInterpretationPreview(); };
  speechRecognition.onerror = event => { el.interpretationPreview.textContent = event.error === "not-allowed" ? "Microfone bloqueado. Autorize o acesso nas configuracoes do navegador." : "Nao foi possivel transcrever. Seu texto foi mantido."; };
  speechRecognition.onend = () => { speechRecognition = null; el.voiceMessage.textContent = "Audio"; };
  try { speechRecognition.start(); } catch { speechRecognition = null; el.voiceMessage.textContent = "Audio"; }
}

function normalizeText(value) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/\r?\n|;/).map(item => item.trim()).filter(Boolean);
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

function generatePlan() {
  const scrollTop = el.weekGrid?.scrollTop || 0;
  const scrollLeft = el.weekGrid?.scrollLeft || 0;
  const from = calendarView === "month" ? getMonday(monthCursor) : calendarView === "day" ? selectedDay : getVisibleWeekStart();
  const to = addDays(from, calendarView === "month" ? 42 : calendarView === "day" ? 1 : 7);
  const result = Planner.schedule(state, { from: toInputDate(from), to: toInputDate(to) });
  state.plan = result.blocks;
  state.planWarnings = result.warnings;
  allScheduledBlocks = result.allBlocks;
  render();
  if (el.weekGrid) { el.weekGrid.scrollTop = scrollTop; el.weekGrid.scrollLeft = scrollLeft; }
  renderProductExtras();
}

function snapToGrid(date, minutes) {
  const copy = new Date(date);
  const remainder = copy.getMinutes() % minutes;
  if (remainder) copy.setMinutes(copy.getMinutes() + minutes - remainder);
  copy.setSeconds(0, 0);
  return copy;
}

function calendarCategoryFor(item) {
  if (item.type === "event") return "fixed";
  const storedCategory = item.calendarCategory || state.entries.find(entry => entry.id === item.entryId)?.calendarCategory;
  if (storedCategory && calendarCategoryDefinitions[storedCategory] && storedCategory !== "all") return storedCategory;
  const text = normalizeText(item.title || item.text || "");
  if (/\b(vaga|candidat|curricul|linkedin|entrevist|emprego|processo seletivo|recrutad)/.test(text)) return "career";
  if (/\b(academia|cardio|corrid|caminhad|biciclet|treino|muscul|saude|fisioter|medit|sono)/.test(text)) return "health";
  if (/\b(trabalho meio periodo|expediente|turno|reuniao de trabalho|cliente|plantao)/.test(text)) return "work";
  if (/\b(projet|portfolio|desenvolv|programar|programacao pratica|codigo|aplicac|deploy)/.test(text)) return "project";
  if (/\b(estud|curso|aula|teoria|exerc|simulad|revis|aprend|leitura|prova)/.test(text)) return "study";
  if (/\b(marmit|refeic|cozinh|mercado|limpez|arrum|organizar casa)/.test(text)) return "routine";
  if (/\b(pagar|document|email|mensage|ligar|agend|confirm|banco|imposto)/.test(text)) return "admin";
  return item.type === "routine" ? "routine" : "personal";
}

function calendarCategoryStyle(categoryId) {
  const category = calendarCategoryDefinitions[categoryId] || calendarCategoryDefinitions.personal;
  return `--category-color:${category.color};--category-bg:${category.background};`;
}

function renderCalendarFilters() {
  if (!el.calendarFilters) return;
  const visiblePlan = calendarView === "week"
    ? state.plan.filter(item => isSameWeek(new Date(item.start), getVisibleWeekStart()))
    : state.plan;
  const counts = visiblePlan.reduce((result, item) => {
    const category = calendarCategoryFor(item);
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  const categoryIds = ["all", ...Object.keys(calendarCategoryDefinitions).filter(id => id !== "all" && counts[id])];
  if (calendarCategoryFilter !== "all" && !categoryIds.includes(calendarCategoryFilter)) calendarCategoryFilter = "all";
  el.calendarFilters.innerHTML = categoryIds.map(id => {
    const category = calendarCategoryDefinitions[id];
    const count = id === "all" ? visiblePlan.length : counts[id] || 0;
    return `<button type="button" data-calendar-category="${id}" class="${calendarCategoryFilter === id ? "active" : ""}" aria-pressed="${calendarCategoryFilter === id}" style="${calendarCategoryStyle(id)}"><i></i><span>${category.label}</span><b>${count}</b></button>`;
  }).join("");
  el.calendarFilters.querySelectorAll("[data-calendar-category]").forEach(button => on(button, "click", () => {
    calendarCategoryFilter = button.dataset.calendarCategory;
    render();
  }));
}

function formatCalendarMinutes(minutes) {
  if (minutes <= 0) return "Livre";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h planejadas`;
}
function render() {
  updateGoalProgress();
  const weekStart = calendarView === "day" ? selectedDay : getVisibleWeekStart();
  if (el.calendarEyebrow) el.calendarEyebrow.textContent = calendarView === "month" ? "Mes" : calendarView === "day" ? "Seu dia" : "Sua semana";
  if (el.toggleCalendarView) el.toggleCalendarView.textContent = calendarView === "month" ? "Ver semana" : "Ver mes";
  el.calendarViewButtons.forEach(button => {
    const active = button.dataset.calendarView === calendarView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (el.weekTitle) {
    el.weekTitle.textContent = calendarView === "month"
      ? monthCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      : calendarView === "day" ? weekStart.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "short" }) : `${formatDate(weekStart)} a ${formatDate(addDays(weekStart, 6))}`;
  }
  if (el.statGoals) el.statGoals.textContent = state.goals.filter(goal => goal.status === "active").length;
  if (el.statItems) el.statItems.textContent = agendaEntries().filter(isEntryActive).length;
  if (el.statReports) el.statReports.textContent = state.reports.length;
  if (el.statFocus) el.statFocus.textContent = formatFocusHours(state.plan);
  renderChecklist();
  renderCalendarFilters();
  if (calendarView === "month") renderMonth(monthCursor);
  else renderWeek(weekStart);
  renderGoals();
  renderInsights();
  renderPlanningWarnings();
  renderGoalLegend();
  renderEntries();
}

function renderGoalLegend() {
  if (!el.goalLegend) return;
  const goals = state.goals.filter(goal => goal.status !== "completed");
  el.goalLegend.hidden = goals.length === 0;
  el.goalLegend.innerHTML = goals.map(goal => `
    <span style="${visualStyleForGoal(goal.id)}"><i></i>${escapeHtml(goal.title)}</span>
  `).join("");
}
function renderPlanningWarnings() {
  if (!el.planWarnings) return;
  const warnings = state.planWarnings || [];
  el.planWarnings.hidden = warnings.length === 0;
  if (!warnings.length) {
    el.planWarnings.innerHTML = "";
    return;
  }
  el.planWarnings.innerHTML = `
    <details><summary>${warnings.length} pendencia(s) para revisar</summary>
    <div class="warning-list">${warnings.map(warning => `
      <button type="button" data-warning-entry="${warning.entryId}">
        <span>${escapeHtml(warning.text)}</span><small>${escapeHtml(warning.date)} - ${escapeHtml(warning.reason)}</small>
      </button>`).join("")}</div></details>`;
  el.planWarnings.querySelectorAll("[data-warning-entry]").forEach(button => on(button, "click", () => openEntryEditor(button.dataset.warningEntry)));
}

function renderGoals() {
  if (!el.goalsBoard) return;
  const goals = [...state.goals].sort((a, b) => {
    if (a.status === "completed" && b.status !== "completed") return 1;
    if (a.status !== "completed" && b.status === "completed") return -1;
    return b.priority - a.priority;
  });
  if (!goals.length) {
    el.goalsBoard.innerHTML = `<div class="empty-state"><strong>Nenhuma meta definida.</strong><p>Descreva um objetivo na caixa ou crie uma meta manualmente. A IA vai transformar isso em etapas.</p></div>`;
    return;
  }
  el.goalsBoard.innerHTML = goals.map(goal => {
    const tasks = state.entries
      .filter(entry => entry.goalId === goal.id)
      .sort((a, b) => Number(a.planOrder || 999) - Number(b.planOrder || 999) || String(a.phase || "").localeCompare(String(b.phase || "")));
    const next = tasks.find(entry => isEntryActive(entry));
    const completed = tasks.filter(entry => entry.status === "completed").length;
    const criteria = normalizeStringList(goal.successCriteria);
    const milestoneCount = new Set(tasks.map(task => task.milestone || "Proximos passos")).size;
    return `
      <article class="goal-card ${goal.status}" style="${visualStyleForGoal(goal.id)}">
        <div class="goal-card-heading">
          <div><span class="status-label">${goal.status === "completed" ? "Concluida" : goal.status === "paused" ? "Pausada" : "Ativa"}</span><h3>${escapeHtml(goal.title)}</h3></div>
          <button type="button" data-edit-goal="${goal.id}">Editar</button>
        </div>
        <p>${escapeHtml(goal.description || "Sem descricao.")}</p>
        ${goal.strategy ? `<div class="goal-strategy"><strong>Estrategia</strong><p>${escapeHtml(goal.strategy)}</p></div>` : ""}
        ${criteria.length ? `<div class="goal-success"><strong>O que significa atingir esta meta</strong><ul>${criteria.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
        <div class="progress-track"><span style="width:${Math.min(100, Number(goal.progress || 0))}%"></span></div>
        <div class="goal-meta"><span>${goal.progress || 0}% do plano executado</span><span>${goal.targetDate ? `Alvo ${formatDate(new Date(`${goal.targetDate}T12:00`))}` : "Sem prazo"}</span><span>${formatWeeklyMinutes(goal.weeklyMinutes)}</span></div>
        <small>${next ? `Proxima acao: ${escapeHtml(next.text)}` : tasks.length ? "Plano concluido ou pausado." : "Ainda sem plano de execucao."}</small>
        ${tasks.length ? `<details class="goal-plan" ><summary>${completed}/${tasks.length} etapas em ${milestoneCount} marco(s)</summary>${renderGoalRoadmap(tasks)}</details>` : ""}
        ${goal.status === "active" ? `<div class="goal-card-actions"><button class="plan-goal" type="button" data-plan-goal="${goal.id}">${tasks.length ? "Revisar plano com IA" : "Criar plano com IA"}</button></div>` : ""}
      </article>`;
  }).join("");
  el.goalsBoard.querySelectorAll("[data-edit-goal]").forEach(button => on(button, "click", () => openGoalEditor(button.dataset.editGoal)));
  el.goalsBoard.querySelectorAll("[data-plan-goal]").forEach(button => on(button, "click", () => requestGoalPlan(button.dataset.planGoal, button)));
  el.goalsBoard.querySelectorAll("[data-edit-goal-task]").forEach(button => on(button, "click", () => openEntryEditor(button.dataset.editGoalTask)));
}

function renderGoalRoadmap(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const milestone = task.milestone || "Proximos passos";
    if (!groups.has(milestone)) groups.set(milestone, []);
    groups.get(milestone).push(task);
  });
  return `<div class="goal-roadmap">${[...groups.entries()].map(([milestone, items]) => {
    const done = items.filter(item => item.status === "completed").length;
    return `<section class="roadmap-stage">
      <div class="roadmap-stage-heading"><strong>${escapeHtml(milestone)}</strong><span>${done}/${items.length}</span></div>
      <div class="roadmap-tasks">${items.map((task, index) => renderRoadmapTask(task, index)).join("")}</div>
    </section>`;
  }).join("")}</div>`;
}

function renderRoadmapTask(task, index) {
  const instructions = normalizeStringList(task.instructions);
  return `<details class="roadmap-task ${task.status === "completed" ? "completed" : ""}">
    <summary><span class="step-number">${task.status === "completed" ? "OK" : Number(task.planOrder || index + 1)}</span><span><strong>${escapeHtml(task.text)}</strong><small>${task.duration} min${task.date ? ` · ${formatDate(new Date(`${task.date}T12:00`))}` : " · aguardando encaixe"}</small></span></summary>
    <div class="roadmap-task-body">
      ${instructions.length ? `<strong>Como fazer</strong><ol>${instructions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : `<p>Peça à IA para revisar o plano e detalhar esta etapa.</p>`}
      ${task.completionCriteria ? `<p><strong>Conclua quando:</strong> ${escapeHtml(task.completionCriteria)}</p>` : ""}
      <button type="button" data-edit-goal-task="${task.id}">Editar etapa</button>
    </div>
  </details>`;
}

function formatWeeklyMinutes(value) {
  const minutes = Math.max(30, Number(value || 240));
  return minutes < 60 ? `${minutes} min/semana` : `${Number((minutes / 60).toFixed(1))}h/semana`;
}

async function requestGoalPlan(goalId, button) {
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) return;
  const originalLabel = button?.textContent || "Planejar com IA";
  if (button) {
    button.disabled = true;
    button.textContent = "Planejando...";
  }
  const prompt = `Oriente-me para atingir a meta existente "${goal.title}". Resultado esperado: ${goal.description || "a definir"}. Prazo: ${goal.targetDate || "sem prazo definido"}. Analise as etapas que ja existem, preserve o que continua valido e nao duplique tarefas. Crie ou revise uma estrategia de longo prazo com marcos claros, conteudos especificos para aprender ou praticar, instrucoes de como executar cada etapa e criterios verificaveis de conclusao. Distribua a carga de forma realista na minha rotina.`;
  try {
    await addQuickEntry(prompt, goal.id);
  } finally {
    if (button?.isConnected) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

function visualStyleForGoal(goalId) {
  if (!goalId) return "";
  const ids = state.goals.map(goal => goal.id);
  const index = Math.max(0, ids.indexOf(goalId));
  const colors = [["#246eaa", "#e8f2fc"], ["#ba4c76", "#fcecf3"], ["#21816a", "#e6f5ee"], ["#bd7b12", "#fff4db"], ["#7752a6", "#f0eafa"], ["#b94737", "#fcebe8"], ["#327e85", "#e6f5f6"]];
  const [color, background] = colors[index % colors.length];
  return "--goal-color:" + color + ";--goal-bg:" + background + ";";
}

// Tarefas da rodada diaria ficam so no checklist: fora das listas, prazos e contagens.
function agendaEntries() { return state.entries.filter(entry => !Planner.isSyncTask(entry)); }

function todayKey() { return Checklist.localDay(new Date().toISOString()); }

function formatDay(day) { return `${day.slice(8, 10)}/${day.slice(5, 7)}`; }

function obsidianLink(note) { return `obsidian://open?vault=${encodeURIComponent(OBSIDIAN_VAULT)}&file=${encodeURIComponent(note)}`; }

function recordTodayOpen() {
  const opens = Checklist.recordOpen(state.opens || [], todayKey());
  if (opens.length === (state.opens || []).length) return;
  state.opens = opens;
  saveChecklistChange();
}

// Sincroniza sem mexer no planningAt: decidir uma tarefa do checklist nao replaneja o dia.
function saveChecklistChange() {
  syncDirty = true;
  saveLocalSnapshot();
  syncToServer();
  renderChecklist();
}

function renderChecklist() {
  if (!el.checklist) return;
  const today = todayKey();
  renderChecklistMetrics(today);
  const { groups, paused } = Checklist.buildChecklist({ entries: state.entries, projects: state.projects || [], goals: state.goals, today });
  if (!groups.length && !paused.length) {
    el.checklist.innerHTML = `<p class="muted">Nenhuma tarefa aberta. A rodada diaria traz as proximas a partir das suas sessoes.</p>`;
    return;
  }
  const first = groups.slice(0, CHECKLIST_OPEN_GROUPS).map(renderProjectGroup).join("");
  const rest = groups.slice(CHECKLIST_OPEN_GROUPS);
  const more = rest.length
    ? `<details class="more-projects"${checklistMoreOpen ? " open" : ""}><summary>Mais ${rest.length} ${rest.length === 1 ? "projeto" : "projetos"}: ${escapeHtml(rest.map(group => group.project.name).join(", "))}</summary>${rest.map(renderProjectGroup).join("")}</details>`
    : "";
  el.checklist.innerHTML = first + more + (paused.length ? renderPausedProjects(paused) : "");
}

function renderChecklistMetrics(today) {
  if (!el.checklistMetrics) return;
  const metrics = Checklist.checklistMetrics({ entries: state.entries, opens: state.opens || [], today });
  const parts = [`Aberto em ${metrics.openDays} de 7 dias`, `${metrics.manualTasks} ${metrics.manualTasks === 1 ? "tarefa criada" : "tarefas criadas"} a mao`];
  if (metrics.acceptance !== null) parts.push(`${Math.round(metrics.acceptance * 100)}% das sugestoes aceitas (${metrics.confirmed} de ${metrics.confirmed + metrics.dismissed})`);
  el.checklistMetrics.textContent = parts.join(" · ");
}

function renderProjectGroup(group) {
  const { project } = group;
  const idle = group.idleDays === null ? "" : group.idleDays <= 0 ? "mexido hoje" : `parado ha ${group.idleDays} ${group.idleDays === 1 ? "dia" : "dias"}`;
  const facts = [idle, group.deadline ? `prazo ${formatDay(group.deadline)}` : "", project.note ? `<a href="${escapeHtml(obsidianLink(project.note))}">nota no Obsidian</a>` : ""].filter(Boolean).join(" · ");
  const priority = Number(project.priority || 2);
  const priorityOptions = [[3, "Alta"], [2, "Media"], [1, "Baixa"]].map(([value, label]) => `<option value="${value}"${priority === value ? " selected" : ""}>${label}</option>`).join("");
  const goalOptions = state.goals.filter(goal => goal.status !== "completed")
    .map(goal => `<option value="${escapeHtml(goal.id)}"${project.goalId === goal.id ? " selected" : ""}>${escapeHtml(String(goal.title || ""))}</option>`).join("");
  // So a proxima tarefa de cada projeto fica a vista; o resto abre sob demanda.
  const expanded = checklistExpanded.has(project.id);
  const hidden = group.tasks.length - 1;
  const toggle = hidden > 0 ? `<button type="button" class="checklist-more-tasks" data-project-action="expand">${expanded ? "Mostrar so a proxima" : `+${hidden} ${hidden === 1 ? "tarefa" : "tarefas"}`}</button>` : "";
  return `
    <article class="project-group" data-project-id="${escapeHtml(project.id)}">
      <header class="project-head">
        <div class="project-title">
          <strong>${escapeHtml(String(project.name))}</strong>
          <span class="tag">${escapeHtml(String(project.area))}</span>
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
      <ol class="checklist-tasks">${(expanded ? group.tasks : group.tasks.slice(0, 1)).map(renderChecklistTask).join("")}</ol>
      ${toggle}
      ${group.doneToday.length ? `<ul class="done-today">${group.doneToday.map(renderDoneToday).join("")}</ul>` : ""}
    </article>`;
}

function renderChecklistTask(task) {
  const suggested = task.status === "sugerida";
  return `
    <li class="checklist-task${suggested ? " suggested" : ""}" data-task-id="${escapeHtml(task.id)}">
      <div class="checklist-task-main">
        <strong>${escapeHtml(String(task.text))}</strong>
        ${suggested ? `<span class="tag">sugerida</span>` : ""}
        ${task.date ? `<span class="tag tag-due">ate ${formatDay(task.date)}</span>` : ""}
        ${task.context ? `<p>${escapeHtml(String(task.context))}</p>` : ""}
      </div>
      <div class="checklist-task-actions">
        ${suggested ? `<button type="button" data-action="confirm">Confirmar</button>` : ""}
        <button type="button" data-action="done">Feito</button>
        <button type="button" data-action="dismiss" class="danger">Descartar</button>
      </div>
    </li>`;
}

function renderDoneToday(task) {
  const by = task.doneBy ? ` pela sessao de ${formatDay(task.doneBy.day)}${task.doneBy.evidence ? `: ${escapeHtml(String(task.doneBy.evidence))}` : ""}` : "";
  return `<li data-task-id="${escapeHtml(task.id)}"><span>Feita: <strong>${escapeHtml(String(task.text))}</strong>, concluida${by}</span><button type="button" data-action="undo">Desfazer</button></li>`;
}

function renderPausedProjects(paused) {
  const rows = paused.map(group => `<div class="paused-row" data-project-id="${escapeHtml(group.project.id)}"><span>${escapeHtml(String(group.project.name))} <small>${group.tasks.length} ${group.tasks.length === 1 ? "tarefa" : "tarefas"}</small></span><button type="button" data-project-action="resume">Retomar</button></div>`).join("");
  return `<details class="paused-projects"><summary>${paused.length} ${paused.length === 1 ? "projeto pausado" : "projetos pausados"}</summary>${rows}</details>`;
}

function handleChecklistClick(event) {
  const button = event.target.closest("button");
  if (!button) return;
  const now = new Date().toISOString();
  const taskId = button.closest("[data-task-id]")?.dataset.taskId;
  const projectId = button.closest("[data-project-id]")?.dataset.projectId;
  if (button.dataset.projectAction === "expand") {
    if (!checklistExpanded.delete(projectId)) checklistExpanded.add(projectId);
    return renderChecklist();
  }
  if (button.dataset.action && taskId) state.entries = state.entries.map(entry => entry.id === taskId ? Checklist.applyTaskAction(entry, button.dataset.action, now) : entry);
  else if (button.dataset.projectAction && projectId) updateProject(projectId, { paused: button.dataset.projectAction === "pause" }, now);
  else return;
  saveChecklistChange();
}

function handleChecklistChange(event) {
  const field = event.target.dataset.field;
  const projectId = event.target.closest("[data-project-id]")?.dataset.projectId;
  if (!field || !projectId) return;
  updateProject(projectId, { [field]: field === "priority" ? Number(event.target.value) : event.target.value || null }, new Date().toISOString());
  saveChecklistChange();
}

function updateProject(projectId, changes, now) {
  state.projects = (state.projects || []).map(project => project.id === projectId ? Checklist.applyProjectChange(project, changes, now) : project);
}

function renderInsights() {
  renderTodayAgenda();
  renderDeadlines();
  renderRecentCheckins();
}

function renderRecentCheckins() {
  if (!el.recentCheckins) return;
  const reports = [...state.reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  if (!reports.length) {
    el.recentCheckins.innerHTML = `<p class="muted">Conte como foi seu dia. O planejamento usa isso para ajustar carga, ordem e horarios.</p>`;
    return;
  }
  el.recentCheckins.innerHTML = reports.map(report => `
    <div class="checkin-item">
      <time>${new Date(report.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</time>
      <span>${escapeHtml(report.text || "Check-in por audio")}</span>
    </div>
  `).join("");
}

function renderTodayAgenda() {
  if (!el.todayAgenda) return;
  const today = new Date();
  const blocks = allScheduledBlocks
    .filter(item => isSameDay(new Date(item.start), today))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  if (!blocks.length) {
    el.todayAgenda.innerHTML = `<p class="muted">Nenhum bloco planejado para hoje nesta visao. Use Hoje ou Reorganizar semana.</p>`;
    return;
  }

  el.todayAgenda.innerHTML = blocks.slice(0, 6).map(item => `
    <div class="compact-item ${item.type} ${item.goalId ? "goal-linked" : ""}" style="${visualStyleForGoal(item.goalId)}">
      <time>${formatTime(item.start)}-${formatTime(item.end)}</time>
      <span>${escapeHtml(item.title)}</span>
    </div>
  `).join("");
}

function renderDeadlines() {
  if (!el.deadlineList) return;
  const today = startOfDay(new Date());
  const upcoming = agendaEntries()
    .filter(entry => isEntryActive(entry) && (entry.deadline || entry.date) && new Date(`${entry.deadline || entry.date}T12:00`) >= today)
    .sort((a, b) => new Date(a.deadline || a.date) - new Date(b.deadline || b.date) || b.priority - a.priority)
    .slice(0, 6);

  if (!upcoming.length) {
    el.deadlineList.innerHTML = `<p class="muted">Sem prazos futuros cadastrados.</p>`;
    return;
  }

  el.deadlineList.innerHTML = upcoming.map(entry => {
    const date = new Date(`${entry.deadline || entry.date}T12:00`);
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
  el.weekGrid.className = "week-grid timeline-week" + (calendarView === "day" ? " day-view" : "");
  const count = calendarView === "day" ? 1 : 7;
  el.weekGrid.innerHTML = "";
  const { startMinutes, endMinutes } = timelineBounds(weekStart);
  const pixelsPerMinute = 1.3;
  el.weekGrid.style.setProperty("--hour-height", "78px");
  const timelineHeight = (endMinutes - startMinutes) * pixelsPerMinute;
  const corner = document.createElement("div");
  corner.className = "timeline-corner";
  corner.textContent = "Hora";
  el.weekGrid.append(corner);

  for (let day = 0; day < count; day += 1) {
    const date = addDays(weekStart, day);
    const dayBlocks = state.plan.filter(item => isSameDay(new Date(item.start), date));
    const plannedMinutes = dayBlocks.reduce((total, item) => total + Number(item.duration || 0), 0);
    const heading = document.createElement("div");
    heading.className = `timeline-heading ${isSameDay(date, new Date()) ? "today" : ""}`;
    heading.innerHTML = `<strong>${weekDays[(date.getDay() + 6) % 7]}</strong><span>${formatDate(date)}</span><small>${formatCalendarMinutes(plannedMinutes)}</small>`;
    el.weekGrid.append(heading);
  }

  const axis = document.createElement("div");
  axis.className = "timeline-axis";
  axis.style.height = `${timelineHeight}px`;
  for (let minute = Math.ceil(startMinutes / 60) * 60; minute <= endMinutes; minute += 60) {
    const label = document.createElement("time");
    label.style.top = `${(minute - startMinutes) * pixelsPerMinute}px`;
    label.textContent = minutesToTime(minute);
    axis.append(label);
  }
  el.weekGrid.append(axis);

  for (let day = 0; day < count; day += 1) {
    const date = addDays(weekStart, day);
    const column = document.createElement("article");
    column.className = `timeline-day ${isSameDay(date, new Date()) ? "today" : ""}`;
    column.style.height = `${timelineHeight}px`;
    const allBlocks = state.plan.filter(item => isSameDay(new Date(item.start), date)).sort((a, b) => new Date(a.start) - new Date(b.start));

    if (showFreeTime) {
      freeIntervalsForDay(date, startMinutes, endMinutes, allBlocks).forEach(interval => {
        const free = document.createElement("div");
        free.className = "free-block";
        free.style.top = `${(interval.start - startMinutes) * pixelsPerMinute}px`;
        free.style.height = `${Math.max(1, interval.duration * pixelsPerMinute - 1)}px`;
        if (interval.duration >= 60) free.innerHTML = `<small>Livre · ${Math.round(interval.duration / 60 * 10) / 10}h</small>`;
        column.append(free);
      });
    }

    layoutDayBlocks(allBlocks).forEach(({ item, lane, laneCount }) => {
      const block = document.createElement("div");
      const blockStart = dateMinutes(new Date(item.start));
      const blockEnd = isSameDay(new Date(item.start), new Date(item.end)) ? dateMinutes(new Date(item.end)) : 1440;
      const blockMinutes = Math.max(1, blockEnd - blockStart);
      const width = 100 / laneCount;
      const categoryId = calendarCategoryFor(item);
      const category = calendarCategoryDefinitions[categoryId];
      const goal = state.goals.find(candidate => candidate.id === item.goalId);
      const goalStyle = visualStyleForGoal(item.goalId);
      const densityClass = blockMinutes <= 30 ? "tiny" : blockMinutes <= 60 ? "compact" : "comfortable";
      const mutedClass = calendarCategoryFilter !== "all" && calendarCategoryFilter !== categoryId ? "is-muted" : "";
      block.className = `timeline-block category-${categoryId} ${densityClass} ${mutedClass} ${item.goalId ? "goal-linked" : ""}`;
      if (item.completed) block.classList.add("is-completed");
      block.dataset.category = categoryId;
      block.tabIndex = 0;
      block.setAttribute("role", "button");
      block.setAttribute("aria-label", item.title + " " + formatTime(item.start) + " a " + formatTime(item.end));
      block.title = `${formatTime(item.start)}-${formatTime(item.end)} - ${category.label} - ${item.title}`;
      block.style.cssText = `top:${(blockStart - startMinutes) * pixelsPerMinute}px;left:calc(${lane * width}% + 3px);width:calc(${width}% - 6px);height:${Math.max(10, blockMinutes * pixelsPerMinute - 2)}px;${calendarCategoryStyle(categoryId)}${goalStyle}`;
      block.innerHTML = blockMinutes <= 30
        ? `<div class="block-compact-line"><time>${formatTime(item.start)}</time><strong>${escapeHtml(item.title)}</strong></div>`
        : `<div class="block-meta"><time>${formatTime(item.start)}-${formatTime(item.end)}</time><span class="category-pill"><i></i>${category.label}</span></div>
           <strong class="block-title">${escapeHtml(item.title)}</strong>
           ${goal && blockMinutes >= 90 ? `<small class="block-goal">${escapeHtml(goal.title)}</small>` : ""}`;
      on(block, "click", () => openBlockDetails(item));
      on(block, "keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openBlockDetails(item);
        }
      });
      column.append(block);
    });
    on(column, "click", event => {
      if (event.target.closest(".timeline-block")) return;
      const rect = column.getBoundingClientRect();
      const clickedMinute = snapMinutes(startMinutes + Math.max(0, event.clientY - rect.top) / pixelsPerMinute, 15);
      openEntryEditor("", "", { date: toInputDate(date), time: minutesToTime(clickedMinute), timeLocked: true });
    });
    el.weekGrid.append(column);
  }
}

function layoutDayBlocks(blocks) {
  const parents = blocks.map((_, index) => index);
  const find = index => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const join = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < blocks.length; left += 1) {
    for (let right = left + 1; right < blocks.length; right += 1) {
      if (new Date(blocks[left].start) < new Date(blocks[right].end) && new Date(blocks[right].start) < new Date(blocks[left].end)) join(left, right);
    }
  }

  const clusters = new Map();
  blocks.forEach((item, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(item);
  });

  const positioned = [];
  clusters.forEach(cluster => {
    const laneEnds = [];
    const assignments = [];
    cluster.sort((left, right) => new Date(left.start) - new Date(right.start)).forEach(item => {
      const start = new Date(item.start);
      const lane = laneEnds.findIndex(end => end <= start);
      const assignedLane = lane < 0 ? laneEnds.length : lane;
      laneEnds[assignedLane] = new Date(item.end);
      assignments.push({ item, lane: assignedLane });
    });
    assignments.forEach(assignment => positioned.push({ ...assignment, laneCount: laneEnds.length }));
  });
  return positioned.sort((left, right) => new Date(left.item.start) - new Date(right.item.start));
}
function timelineBounds(weekStart) {
  const preferenceStart = timeToMinutes(state.preferences.weekdayStart || "08:00");
  const preferenceEnd = timeToMinutes(state.preferences.weekdayEnd || "21:00");
  const weekBlocks = state.plan.filter(item => isSameWeek(new Date(item.start), weekStart));
  const earliest = weekBlocks.length ? Math.min(...weekBlocks.map(item => dateMinutes(new Date(item.start)))) : preferenceStart;
  const latest = weekBlocks.length ? Math.max(...weekBlocks.map(item => dateMinutes(new Date(item.end)))) : preferenceEnd;
  return {
    startMinutes: Math.max(0, Math.floor(Math.min(preferenceStart, earliest) / 60) * 60),
    endMinutes: Math.min(1440, Math.ceil(Math.max(preferenceEnd, latest) / 60) * 60)
  };
}

function freeIntervalsForDay(date, startMinutes, endMinutes, blocks) {
  const intervals = [];
  let cursor = startMinutes;
  blocks.forEach(block => {
    const start = Math.max(startMinutes, dateMinutes(new Date(block.start)));
    const end = Math.min(endMinutes, dateMinutes(new Date(block.end)));
    if (start > cursor) intervals.push({ start: cursor, end: start, duration: start - cursor });
    cursor = Math.max(cursor, end);
  });
  if (cursor < endMinutes) intervals.push({ start: cursor, end: endMinutes, duration: endMinutes - cursor });
  return intervals;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return hours * 60 + minutes;
}

function dateMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.min(1440, minutes));
  return `${String(Math.floor(safe / 60) % 24).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function snapMinutes(minutes, step) {
  return Math.max(0, Math.min(1439, Math.round(minutes / step) * step));
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
      ${dayItems.slice(0, 3).map(item => { const categoryId = calendarCategoryFor(item); const muted = calendarCategoryFilter !== "all" && calendarCategoryFilter !== categoryId ? "is-muted" : ""; return `<small class="category-item ${muted} ${item.goalId ? "goal-linked" : ""}" style="${calendarCategoryStyle(categoryId)}${visualStyleForGoal(item.goalId)}"><i></i>${escapeHtml(item.text || item.title)}</small>`; }).join("")}
    `;
    cell.addEventListener("click", () => {
      calendarView = "day";
      selectedDay = date;
      weekOffset = Math.round((getMonday(date) - getMonday(new Date())) / (7 * 24 * 60 * 60 * 1000));
      generatePlan();
    });
    el.weekGrid.append(cell);
  }
}

function getItemsForDate(date) { return state.plan.filter(item => isSameDay(new Date(item.start), date)); }

function renderPomodoroTags(item) {
  if (!Array.isArray(item.pomodoros) || item.pomodoros.length <= 1 || Number(item.duration || 0) < 90) return "";
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
      saveLocalSnapshot();
    }
  });
}

function renderFocus(now = new Date()) {
  const panel = document.querySelector(".focus-panel");
  if (panel) panel.hidden = !alarmsEnabled;
  if (!el.focusTitle || !el.focusDetail || !el.focusTimer) return;
  const active = allScheduledBlocks.find(item => now >= new Date(item.start) && now < new Date(item.end));
  const next = [...allScheduledBlocks].sort((a, b) => a.start.localeCompare(b.start)).find(item => new Date(item.start) > now);

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
  return allScheduledBlocks.filter(item => !item.completed).flatMap(item => {
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
  oscillator.onended = () => context.close();
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

function renderTaskGuidance(entry) {
  const instructions = normalizeStringList(entry.instructions);
  if (!instructions.length && !entry.completionCriteria && !entry.milestone) return "";
  return `<details class="task-guidance">
    <summary>${entry.milestone ? escapeHtml(entry.milestone) : "Orientacao da etapa"}</summary>
    ${instructions.length ? `<ol>${instructions.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : ""}
    ${entry.completionCriteria ? `<p><strong>Conclua quando:</strong> ${escapeHtml(entry.completionCriteria)}</p>` : ""}
  </details>`;
}
function renderEntries() {
  if (!el.entriesList) return;
  el.entriesList.innerHTML = "";
  const entries = agendaEntries();
  if (entries.length === 0) {
    el.entriesList.innerHTML = `<p class="muted">Adicione compromissos, rotinas e metas para montar a semana.</p>`;
    return;
  }
  entries
    .sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || b.priority - a.priority)
    .forEach(entry => {
    const card = document.createElement("article");
    card.className = `entry-card ${entry.status || "pending"} ${entry.goalId ? "goal-linked" : ""}`;
    card.style.cssText = visualStyleForGoal(entry.goalId);
    const goal = state.goals.find(item => item.id === entry.goalId);
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(entry.text)}</strong>
        <small>${labelFor(entry.type)} · ${entry.duration} min · prioridade ${entry.priority}${entry.date ? ` · ${entry.date}${entry.time ? ` ${entry.time}` : ""}` : ""}${entry.deadline ? ` · prazo ${entry.deadline}` : ""}</small>
        ${goal ? `<small class="goal-link">Meta: ${escapeHtml(goal.title)}</small>` : ""}
        ${renderTaskGuidance(entry)}
      </div>
      <div class="entry-actions">
        ${entry.status !== "completed" ? `<button data-complete-entry="${entry.id}" type="button">Concluir</button>` : `<span class="done-label">Concluida</span>`}
        <button data-edit-entry="${entry.id}" type="button">Editar</button>
      </div>
    `;
    on(card.querySelector("[data-complete-entry]"), "click", () => completeEntry(entry.id));
    on(card.querySelector("[data-edit-entry]"), "click", () => openEntryEditor(entry.id));
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
  if (!confirm("Excluir metas, tarefas e relatos da agenda compartilhada com o Telegram? Uma copia anterior ficara nos backups do servidor.")) return;
  localStorage.setItem(STORAGE_KEY + "-recovery", JSON.stringify(state));
  state.goals = [];
  state.entries = [];
  state.reports = [];
  state.plan = [];
  pendingProposal = null;
  recordManualChange("delete", "Agenda", "Limpeza confirmada pelo usuario");
  persist();
  generatePlan();
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
