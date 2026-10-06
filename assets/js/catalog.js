/* USE GISELLY CRISTINE — catálogo público vindo do Supabase (Passo 1).

   O que este arquivo faz:
   • Esvazia o array PRODUCTS de products.js assim que carrega. Os 12 itens de demonstração
     NUNCA ficam disponíveis, nem durante o carregamento nem se o Supabase falhar — assim
     nenhum produto estático consegue entrar na sacola ou nos favoritos.
   • Consulta public.produtos com ativo = true (somente colunas públicas).
   • Converte cada linha para o formato que o site já usa e a coloca DENTRO do mesmo array
     PRODUCTS. Por isso getProductById, getProductsByCategory, productCardHTML, cartSubtotal etc.
     continuam funcionando sem nenhuma alteração.
   • Expõe catalogReady (Promise que NUNCA rejeita) para as páginas esperarem os dados.

   Segurança:
   • Usa só a chave publishable já existente (window.supabaseClient). Quem protege os dados é o RLS.
   • O filtro ativo = true está na consulta de propósito: uma sessão de administrador também
     enxerga produtos inativos pelas policies, e a vitrine não pode mostrá-los.
   • Textos vindos do banco são escapados aqui, porque os templates do site os inserem via innerHTML.

   Ordem dos scripts: depois de supabase.js e products.js.
     <script src="assets/js/supabase.js"></script>
     <script src="assets/js/products.js"></script>
     <script src="assets/js/catalog.js"></script>

   Uso nas páginas (próximos passos):
     const result = await catalogReady;           // nunca lança
     if (!result.ok) { ...mostrar result.error.message... return; }
     ...renderizar usando PRODUCTS / getProductById / getProductsByCategory...

   Campos de cada produto adaptado (formato de products.js):
     id            slug do banco (identificador público; igual ao usado em produto.html?id=,
                   carrinho_itens.produto_id e favoritos.produto_id)
     name          nome  — ESCAPADO para HTML (seguro para innerHTML)
     description   descrição ('' quando vazia, nunca null) — ESCAPADA para HTML
     category      chave da categoria (ex.: "vestidos")
     price         preço vigente = preco_promocional quando há promoção, senão preco
     oldPrice      preco (cheio) quando há promoção, senão null
     images        [] quando não há imagem — URLs escapadas para atributo HTML
     isNew         false (a regra de novidades será definida depois)
     sizes, colors []  (tamanhos e cores ficam para uma etapa futura; nada é inventado)
     rawName, rawDescription, rawImages
                   mesmos valores SEM escape, para uso em textContent, document.title e para
                   gravar no banco (nome_produto/imagem_produto). Nunca use em innerHTML. */
(function () {
  "use strict";

  if (window.UGCCatalog) return; /* já carregado: não duplica */

  var TABLE = "produtos";
  /* Somente colunas públicas. Não pedimos ativo, atualizado_em nem id interno. */
  var COLUMNS = "id,slug,nome,descricao,categoria,preco,preco_promocional,imagens,image_url";
  var TIMEOUT_MS = 12000;
  var FRIENDLY_ERROR = "Não foi possível carregar os produtos agora. Verifique sua conexão e tente novamente.";
  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;      /* mesmo formato do check produtos_slug_ck */
  var LOGO_RE = /logo-(?:use-)?giselly-cristine/i; /* a logo nunca é imagem de produto */

  var state = { status: "loading", error: null, count: 0 };
  var inflight = null;

  /* ---------- proteção contra XSS ---------- */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/`/g, "&#96;");
  }

  /* Aceita só http(s) ou caminho relativo. Rejeita javascript:, data:, caracteres perigosos e a logo. */
  function cleanImage(value) {
    if (typeof value !== "string") return null;
    var url = value.trim();
    if (!url || url.length > 2048) return null;
    if (/[\u0000-\u001f\u007f\s<>"'`]/.test(url)) return null; /* controle, espaço, aspas e < > nunca são URL válida */
    if (LOGO_RE.test(url)) return null;
    if (/^\/\//.test(url)) return null;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(url) && !/^https?:\/\//i.test(url)) return null;
    return url;
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  /* ---------- adaptador: linha do banco → formato de products.js ---------- */
  function adaptRow(row, cores) {
    if (!row || typeof row !== "object") return null;

    var slug = typeof row.slug === "string" ? row.slug.trim() : "";
    var nome = typeof row.nome === "string" ? row.nome.trim() : "";
    var categoria = typeof row.categoria === "string" ? row.categoria.trim() : "";
    var preco = toNumber(row.preco);
    if (!SLUG_RE.test(slug) || !nome || !categoria || preco === null || preco < 0) return null;

    /* price = preco_promocional ?? preco ; oldPrice = preco_promocional ? preco : null.
       Promoção só vale se for > 0 e menor que o preço cheio (o banco já exige < preco);
       assim um valor 0 nunca vira um produto de R$ 0,00. */
    var promo = toNumber(row.preco_promocional);
    var hasPromo = promo !== null && promo > 0 && promo < preco;

    var candidates = [];
    if (row.image_url) candidates.push(row.image_url);
    if (Array.isArray(row.imagens)) candidates = candidates.concat(row.imagens);
    var rawImages = [];
    candidates.forEach(function (c) {
      var url = cleanImage(c);
      if (url && rawImages.indexOf(url) === -1) rawImages.push(url);
    });

    var rawDescription = row.descricao == null ? "" : String(row.descricao);

    var variantColors = (cores || []).map(function (cor) {
      var colorImages = [];
      (Array.isArray(cor.imagens) ? cor.imagens : []).forEach(function (image) {
        var clean = cleanImage(image);
        if (clean && colorImages.indexOf(clean) === -1) colorImages.push(clean);
      });
      var stocks = {};
      (Array.isArray(cor.produto_variacoes) ? cor.produto_variacoes : []).forEach(function (v) {
        if (v && /^(P|M|G)$/.test(v.tamanho)) stocks[v.tamanho] = Math.max(0, Number(v.estoque) || 0);
      });
      return { id: cor.id, name: String(cor.nome || ""), images: colorImages, stock: stocks };
    }).filter(function (cor) { return cor.name; });
    var availableSizes = {};
    variantColors.forEach(function (cor) { Object.keys(cor.stock).forEach(function (size) { if (cor.stock[size] > 0) availableSizes[size] = true; }); });
    return {
      id: slug,
      name: escapeHtml(nome),
      description: escapeHtml(rawDescription),
      category: escapeHtml(categoria),
      price: hasPromo ? promo : preco,
      oldPrice: hasPromo ? preco : null,
      images: rawImages.map(escapeHtml),
      isNew: false,
      sizes: Object.keys(availableSizes),
      colors: variantColors,
      variations: variantColors,
      rawName: nome,
      rawDescription: rawDescription,
      rawImages: rawImages,
      hasVariants: variantColors.length > 0,
      variantStock: variantColors.reduce(function (total, cor) { return total + Object.keys(cor.stock).reduce(function (sum, size) { return sum + cor.stock[size]; }, 0); }, 0)
    };
  }

  /* ---------- acesso ao banco ---------- */
  function classify(error) {
    var code = (error && error.code) || "";
    var status = error && error.status;
    var msg = String((error && (error.message || error.name)) || "").toLowerCase();
    if (/abort|timeout|timed out/.test(msg)) return "timeout";
    if (/failed to fetch|network|load failed/.test(msg)) return "network";
    if (code === "42P01" || code === "PGRST205" || status === 404) return "missing";
    if (code === "42501" || code === "PGRST301" || status === 401 || status === 403) return "denied";
    return "other";
  }

  function fail(kind, cause) {
    var err = new Error(kind);
    err.kind = kind;
    err.cause = cause;
    return err;
  }

  async function fetchRows() {
    var client = window.supabaseClient;
    if (!client || typeof client.from !== "function") throw fail("client", null);

    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(fail("timeout", null));
      }, TIMEOUT_MS);
    });

    try {
      var query = client.from(TABLE).select(COLUMNS)
        .eq("ativo", true)
        .order("criado_em", { ascending: false })
        .order("nome", { ascending: true });
      if (controller && typeof query.abortSignal === "function") query = query.abortSignal(controller.signal);

      var res = await Promise.race([query, timeout]);
      if (res && res.error) throw fail(classify(res.error), res.error);
      if (!res || !Array.isArray(res.data)) throw fail("other", null);
      var rows = res.data;
      var ids = rows.map(function (row) { return row.id; }).filter(Boolean);
      if (!ids.length) return rows;
      var colorsRes = await client.from("produto_cores").select("id,produto_id,nome,imagens,produto_variacoes(tamanho,estoque)").in("produto_id", ids);
      if (colorsRes.error) throw fail(classify(colorsRes.error), colorsRes.error);
      var byProduct = {};
      (colorsRes.data || []).forEach(function (color) { (byProduct[color.produto_id] || (byProduct[color.produto_id] = [])).push(color); });
      return rows.map(function (row) { row.__ugcCores = byProduct[row.id] || []; return row; });
    } catch (e) {
      if (e && e.kind) throw e;
      throw fail(classify(e), e);
    } finally {
      clearTimeout(timer);
    }
  }

  function currentCount() {
    return typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS) ? PRODUCTS.length : 0;
  }

  function emit(name, detail) {
    try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* sem DOM: ignora */ }
  }

  async function run() {
    state = { status: "loading", error: null, count: 0 };
    try {
      if (typeof PRODUCTS === "undefined" || !Array.isArray(PRODUCTS)) throw fail("setup", null);

      /* Os rótulos e filtros de categoria são carregados da mesma fonte pública. */
      if (window.categoryReady) await window.categoryReady;

      var rows = await fetchRows();
      var items = [];
      var skipped = 0;
      rows.forEach(function (row) {
        var item = adaptRow(row, row.__ugcCores);
        if (item && (!item.hasVariants || item.variantStock > 0)) items.push(item); else skipped++;
      });
      if (skipped) console.warn("[Use Giselly Cristine][Catálogo] linhas ignoradas por dados inválidos:", skipped);

      /* Troca o conteúdo NO MESMO array: todo código que já referencia PRODUCTS enxerga os dados. */
      PRODUCTS.length = 0;
      items.forEach(function (item) { PRODUCTS.push(item); });

      state = { status: "ready", error: null, count: items.length };
      var ok = { ok: true, count: items.length, skipped: skipped, error: null };
      emit("ugc:catalog-ready", ok);
      return ok;
    } catch (e) {
      var kind = (e && e.kind) || "other";
      var cause = e && e.cause ? e.cause : e;
      console.error("[Use Giselly Cristine][Catálogo]", {
        tabela: TABLE, kind: kind, message: cause && cause.message, code: cause && cause.code,
        details: cause && cause.details, hint: cause && cause.hint
      });
      /* Sem fallback: PRODUCTS continua vazio (ou com o último dado válido do banco). */
      var error = { kind: kind, message: FRIENDLY_ERROR };
      state = { status: "error", error: error, count: currentCount() };
      var bad = { ok: false, count: 0, skipped: 0, error: error };
      emit("ugc:catalog-error", bad);
      return bad;
    }
  }

  /* Uma única busca por vez: chamadas simultâneas compartilham a mesma Promise. */
  function load() {
    if (inflight) return inflight;
    inflight = run().then(function (r) { inflight = null; return r; });
    return inflight;
  }

  /* Tentar novamente (botão "Tentar novamente" nos próximos passos). Atualiza window.catalogReady. */
  function reload() {
    var p = load();
    window.catalogReady = p;
    return p;
  }

  /* Remove os produtos de demonstração IMEDIATAMENTE, antes de qualquer resposta de rede. */
  if (typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS)) PRODUCTS.length = 0;

  window.UGCCatalog = {
    reload: reload,
    status: function () { return { status: state.status, error: state.error, count: state.count }; },
    message: FRIENDLY_ERROR,
    adapt: adaptRow,
    escapeHtml: escapeHtml
  };

  window.catalogReady = load();
})();
