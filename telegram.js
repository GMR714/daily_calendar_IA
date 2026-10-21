const fs = require("node:fs");
const Planner = require("./planner-core");

async function startTelegram(app) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || process.env.TELEGRAM_POLLING === "false") return;
  const allowed = process.env.TELEGRAM_ALLOWED_CHAT_ID || "";
  const runtimeFile = `${app.file}.telegram.json`;
  let offset = 0;
  try { offset = JSON.parse(fs.readFileSync(runtimeFile, "utf8")).offset || 0; } catch {}
  let pending = null;
  const request = async (method, body) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`Telegram indisponivel (${response.status}).`);
    return data;
  };
  const send = async (chatId, text) => {
    for (let i = 0; i < text.length; i += 3800) await request("sendMessage", { chat_id: chatId, text: text.slice(i, i + 3800) });
  };
  async function handle(message) {
    const id = message?.chat?.id;
    if (!id) return;
    const text = (message.text || "").trim();
    if (String(id) !== allowed) {
      if (text.startsWith("/start")) await send(id, `Acesso ainda nao autorizado. Seu chat ID e ${id}. Configure TELEGRAM_ALLOWED_CHAT_ID no computador da agenda.`);
      return;
    }
    if (text === "/start" || text === "/ajuda") return send(id, "Envie metas, tarefas ou um relato do dia. Revise a proposta e use /confirmar ou /cancelar. Consulte /hoje ou /semana. Audio: use o ditado do teclado para enviar texto.");
    if (text === "/cancelar") { pending = null; return send(id, "Proposta descartada. Agenda preservada."); }
    if (text === "/confirmar") {
      if (!pending) return send(id, "Nenhuma proposta pendente. Envie uma mensagem primeiro.");
      const saved = app.apply(pending); pending = null;
      return send(id, "Alteracoes confirmadas:\n" + saved.changes.map(change => `${actionLabel(change.action)}: ${change.title}`).join("\n"));
    }
    if (text === "/hoje" || text === "/semana") {
      const from = Planner.dateKey(new Date()); const to = Planner.addDays(from, text === "/hoje" ? 1 : 7);
      const plan = Planner.schedule(app.store.read(), { from, to });
      const time = value => new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return send(id, plan.blocks.length ? plan.blocks.map(block => `${Planner.dateKey(block.start)} ${time(block.start)}-${time(block.end)}\n${block.title}`).join("\n\n") : "Nenhum bloco planejado nesse periodo.");
    }
    if (!text) return send(id, "Audio anexado ainda nao e transcrito. Use o ditado do teclado ou envie texto.");
    await send(id, "Analisando sua mensagem. A agenda so muda depois de /confirmar.");
    const result = await app.propose({ message: text, mode: "auto", intent: "message" });
    pending = result.proposalId;
    const entries = (result.entries || []).map(entry => `${entry.text}: ${entry.duration} min${entry.time ? ` as ${entry.time}` : ""}${entry.date ? ` em ${entry.date}` : ""}${entry.deadline ? ` ate ${entry.deadline}` : ""}`);
    const updates = (result.updates || []).map(update => `${actionLabel(update.action)} ${app.store.read().entries.find(entry => entry.id === update.entryId)?.text || "tarefa"}: ${update.newTime || update.newDate || update.duration || update.reason || ""}`);
    await send(id, [result.summary, ...entries, ...updates, ...result.warnings.map(w => `${w.text}: ${w.reason}`), "", "/confirmar para aplicar; /cancelar para descartar."].filter(Boolean).join("\n"));
  }
  while (true) {
    try {
      const data = await request("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
      for (const update of data.result || []) {
        try { await handle(update.message); }
        catch (error) { if (String(update.message?.chat?.id) === allowed) await send(update.message.chat.id, `Nao foi possivel concluir: ${error.message}`); }
        offset = update.update_id + 1;
        fs.writeFileSync(`${runtimeFile}.tmp`, JSON.stringify({ offset }), { mode: 0o600 });
        fs.renameSync(`${runtimeFile}.tmp`, runtimeFile);
      }
    } catch { console.error("Telegram sem conexao. Nova tentativa em 10 segundos."); await new Promise(resolve => setTimeout(resolve, 10000)); }
  }
}
function actionLabel(action) { return ({ create: "Criar", edit: "Editar", delete: "Excluir", complete: "Concluir", pause: "Pausar", resume: "Retomar", reschedule: "Reagendar", adjust_duration: "Ajustar duracao" })[action] || action; }
module.exports = { startTelegram };
