/* Categorias públicas vindas de public.categorias. Nenhuma lista fixa no frontend. */
(function () {
  "use strict";
  if (window.UGCCategories) return;
  var items = [];
  async function load() {
    var client = window.supabaseClient;
    if (!client || !client.from) return { ok: false, items: [] };
    try {
      var result = await client.from("categorias").select("slug,nome,ordem").order("ordem", { ascending: true }).order("nome", { ascending: true });
      if (result.error || !Array.isArray(result.data)) return { ok: false, items: [] };
      items = result.data.filter(function (c) { return c && c.slug && c.nome; });
      Object.keys(CATEGORY_LABELS).forEach(function (key) { delete CATEGORY_LABELS[key]; });
      items.forEach(function (c) { CATEGORY_LABELS[c.slug] = c.nome; });
      return { ok: true, items: items.slice() };
    } catch (e) { return { ok: false, items: [] }; }
  }
  window.UGCCategories = { all: function () { return items.slice(); }, reload: function () { window.categoryReady = load(); return window.categoryReady; } };
  window.categoryReady = load();
})();
