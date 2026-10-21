const MASK = "[REDACTED]";

// Ordem importa: blocos e padrões específicos antes do genérico de alta entropia.
const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, MASK],
  [/\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${MASK}@`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, `Bearer ${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\bAIza[0-9A-Za-z_-]{35}/g, MASK],
  [/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY)[A-Z0-9_]*)(\s*[=:]\s*)(["']?)(?!\[REDACTED\])[^\s"'\[]{4,}\3/g, `$1$2$3${MASK}$3`]
];

function redact(text) {
  if (!text) return text;
  let out = String(text);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out.replace(/\b[A-Za-z0-9+_-]{40,}\b/g, token => (looksRandom(token) ? MASK : token));
}

// Hash de commit (só hex minúsculo), slugs de pasta ("C--Users-gabri-...-a01363") e
// identificadores com palavras longas ficam; mistura de maiúscula, minúscula e vários
// dígitos sem trecho legível é tratada como credencial.
function looksRandom(token) {
  const words = token.split(/[-_+]+/).filter(part => /^[A-Za-z]{4,}$/.test(part));
  if (words.length >= 3) return false;
  const digits = (token.match(/[0-9]/g) || []).length;
  const longestLetters = Math.max(...(token.match(/[A-Za-z]+/g) || [""]).map(run => run.length));
  return /[A-Z]/.test(token) && /[a-z]/.test(token) && digits >= 3 && longestLetters < 12;
}

module.exports = { redact };
