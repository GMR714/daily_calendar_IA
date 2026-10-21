const { classify, normalizeCwd } = require("./projects");
const { redact } = require("./redact");

const NOISE_TAGS = ["system-reminder", "local-command-stdout", "local-command-stderr", "local-command-caveat", "command-message", "command-args"];
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
const MAX_EVENT_CHARS = 4000;
const USER_CHARS = 1500;
const ASSISTANT_CHARS = 1200;
const MAX_EDITS = 30;

function localDay(timestamp, offsetHours = -3) {
  return new Date(Date.parse(timestamp) + offsetHours * 3600e3).toISOString().slice(0, 10);
}

function stripNoise(text) {
  let out = String(text || "");
  for (const tag of NOISE_TAGS) out = out.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, "g"), "");
  out = out.replace(/<command-name>([\s\S]*?)<\/command-name>/g, "$1");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function blockText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => (part && typeof part.text === "string" ? part.text : "")).join("\n");
}

function commitMessage(command) {
  if (!/\bgit\b[^\n]*\bcommit\b/.test(command)) return null;
  const inline = command.match(/\s-m\s+(?:"([^"]+)"|'([^']+)')/);
  if (inline) return (inline[1] || inline[2]).split("\n")[0].trim();
  const heredoc = command.match(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/);
  if (heredoc) return heredoc[2].split("\n").map(line => line.trim()).find(Boolean) || null;
  return null;
}

function prTitle(command) {
  if (!/\bgh\s+pr\s+create\b/.test(command)) return null;
  const title = command.match(/--title\s+(?:"([^"]+)"|'([^']+)')/);
  return title ? `PR aberto: ${title[1] || title[2]}` : "PR aberto";
}

function planText(items) {
  const mark = { completed: "[x]", in_progress: "[>]" };
  return items.map(item => `${mark[item.status] || "[ ]"} ${item.content}`).join(" · ");
}

function toolEvents(name, input = {}) {
  if (EDIT_TOOLS.has(name)) {
    const file = input.file_path || input.notebook_path;
    return file ? [{ kind: "edit", text: file }] : [];
  }
  if (SHELL_TOOLS.has(name) && typeof input.command === "string") {
    const events = [];
    const commit = commitMessage(input.command);
    if (commit) events.push({ kind: "commit", text: commit });
    const pr = prTitle(input.command);
    if (pr) events.push({ kind: "pr", text: pr });
    return events;
  }
  if (name === "mcp__ccd_turn__update_plan" && Array.isArray(input.items)) {
    return [{ kind: "plan", text: planText(input.items) }];
  }
  if (name === "mcp__ccd_turn__wrap_up" && input.recap) {
    return [{ kind: "recap", text: input.recap }];
  }
  return [];
}

function eventsFromRecord(record) {
  if (!record || record.isMeta || record.isSidechain) return [];
  const content = record.message && record.message.content;
  const events = [];

  if (record.type === "user") {
    if (typeof content === "string") {
      events.push({ kind: "user", text: stripNoise(content) });
    } else if (Array.isArray(content)) {
      const text = stripNoise(content.filter(part => part && part.type === "text").map(part => part.text).join("\n"));
      if (text) events.push({ kind: "user", text });
      for (const part of content) {
        if (!part || part.type !== "tool_result") continue;
        const urls = new Set(blockText(part.content).match(PR_URL) || []);
        for (const url of urls) events.push({ kind: "pr", text: url });
      }
    }
  } else if (record.type === "assistant" && Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue;
      if (part.type === "text" && part.text && part.text.trim()) events.push({ kind: "assistant", text: part.text.trim() });
      if (part.type === "tool_use") events.push(...toolEvents(part.name, part.input));
    }
  }

  return events
    .filter(event => event.text)
    .map(event => ({ ...event, ts: record.timestamp, text: clip(event.text, MAX_EVENT_CHARS) }));
}

// Recebe os registros um a um (arquivos de centenas de MB não cabem em memória)
// e guarda só os eventos já recortados.
function createDigestBuilder({ config, offsetHours = -3, since, until }) {
  const titles = new Map();
  const digests = new Map();

  function add(record) {
    if (!record || !record.sessionId) return;
    if (record.type === "custom-title" && record.customTitle) titles.set(record.sessionId, record.customTitle);
    if (record.type === "agent-name" && record.agentName && !titles.has(record.sessionId)) titles.set(record.sessionId, record.agentName);
    if (!record.timestamp || (record.type !== "user" && record.type !== "assistant")) return;

    const day = localDay(record.timestamp, offsetHours);
    if ((since && day < since) || (until && day > until)) return;
    const events = eventsFromRecord(record);
    if (!events.length) return;

    const place = classify(record.cwd, config);
    if (place.ignored) return;
    const key = [record.sessionId, day, place.area, place.project].join("|");
    if (!digests.has(key)) {
      digests.set(key, { sessionId: record.sessionId, day, ...place, entrypoint: record.entrypoint || null, cwds: new Set(), branches: new Set(), events: [] });
    }
    const digest = digests.get(key);
    if (record.cwd) digest.cwds.add(normalizeCwd(record.cwd));
    if (record.gitBranch && record.gitBranch !== "HEAD") digest.branches.add(record.gitBranch);
    digest.events.push(...events);
  }

  function finish() {
    return Array.from(digests.values())
      .map(digest => ({
        ...digest,
        title: titles.get(digest.sessionId) || null,
        cwds: Array.from(digest.cwds),
        branches: Array.from(digest.branches),
        events: digest.events.slice().sort((a, b) => a.ts.localeCompare(b.ts))
      }))
      .sort((a, b) => a.day.localeCompare(b.day) || String(a.area).localeCompare(String(b.area)) || String(a.project).localeCompare(String(b.project)));
  }

  return { add, finish };
}

function buildDigests(records, options) {
  const builder = createDigestBuilder(options);
  records.forEach(builder.add);
  return builder.finish();
}

function renderTrail(events) {
  const lines = [];
  const of = kind => events.filter(event => event.kind === kind);
  const unique = list => Array.from(new Set(list.map(event => event.text)));

  const commits = unique(of("commit"));
  if (commits.length) lines.push("Commits:", ...commits.map(text => `- ${text}`));
  const prs = unique(of("pr"));
  if (prs.length) lines.push("PRs:", ...prs.map(text => `- ${text}`));
  const plans = of("plan");
  if (plans.length) lines.push(`Último plano: ${plans[plans.length - 1].text}`);
  const recaps = unique(of("recap"));
  if (recaps.length) lines.push("Recaps:", ...recaps.map(text => `- ${text}`));
  const edits = unique(of("edit"));
  if (edits.length) {
    lines.push("Arquivos editados:", ...edits.slice(0, MAX_EDITS).map(text => `- ${text}`));
    if (edits.length > MAX_EDITS) lines.push(`- (+${edits.length - MAX_EDITS} outros)`);
  }
  return lines.map(redact).join("\n");
}

function renderDigest(digest, { maxChars = 40000 } = {}) {
  const place = digest.loose ? "avulsa" : `${digest.area} / ${digest.project}`;
  const header = [
    `# ${redact(digest.title || "(sem título)")} — ${digest.day}`,
    `Sessão: ${digest.sessionId} · ${place}`,
    digest.cwds.length ? `Pastas: ${digest.cwds.join(", ")}` : "",
    digest.branches.length ? `Branches: ${digest.branches.join(", ")}` : ""
  ].filter(Boolean).join("\n");

  let trail = renderTrail(digest.events);
  if (trail.length > maxChars / 2) trail = clip(trail, Math.floor(maxChars / 2));
  const top = trail ? `${header}\n\n## Rastro\n${trail}\n\n## Conversa\n` : `${header}\n\n## Conversa\n`;

  const talk = digest.events
    .filter(event => event.kind === "user" || event.kind === "assistant")
    .map(event => (event.kind === "user"
      ? `**Você:** ${redact(clip(event.text, USER_CHARS))}`
      : `**Claude:** ${redact(clip(event.text, ASSISTANT_CHARS))}`));

  const omittedNote = count => `_[${count} mensagens anteriores omitidas]_\n`;
  let budget = maxChars - top.length - omittedNote(talk.length).length;
  const kept = [];
  for (let i = talk.length - 1; i >= 0; i -= 1) {
    const cost = talk[i].length + 1;
    if (cost > budget) break;
    kept.unshift(talk[i]);
    budget -= cost;
  }
  const omitted = talk.length - kept.length;
  return `${top}${omitted ? omittedNote(omitted) : ""}${kept.join("\n")}`.trimEnd();
}

module.exports = { localDay, stripNoise, eventsFromRecord, createDigestBuilder, buildDigests, renderDigest };
