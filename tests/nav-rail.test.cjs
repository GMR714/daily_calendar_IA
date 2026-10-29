const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../nav-rail");

test("menu igual em todas as telas, com o item da tela atual marcado", () => {
  const itens = R.itensDoMenu("cockpit");
  assert.deepEqual(itens.map(i => i.chave), ["agenda", "checklist", "cockpit", "cantinho", "planos", "ajustes"]);
  assert.deepEqual(itens.filter(i => i.ativo).map(i => i.chave), ["cockpit"]);
  const por = chave => itens.find(i => i.chave === chave);
  assert.equal(por("agenda").href, "/#agenda");
  assert.equal(por("checklist").href, "/#checklist");
  assert.equal(por("cockpit").href, "/cockpit");
  assert.equal(por("planos").href, "/#planos");
  assert.equal(por("ajustes").href, "/#ajustes");
  assert.equal(por("cantinho").href, undefined, "cantinho e um botao, nao um link");
  assert.equal(por("cantinho").acao, "cantinho");
  assert.ok(itens.every(i => i.rotulo && i.icone), "todo item tem rotulo e icone");
});

test("tela da agenda pelo endereco, com a agenda como padrao", () => {
  assert.equal(R.telaDoHash("#checklist"), "checklist");
  assert.equal(R.telaDoHash("#agenda"), "agenda");
  assert.equal(R.telaDoHash("#planos"), "planos");
  assert.equal(R.telaDoHash("#ajustes"), "ajustes");
  assert.equal(R.telaDoHash(""), "agenda");
  assert.equal(R.telaDoHash("#qualquer-coisa"), "agenda");
});
