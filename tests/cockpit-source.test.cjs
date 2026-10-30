const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCockpitSource, commandFor, childEnv, DEFAULT_CLI } = require("../cockpit-source");

test("no Windows o Python nao recebe o TZ do servidor (o CRT le America/Sao_Paulo errado e adianta a hora)", () => {
  const win = childEnv({ TZ: "America/Sao_Paulo", PATH: "x" }, "win32");
  assert.equal(win.TZ, undefined);
  assert.equal(win.PATH, "x");
  assert.equal(win.PYTHONIOENCODING, "utf-8");
  assert.equal(childEnv({ TZ: "America/Sao_Paulo" }, "linux").TZ, "America/Sao_Paulo");
});

test("cockpit roda o copiloto uma vez, guarda e serve do cache", async () => {
  let calls = 0;
  let clock = 0;
  const source = createCockpitSource({ run: async () => ({ n: ++calls }), ttlMs: 1000, now: () => clock });
  const [a, b] = await Promise.all([source.get(), source.get()]);
  assert.equal(calls, 1);
  assert.equal(a.dados.n, 1);
  assert.equal(b.dados.n, 1);
  clock = 500;
  assert.equal((await source.get()).dados.n, 1);
  assert.equal(calls, 1);
  clock = 1500;
  const velho = await source.get();
  assert.equal(velho.dados.n, 1);
  assert.equal(velho.atualizando, true);
  assert.equal(velho.idadeSegundos, 2);
  // refresh e pedido depois de uma mudanca: a leitura que ja rodava (2) pode ser de antes dela, entao le de novo (3)
  await source.refresh();
  assert.equal((await source.get()).dados.n, 3);
  assert.equal((await source.get({ force: true })).dados.n, 4);
});

test("releitura pedida depois de uma mudanca, com outra leitura rodando, roda de novo quando ela termina", async () => {
  let calls = 0;
  let soltar;
  const source = createCockpitSource({ run: () => { const n = ++calls; return n === 1 ? new Promise(r => { soltar = () => r({ n }); }) : Promise.resolve({ n }); } });
  const primeira = source.get();  // leitura que comecou antes da mudanca (ex.: excluir uma tarefa)
  const [a, b] = [source.refresh(), source.refresh()];  // duas mudancas no meio dela viram uma leitura so
  const forcada = source.get({ force: true });  // a tela pede a leitura nova: espera a que vem depois da mudanca
  await new Promise(r => setImmediate(r));  // o run da primeira leitura comeca no proximo ciclo
  soltar();
  assert.equal((await primeira).dados.n, 1);
  await Promise.all([a, b]);
  assert.equal((await forcada).dados.n, 2);
  assert.equal(calls, 2);
  await source.refresh();  // sem leitura rodando, le uma vez so
  assert.equal(calls, 3);
});

test("cockpit sem copiloto vira 503 com mensagem clara; com cache, mostra o ultimo dado e o erro", async () => {
  let falhar = true;
  let clock = 0;
  const source = createCockpitSource({
    run: async () => {
      if (falhar) throw Object.assign(new Error("Command failed"), { stderr: "cli.py: error: argument grupo: invalid choice: 'cockpit'" });
      return { ok: 1 };
    },
    ttlMs: 10,
    now: () => clock
  });
  await assert.rejects(source.get(), error => error.status === 503 && /PR #5/.test(error.message));
  falhar = false;
  assert.equal((await source.get()).dados.ok, 1);
  falhar = true;
  clock = 100;
  const view = await source.get({ force: true });
  assert.equal(view.dados.ok, 1);
  assert.match(view.erro, /PR #5/);
});

test("comando usa py -3 no Windows e respeita COCKPIT_CLI e COCKPIT_PYTHON", () => {
  assert.deepEqual(commandFor({}, "win32"), { file: "py", args: ["-3", DEFAULT_CLI, "cockpit", "--json"] });
  assert.deepEqual(commandFor({ COCKPIT_CLI: "/x/cli.py", COCKPIT_PYTHON: "python3" }, "linux"),
    { file: "python3", args: ["/x/cli.py", "cockpit", "--json"] });
});
