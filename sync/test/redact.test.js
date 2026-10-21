const test = require("node:test");
const assert = require("node:assert/strict");
const { redact } = require("../redact");

// Segredos montados por concatenação para não parecerem tokens reais no repositório.
const SECRETS = [
  "sk-" + "ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
  "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
  "github" + "_pat_" + "11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
  "xo" + "xb-" + "1234567890-0987654321-AbCdEfGhIjKlMnOp",
  "AK" + "IA" + "IOSFODNN7EXAMPLE",
  "AI" + "za" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"
];

test("remove chaves de API conhecidas", () => {
  for (const secret of SECRETS) {
    const out = redact(`token: ${secret} fim`);
    assert.ok(!out.includes(secret), `vazou: ${secret}`);
    assert.match(out, /\[REDACTED\]/);
    assert.match(out, /fim$/);
  }
});

test("mascara o valor de variáveis sensíveis e mantém o nome", () => {
  const out = redact('OPENAI_API_KEY=abc123def456\nTELEGRAM_BOT_TOKEN: "999:xyzXYZ"\nDB_PASSWORD=hunter22');
  assert.ok(!out.includes("abc123def456"));
  assert.ok(!out.includes("999:xyzXYZ"));
  assert.ok(!out.includes("hunter22"));
  assert.match(out, /OPENAI_API_KEY=\[REDACTED\]/);
  assert.match(out, /TELEGRAM_BOT_TOKEN/);
});

test("remove Bearer, JWT, chave privada e senha em URL de banco", () => {
  const jwt = "eyJ" + "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
  const out = redact([
    "Authorization: Bearer abcdefghijklmnop1234567890",
    `token ${jwt}`,
    key,
    "postgres://gabriel:s3cretPass@db.local:5432/agenda"
  ].join("\n"));
  assert.ok(!out.includes("abcdefghijklmnop1234567890"));
  assert.ok(!out.includes(jwt));
  assert.ok(!out.includes("b3BlbnNzaC1rZXktdjEAAAAA"));
  assert.ok(!out.includes("s3cretPass"));
  assert.match(out, /postgres:\/\/gabriel:\[REDACTED\]@db\.local/);
});

test("remove sequência longa e aleatória", () => {
  const blob = "Zq8" + "Xm2LpR7vTn4WbK9sYc3HdF6gJa1QeU5oMi0NtBvCx";
  assert.ok(!redact(`valor ${blob}`).includes(blob));
});

test("preserva o que é útil pro resumo", () => {
  const keep = [
    "commit e76e867a1b2c3d4e5f60718293a4b5c6d7e8f901",
    "sessão 0a21d8ca-ed6d-4aea-b6a4-f26aa81b36fe",
    "C:\\Dev\\Video editor\\.claude\\worktrees\\jolly-goldstine-db662d\\tests\\test_estilo.py",
    "https://github.com/GMR714/Video_editor/pull/18",
    "C:\\Users\\gabri\\AppData\\Local\\Temp\\claude\\C--Users-gabri-Documents-New-project--claude-worktrees-obsidian-planning-integration-a01363\\scratchpad",
    "Corrigi o crash da transição tear na renderização da montagem."
  ];
  for (const text of keep) assert.equal(redact(text), text);
});
