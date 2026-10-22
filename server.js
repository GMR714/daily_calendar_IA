const path = require("node:path");
const fs = require("node:fs");
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
process.env.TZ ||= "America/Sao_Paulo";
const { createApp } = require("./server-runtime");
const { interpret, status: aiStatus } = require("./ai-provider");
const { startTelegram } = require("./telegram");
const app = createApp({ interpret, aiStatus });
const port = Number(process.env.PORT || 8787);
app.server.on("error", error => {
  console.error(error.code === "EADDRINUSE" ? "Esta porta ja esta em uso. Abra a agenda existente ou altere PORT no .env." : error.message);
  process.exitCode = 1;
});
app.server.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log("Agenda Inteligente: http://localhost:" + port);
  console.log("IA padrao: " + (process.env.AI_PROVIDER === "claude" ? process.env.CLAUDE_CLI_MODEL || "sonnet" : process.env.AI_PROVIDER === "claude-api" ? process.env.CLAUDE_MODEL || "claude-sonnet-5" : process.env.OLLAMA_MODEL || "gemma4:31b-cloud"));
  if (process.env.OPEN_BROWSER === "true" && process.platform === "win32") {
    require("node:child_process").spawn("cmd.exe", ["/c", "start", "", "http://localhost:" + port], { windowsHide: true, stdio: "ignore" }).unref();
  }
  startTelegram(app).catch(() => console.error("Nao foi possivel iniciar o Telegram."));
});
