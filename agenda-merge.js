// Mescla usada pelo servidor (require) e pelo navegador (window.AgendaMerge).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AgendaMerge = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Vence quem tem updatedAt mais novo: uma cópia velha do navegador não desfaz uma
  // tarefa fechada pela rodada. Sem data dos dois lados, vale a que chegou.
  function pick(current, incoming) {
    return (incoming.updatedAt || "") >= (current.updatedAt || "")
      ? { ...current, ...incoming }
      : { ...incoming, ...current };
  }

  function mergeById(current = [], incoming = []) {
    const map = new Map();
    (Array.isArray(current) ? current : []).forEach(item => {
      if (item?.id) map.set(item.id, item);
    });
    (Array.isArray(incoming) ? incoming : []).forEach(item => {
      if (!item?.id) return;
      const existing = map.get(item.id);
      map.set(item.id, existing ? pick(existing, item) : item);
    });
    return Array.from(map.values());
  }

  return { mergeById };
});
