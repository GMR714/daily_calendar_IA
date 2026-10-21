const Ollama = require("./ollama");
const Claude = require("./claude");
const ClaudeCli = require("./claude-cli");

const PROVIDERS = new Set(["ollama", "claude", "claude-api"]);

function normalizeProvider(value) {
  return PROVIDERS.has(value) ? value : (PROVIDERS.has(process.env.AI_PROVIDER) ? process.env.AI_PROVIDER : "ollama");
}

function providerConfig() {
  return {
    defaultProvider: normalizeProvider(process.env.AI_PROVIDER),
    providers: {
      ollama: { configured: true, model: process.env.OLLAMA_MODEL || "gemma4:31b-cloud" },
      claude: { configured: ClaudeCli.isClaudeCliInstalled(), model: process.env.CLAUDE_CLI_MODEL || ClaudeCli.CLI_MODEL },
      "claude-api": { configured: Boolean(process.env.ANTHROPIC_API_KEY), model: process.env.CLAUDE_MODEL || Claude.CLAUDE_MODEL }
    }
  };
}

async function interpret(payload) {
  const provider = normalizeProvider(payload.provider);
  if (provider === "claude-api" && !process.env.ANTHROPIC_API_KEY) return { mode: "local", provider, message: "Claude API nao esta configurado. Defina ANTHROPIC_API_KEY no arquivo .env e reinicie o servidor." };
  const result = await (provider === "claude" ? ClaudeCli.interpret(payload) : provider === "claude-api" ? Claude.interpret(payload) : Ollama.interpret(payload));
  return { ...result, provider };
}

async function status() {
  const config = providerConfig();
  let ollamaAvailable = false;
  try {
    const headers = process.env.OLLAMA_API_KEY ? { Authorization: "Bearer " + process.env.OLLAMA_API_KEY } : {};
    const host = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
    const response = await fetch(host + "/api/tags", { headers, signal: AbortSignal.timeout(3000) });
    ollamaAvailable = response.ok;
  } catch {}
  config.providers.ollama.available = ollamaAvailable;
  config.providers.claude.available = config.providers.claude.configured;
  config.providers["claude-api"].available = config.providers["claude-api"].configured;
  config.ai = config.providers[config.defaultProvider].available;
  config.model = config.providers[config.defaultProvider].model;
  return config;
}

module.exports = { interpret, normalizeProvider, providerConfig, status };
