function dataSnapshot() {
  return structuredClone({ goals: state.goals, entries: state.entries, reports: state.reports, projects: state.projects || [], opens: state.opens || [], preferences: state.preferences, history: state.history || [], revision: state.revision || 0, planningAt: state.planningAt });
}
function saveLocalSnapshot() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(STORAGE_KEY + "-dirty", String(syncDirty));
  if (syncBase) localStorage.setItem(STORAGE_KEY + "-base", JSON.stringify(syncBase));
}
function acceptServerState(data) {
  syncBase = structuredClone(data);
  Object.assign(state, Planner.normalize(data));
  syncDirty = false;
  saveLocalSnapshot();
  hydratePreferenceFields();
  generatePlan();
}
function syncStatus(message, error) {
  const status = document.querySelector("#syncStatus");
  if (status) { status.textContent = message; status.classList.toggle("error", error); }
}
function showSyncConflict(result) {
  localStorage.setItem(STORAGE_KEY + "-recovery", JSON.stringify(state));
  const panel = document.querySelector("#syncConflict");
  if (!panel) return;
  panel.hidden = false;
  panel.querySelector("p").textContent = "Edicoes simultaneas: " + (result.conflicts || []).map(item => item.title).join(", ");
}
function recordManualChange(action, title, reason) {
  state.history ||= [];
  state.history.push({ id: crypto.randomUUID(), at: new Date().toISOString(), summary: "Edicao manual", changes: [{ action, title, reason }] });
  state.history = state.history.slice(-100);
}
function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function changeLabel(action) {
  return ({ create: "Criar", edit: "Editar", delete: "Excluir", complete: "Concluir", pause: "Pausar", resume: "Retomar", reschedule: "Reagendar", adjust_duration: "Ajustar tempo" })[action] || action;
}
function showProposal(result) {
  document.querySelector("#organizerDialog")?.close();
  const updates = result.updates || [];
  const entries = result.entries || [];
  const detail = change => {
    const update = updates.find(item => item.entryId === change.id);
    const entry = entries.find(item => item.text === change.title);
    if (update) return formatUpdateNotice({ ...update, targetText: change.title });
    if (entry) return [entry.duration + " min totais", entry.date, entry.time, entry.deadline ? "Prazo " + entry.deadline : "", entry.milestone].filter(Boolean).join(" · ");
    return change.reason || "";
  };
  el.interpretationPreview.innerHTML = `<div class="proposal-heading"><strong>Proposta para revisar</strong><span>${escapeHtml(result.model || "Ollama")}</span></div>
    <p>${escapeHtml(result.summary || "")}</p>
    <ul class="proposal-changes">${(result.changes || []).map(change => `<li class="change-${escapeHtml(change.action)}"><span>${changeLabel(change.action)}</span><div><strong>${escapeHtml(change.title)}</strong><small>${escapeHtml(detail(change))}</small></div></li>`).join("")}</ul>
    ${(result.warnings || []).length ? `<details><summary>${result.warnings.length} pendencias no planejamento</summary><ul>${result.warnings.map(w => `<li>${escapeHtml(w.text)}: ${escapeHtml(w.reason)}</li>`).join("")}</ul></details>` : ""}
    <div class="proposal-actions"><button type="button" id="discardProposal">Descartar</button><button type="button" id="applyProposal" class="primary">Confirmar alteracoes</button></div><p id="proposalError" role="alert"></p>`;
  document.querySelector("#discardProposal").onclick = () => { pendingProposal = null; updateInterpretationPreview(); };
  document.querySelector("#applyProposal").onclick = async event => {
    if (!pendingProposal) return;
    const button = event.currentTarget; button.disabled = true;
    try {
      if (syncDirty || syncBusy) throw new Error("Aguarde a sincronizacao e gere uma nova proposta se a agenda mudou.");
      const response = await fetch(`/api/proposals/${pendingProposal.proposalId}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error);
      const original = pendingProposal.originalMessage;
      pendingProposal = null;
      acceptServerState(saved.data);
      if (el.quickMessage.value.trim() === original) { el.quickMessage.value = ""; localStorage.removeItem(STORAGE_KEY + "-draft"); }
      el.interpretationPreview.innerHTML = `<strong>Alteracoes salvas</strong><ul class="result-list">${saved.changes.map(change => `<li>${changeLabel(change.action)}: ${escapeHtml(change.title)}</li>`).join("")}</ul>`;
      syncStatus("Agenda sincronizada", false);
    } catch (error) { document.querySelector("#proposalError").textContent = error.message; button.disabled = false; }
  };
  document.querySelector(".sidebar").hidden = false;
  document.querySelector("#assistantToggle")?.setAttribute("aria-pressed", "true");
  el.interpretationPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function openBlockDetails(block) {
  const entry = state.entries.find(item => item.id === block.entryId);
  if (!entry) return;
  const effective = { ...entry, ...(entry.overrides?.[block.occurrenceDate] || {}) };
  const dialog = document.querySelector("#blockDialog");
  const goal = state.goals.find(item => item.id === block.goalId);
  dialog.innerHTML = `<div class="dialog-heading"><span class="eyebrow">${escapeHtml(calendarCategoryDefinitions[calendarCategoryFor(block)].label)}</span><button type="button" data-close aria-label="Fechar">&#215;</button></div>
    <h2>${escapeHtml(block.title)}</h2><p class="block-detail-time">${formatDate(new Date(block.start))} · ${formatTime(block.start)}–${formatTime(block.end)} · ${block.duration} min</p>
    ${goal ? `<p class="detail-goal" style="${visualStyleForGoal(goal.id)}">${escapeHtml(goal.title)}${effective.milestone ? " · " + escapeHtml(effective.milestone) : ""}</p>` : ""}
    ${effective.instructions?.length ? `<h3>Proximos passos</h3><ol>${effective.instructions.map(text => `<li>${escapeHtml(text)}</li>`).join("")}</ol>` : ""}
    ${effective.completionCriteria ? `<p><strong>Resultado esperado:</strong> ${escapeHtml(effective.completionCriteria)}</p>` : ""}
    <p class="muted">${entry.type === "task" ? `${entry.completedMinutes || 0} de ${entry.duration} min realizados` : ""}</p>
    <details class="session-adjustments"><summary>Fiz so uma parte / adicionar observacao</summary><div class="session-feedback"><label>Tempo realizado (min)<input id="sessionMinutes" type="number" min="0" max="${block.duration}" value="${block.duration}" step="1"></label><label>Observacao<textarea id="sessionNote" rows="2" placeholder="O que avancou ou dificultou?"></textarea></label></div></details>
    <div class="dialog-actions"><button type="button" data-edit>Editar</button><button type="button" data-missed>Nao consegui</button><button class="primary" type="button" data-done ${block.completed ? "disabled" : ""}>${block.completed ? "Registrado" : "Concluir sessao"}</button></div>`;
  dialog.querySelector(".session-adjustments").ontoggle = event => {
    if (!block.completed) dialog.querySelector("[data-done]").textContent = event.target.open ? "Registrar progresso" : "Concluir sessao";
  };
  dialog.querySelector("[data-close]").onclick = () => dialog.close();
  dialog.querySelector("[data-edit]").onclick = () => { dialog.close(); openEntryEditor(entry.id, block.occurrenceDate); };
  const register = async missed => {
    const note = dialog.querySelector("#sessionNote").value.trim();
    const amount = Number(dialog.querySelector("#sessionMinutes").value);
    if (!Number.isFinite(amount) || amount < 0 || amount > block.duration) return;
    if (!missed) {
      if (entry.type === "routine") entry.completionDates = [...new Set([...(entry.completionDates || []), block.occurrenceDate])];
      else if (entry.type === "event") entry.status = "completed";
      else {
        entry.sessionLogs ||= [];
        entry.sessionLogs.push({ id: crypto.randomUUID(), start: block.start, duration: block.duration, minutes: amount, note, recordedAt: new Date().toISOString() });
        entry.completedMinutes = Math.min(entry.duration, (entry.completedMinutes || 0) + amount);
        if (entry.completedMinutes >= entry.duration) entry.status = "completed";
      }
    }
    const text = `${missed ? "Nao consegui realizar" : "Realizei " + amount + " minutos de"} ${entry.text} em ${Planner.dateKey(block.start)}.${note ? " Motivo/observacao: " + note : ""}`;
    state.reports.push({ id: crypto.randomUUID(), text, entryId: entry.id, createdAt: new Date().toISOString(), source: "checkin", minutes: missed ? 0 : amount });
    recordManualChange(missed ? "report" : "complete", entry.text, text);
    persist(); generatePlan(); dialog.close();
    if (missed || note) {
      el.quickMessage.value = text + " Adapte meu plano com base nesse feedback, sem concluir novamente tarefas ja registradas.";
      setInputMode("report"); updateInterpretationPreview();
      document.querySelector(".sidebar").hidden = false;
      el.quickMessage.focus();
    }
  };
  dialog.querySelector("[data-done]").onclick = () => register(false);
  dialog.querySelector("[data-missed]").onclick = () => register(true);
  dialog.showModal();
}
function renderProductExtras() {
  const history = document.querySelector("#changeHistory");
  if (history) history.innerHTML = [...(state.history || [])].reverse().slice(0, 20).map(item => `<details class="history-item"><summary><time>${new Date(item.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time> ${escapeHtml(item.summary)}</summary><ul>${(item.changes || []).map(change => `<li>${changeLabel(change.action)}: ${escapeHtml(change.title)}${change.reason ? " · " + escapeHtml(change.reason) : ""}</li>`).join("")}</ul></details>`).join("") || '<p class="muted">Nenhuma alteracao registrada.</p>';
  const dayList = document.querySelector("#todaySessionList");
  if (dayList) {
    const blocks = allScheduledBlocks.filter(block => Planner.dateKey(block.start) === Planner.dateKey(new Date())).sort((a, b) => a.start.localeCompare(b.start));
    dayList.innerHTML = blocks.map((block, index) => `<button class="session-row" type="button" data-session="${index}" style="${calendarCategoryStyle(calendarCategoryFor(block))}"><time>${formatTime(block.start)}–${formatTime(block.end)}</time><strong>${escapeHtml(block.title)}</strong><small>${block.completed ? "Concluido" : block.duration + " min"}</small></button>`).join("") || '<p class="muted">Nenhuma sessao para hoje.</p>';
    dayList.querySelectorAll("[data-session]").forEach(button => button.onclick = () => openBlockDetails(blocks[Number(button.dataset.session)]));
  }
}
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("simple-ui");
  const shell = document.querySelector(".app-shell");
  const header = document.createElement("header"); header.className = "product-header";
  header.innerHTML = '<a class="product-name" href="#">Minha agenda</a><span id="syncStatus" role="status">Conectando...</span><button type="button" id="openPlans">Meus planos</button>';
  shell.before(header);
  header.querySelector("a").onclick = event => { event.preventDefault(); el.todayWeek.click(); };

  const organizer = document.createElement("dialog"); organizer.id = "organizerDialog"; organizer.className = "organizer-dialog";
  organizer.innerHTML = '<div class="dialog-heading"><h2>Meus planos</h2><button type="button" id="closeOrganizer" aria-label="Fechar planos" title="Fechar">&#215;</button></div><div id="organizerContent"></div>';
  document.body.append(organizer);
  const content = organizer.querySelector("#organizerContent");
  const groups = {};
  function group(key, title, nodes) {
    const details = document.createElement("details"); details.className = "organizer-group"; details.id = "organizer-" + key;
    const summary = document.createElement("summary"); summary.textContent = title; details.append(summary);
    nodes.forEach(node => { node.hidden = false; details.append(node); });
    content.append(details); groups[key] = details;
    return details;
  }
  group("goals", "Metas", [document.querySelector(".goals-panel")]);
  group("tasks", "Todas as tarefas e rotinas", [el.entriesList.closest("section")]);
  const history = document.createElement("section"); history.className = "history-section";
  history.innerHTML = '<h3>Alteracoes recentes</h3><div id="changeHistory"></div>';
  group("history", "Relatos e historico", [el.recentCheckins.closest("article"), history]);
  const settings = document.createElement("section"); settings.className = "connection-settings";
  settings.innerHTML = '<h3>Conexoes e dados</h3><label>Motor de planejamento <select id="aiProvider"><option value="ollama">Ollama</option><option value="claude">Claude Code (assinatura)</option></select></label><p id="aiStatus">Verificando conexoes...</p><p id="connectionDetails"></p><button type="button" id="downloadBackup">Exportar backup</button> <button type="button" id="downloadRecovery">Exportar copia local anterior</button><p class="muted">A escolha vale para as proximas mensagens. Claude Code usa a sessao autenticada neste computador por claude setup-token. A agenda libera somente uma resposta estruturada, sem ferramentas. Alarmes dependem desta pagina aberta e das permissoes do navegador.</p>';
  const availability = document.querySelector(".settings-panel"); availability.open = true;
  group("settings", "Disponibilidade e ajustes", [availability, settings]);
  document.querySelector(".stats-grid").hidden = true;
  document.querySelector(".insight-grid").hidden = true;
  const openOrganizer = key => {
    Object.entries(groups).forEach(([name, node]) => { node.open = name === key; });
    organizer.showModal(); groups[key].scrollIntoView({ block: "nearest" });
  };
  document.querySelector("#openPlans").onclick = () => openOrganizer("goals");
  document.querySelector("#closeOrganizer").onclick = () => organizer.close();

  const actions = document.querySelector(".calendar-actions-menu > div");
  actions.prepend(el.generatePlan); el.generatePlan.textContent = "Replanejar a partir de agora";
  const manual = document.createElement("button"); manual.type = "button"; manual.textContent = "Adicionar manualmente";
  manual.onclick = () => { actions.parentElement.open = false; openEntryEditor(); }; actions.prepend(manual);
  const adjustments = document.createElement("button"); adjustments.type = "button"; adjustments.id = "openSettings"; adjustments.textContent = "Disponibilidade e ajustes";
  adjustments.onclick = () => { actions.parentElement.open = false; openOrganizer("settings"); }; actions.append(adjustments);
  const report = document.createElement("button"); report.type = "button"; report.id = "writeCheckin"; report.textContent = "Relatar meu dia";
  report.onclick = () => { actions.parentElement.open = false; setInputMode("report"); el.quickMessage.focus(); }; actions.prepend(report);

  const filters = document.createElement("details"); filters.id = "calendarOptions"; filters.className = "calendar-options";
  filters.innerHTML = '<summary>Filtros e cores</summary>';
  const classification = document.querySelector(".calendar-classification"); classification.before(filters); filters.append(classification, el.goalLegend);
  const colorControl = document.createElement("label"); colorControl.className = "color-control";
  colorControl.innerHTML = 'Cores por <select id="colorMode"><option value="category">Categoria</option><option value="goal">Meta</option></select>';
  classification.append(colorControl);
  const colorSelect = colorControl.querySelector("select"); colorSelect.value = localStorage.getItem(STORAGE_KEY + "-colors") || "category";
  const updateColors = () => { el.weekGrid.dataset.colors = colorSelect.value; localStorage.setItem(STORAGE_KEY + "-colors", colorSelect.value); };
  colorSelect.onchange = updateColors; updateColors();

  const assistant = document.querySelector(".assistant-panel");
  assistant.querySelector("h2").textContent = "O que vamos organizar?";
  el.quickMessage.rows = 2; el.quickMessage.placeholder = "Uma tarefa, uma meta ou como foi seu dia...";
  const label = el.quickMessage.closest("label");
  Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
  el.quickMessage.setAttribute("aria-label", "Mensagem para a agenda");
  const footer = document.createElement("div"); footer.className = "composer-footer";
  footer.append(assistant.querySelector(".mode-toggle"), assistant.querySelector(".button-row"));
  label.after(footer);
  el.modeButtons.forEach(button => { if (button.dataset.mode === "report") button.textContent = "Relato"; });
  el.voiceMessage.title = "Ditar mensagem";

  function collapseFields(form, ids, summary) {
    const details = document.createElement("details"); details.className = "advanced-fields";
    const heading = document.createElement("summary"); heading.textContent = summary;
    const grid = document.createElement("div"); grid.className = "form-grid";
    ids.forEach(id => grid.append(document.getElementById(id).closest("label")));
    details.append(heading, grid); form.querySelector(".dialog-actions").before(details);
  }
  collapseFields(el.entryForm, ["editInstructions", "editMilestone", "editCompletionCriteria", "editCalendarCategory", "editGoalId", "editPriority", "editStatus"], "Mais detalhes");
  collapseFields(el.goalForm, ["goalStrategyInput", "goalCriteriaInput", "goalPriorityInput", "goalStatusInput"], "Detalhar o plano");
  const dialog = document.createElement("dialog"); dialog.id = "blockDialog"; dialog.className = "editor-dialog block-dialog"; document.body.append(dialog);

  const conflict = document.createElement("section"); conflict.id = "syncConflict"; conflict.hidden = true;
  conflict.innerHTML = '<strong>Alteracoes precisam de revisao</strong><p></p><button type="button" id="exportConflict">Exportar minha copia</button> <button type="button" id="useServer">Usar versao do servidor</button>';
  shell.before(conflict);
  document.querySelector("#useServer").onclick = async () => {
    if (!confirm("Guardar uma copia local de recuperacao e carregar a versao do servidor?")) return;
    localStorage.setItem(STORAGE_KEY + "-recovery", JSON.stringify(state));
    syncDirty = false; syncBase = null; saveLocalSnapshot(); await syncFromServer(); conflict.hidden = true;
  };
  document.querySelector("#exportConflict").onclick = () => downloadJson(dataSnapshot(), "agenda-alteracoes-locais.json");
  document.querySelector("#downloadBackup").onclick = () => downloadJson(dataSnapshot(), "agenda-backup.json");
  document.querySelector("#downloadRecovery").onclick = () => {
    const raw = localStorage.getItem(STORAGE_KEY + "-recovery");
    if (raw) downloadJson(JSON.parse(raw), "agenda-recuperacao.json");
    else alert("Nao ha uma copia local anterior.");
  };
  renderProductExtras();
  syncStatus(syncDirty ? "Alteracoes locais aguardando sincronizacao" : serverSyncReady ? "Agenda sincronizada" : "Conectando...", syncDirty);
  fetch("/api/status").then(response => response.json()).then(status => {
    const select = document.querySelector("#aiProvider");
    const providers = status.providers || {};
    const configured = provider => providers[provider]?.configured !== false;
    const configuredDefault = configured(status.defaultProvider) ? status.defaultProvider : "ollama";
    if (!aiProvider || !configured(aiProvider)) aiProvider = configuredDefault;
    select.value = aiProvider;
    const showProvider = () => {
      const selected = providers[aiProvider] || { available: status.ai, model: status.model };
      const label = aiProvider === "claude" ? "Claude" : "Ollama";
      document.querySelector("#aiStatus").textContent = selected.available ? label + " pronto para a proxima mensagem" : label + " indisponivel";
      document.querySelector("#connectionDetails").textContent = "Modelo: " + (selected.model || status.model) + ". Telegram: " + (status.telegram ? "configurado" : "nao configurado") + ".";
    };
    select.onchange = () => {
      if (!configured(select.value)) {
        alert("Claude Code precisa estar instalado e autenticado com claude setup-token neste computador.");
        select.value = aiProvider;
        return;
      }
      aiProvider = select.value;
      localStorage.setItem(STORAGE_KEY + "-ai-provider", aiProvider);
      showProvider();
    };
    showProvider();
  }).catch(() => { document.querySelector("#aiStatus").textContent = "Servidor indisponivel"; });
});
