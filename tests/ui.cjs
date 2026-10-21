const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server-runtime");
const P = require("../planner-core");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agenda-ui-"));
  const today = P.dateKey(new Date());
  const app = createApp({ file: path.join(directory, "agenda.json"), interpret: async ({ message }) => message.includes("falhar") ? { mode: "error", message: "Ollama indisponivel no teste" } : { mode: "ai", model: "modelo-de-teste", summary: "Estudo dividido em sessoes antes da prova.", entries: [{ text: "Resolver exercicios de logica", type: "task", duration: 360, deadline: P.addDays(today, 14), instructions: ["Resolver 10 exercicios", "Revisar os erros"], completionCriteria: "Resolver 8 de 10 sem ajuda" }] } });
  app.store.write({ goals: [{ id: "career", title: "Primeiro emprego em programacao", status: "active", weeklyMinutes: 900, strategy: "Fundamentos, portfolio e candidaturas.", successCriteria: ["Projeto publicado com testes", "Participar de entrevistas"] }, { id: "health", title: "Condicionamento fisico", status: "active", weeklyMinutes: 300 }], entries: [
    { id: "work", text: "Trabalho meio periodo", type: "routine", preferredDays: [0,1,2,3,4], time: "10:00", duration: 270, timeLocked: true },
    { id: "gym", text: "Academia - treino de forca", type: "routine", preferredDays: [0,1,2,3,4], time: "18:00", duration: 60, timeLocked: true, goalId: "health" },
    { id: "code", text: "Desenvolver API do portfolio", type: "task", duration: 600, goalId: "career", milestone: "Portfolio", planOrder: 1, instructions: ["Definir endpoints e banco de dados", "Implementar autenticacao", "Escrever testes de integracao"], completionCriteria: "API publicada e testada" },
    { id: "study", text: "Estudo de programacao - estruturas de dados", type: "routine", duration: 90, preferredDays: [0,2,4], time: "19:00", timeLocked: true, goalId: "career" }
  ] });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ viewport: { width: 1536, height: 960 }, timezoneId: "America/Sao_Paulo" });
    const page = await context.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    page.on("dialog", dialog => dialog.accept());
    await page.goto(url); await page.waitForSelector(".timeline-block");
    await page.waitForFunction(() => document.querySelector("#syncStatus")?.textContent === "Agenda sincronizada");
    assert.equal(await page.locator(".goals-panel").isVisible(), false);
    assert.equal(await page.locator(".calendar-primary").isVisible(), true);
    assert.equal(await page.locator(".product-header [data-section]").count(), 0);
    assert.equal(await page.locator("#calendarOptions").getAttribute("open"), null);
    assert.equal(await page.locator("#quickMessage").isVisible(), true);
    assert.ok(await page.locator(".calendar-toolbar").evaluate(node => node.getBoundingClientRect().top < 150));
    assert.ok(await page.locator("#quickMessage").evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight));
    await page.locator("#nextWeek").click();
    assert.ok(await page.locator(".timeline-block").count() > 0);
    const colors = await page.locator(".timeline-block").evaluateAll(nodes => [...new Set(nodes.map(node => getComputedStyle(node).backgroundColor))]);
    assert.ok(colors.length >= 2, JSON.stringify(colors));
    fs.mkdirSync(path.join(__dirname, "../.cache"), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, "../.cache/calendar-desktop.png"), fullPage: true });
    await page.locator(".timeline-block.category-work").first().click();
    await page.waitForSelector("#blockDialog[open]");
    await page.locator("#blockDialog [data-edit]").click();
    await page.locator("#editText").fill("Trabalho - titulo editado");
    await page.locator("#saveEntry").click();
    await page.waitForFunction(() => document.querySelector("#syncStatus").textContent === "Agenda sincronizada");
    assert.ok(app.store.read().entries.some(entry => entry.text === "Trabalho - titulo editado" || Object.values(entry.overrides || {}).some(override => override.text === "Trabalho - titulo editado")));
    await page.locator("#todayWeek").click();
    await page.waitForSelector(".timeline-block.category-project");
    await page.locator(".timeline-block.category-project").first().click();
    assert.equal(await page.locator("#sessionMinutes").isVisible(), false);
    await page.locator(".session-adjustments > summary").click();
    await page.locator("#sessionMinutes").fill("30");
    await page.locator("#sessionNote").fill("Precisei revisar fundamentos");
    await page.locator("#blockDialog [data-done]").click();
    await page.waitForFunction(() => document.querySelector("#syncStatus").textContent === "Agenda sincronizada");
    assert.equal(app.store.read().entries.find(entry => entry.id === "code").completedMinutes, 30);
    assert.notEqual(app.store.read().entries.find(entry => entry.id === "code").status, "completed");
    assert.equal(app.store.read().entries.find(entry => entry.id === "code").sessionLogs.length, 1);
    await page.locator(".timeline-block.category-health").first().click();
    await page.locator("#blockDialog [data-edit]").click();
    await page.locator("#deleteEntry").click();
    await page.waitForFunction(() => document.querySelector("#syncStatus").textContent === "Agenda sincronizada");
    assert.ok(Object.values(app.store.read().entries.find(entry => entry.id === "gym").overrides).some(override => override.cancelled));
    await page.locator("#quickMessage").fill("Preparar prova de logica");
    const count = app.store.read().entries.length;
    await page.locator("#addQuickEntry").click(); await page.waitForSelector("#applyProposal");
    assert.equal(app.store.read().entries.length, count);
    await page.locator("#applyProposal").click(); await page.waitForSelector("text=Alteracoes salvas");
    assert.equal(app.store.read().entries.length, count + 1);
    await page.locator("#quickMessage").fill("falhar sem perder minha mensagem");
    await page.locator("#addQuickEntry").click(); await page.waitForSelector("text=Nenhuma alteracao aplicada");
    assert.equal(await page.locator("#quickMessage").inputValue(), "falhar sem perder minha mensagem");
    await page.locator("#weekGrid").evaluate(node => { node.scrollTop = 220; });
    await page.evaluate(() => syncFromServer());
    assert.ok(await page.locator("#weekGrid").evaluate(node => node.scrollTop >= 200));
    await page.locator('[data-calendar-view="month"]').click();
    assert.equal(await page.locator(".month-cell").count(), 42);
    await page.locator('#openPlans').click();
    assert.equal(await page.locator(".goals-panel").isVisible(), true);
    await page.locator('#organizer-tasks > summary').click();
    assert.equal(await page.locator('#entriesList').isVisible(), true);
    await page.locator('#closeOrganizer').click();
    await page.locator('.calendar-actions-menu > summary').click();
    await page.locator('#openSettings').click();
    assert.equal(await page.locator('#prefStart').isVisible(), true);
    await page.locator('#closeOrganizer').click();
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Sao_Paulo", isMobile: true });
    const phone = await mobile.newPage(); phone.on("pageerror", error => errors.push(error.message));
    await phone.goto(url); await phone.waitForSelector(".timeline-week.day-view");
    await phone.locator("#nextWeek").click();
    await phone.screenshot({ path: path.join(__dirname, "../.cache/calendar-mobile.png"), fullPage: true });
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.ok(await phone.locator('#addQuickEntry').evaluate(node => node.getBoundingClientRect().bottom <= window.innerHeight));
    assert.deepEqual(errors, []);
    console.log("UI passed: calendar, colors, recurrence edit/cancel, partial session, proposal confirmation, failure recovery, scroll preservation, month, goals, mobile.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => app.server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
