/* Painel administrativo — Dashboard (Etapa 1).
   Só LÊ do banco (contagens e os últimos pedidos). Não grava nada e não altera nenhuma tabela.

   De onde vem cada número hoje:
   • Produtos → array PRODUCTS de assets/js/products.js (o catálogo ainda é um arquivo, não uma tabela).
   • Pedidos  → tabela "pedidos"  (já usada por conta.html).
   • Clientes → tabela "perfis"    (já usada por conta.html).
   • Cupons   → ainda não existe tabela no projeto; o card fica "preparado".
   Os nomes de tabela ficam em SOURCES: quando o banco de cupons/produtos existir, é só ligar aqui. */
(function () {
  "use strict";

  var SOURCES = {
    pedidos: { table: "pedidos" },
    clientes: { table: "perfis" },
    cupons: { table: null }
  };
  var RECENT_LIMIT = 5;

  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var integer = new Intl.NumberFormat("pt-BR");

  function db() { return window.supabaseClient; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  /* ---------- cards ---------- */
  function setKpi(name, state, value, note) {
    var card = $('[data-metric="' + name + '"]');
    if (!card) return;
    card.dataset.state = state; /* loading | ok | empty | soon | error */
    card.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    $("[data-value]", card).textContent = value;
    $("[data-note]", card).textContent = note;
  }

  function describeError(error) {
    var code = (error && error.code) || "";
    var status = error && error.status;
    if (code === "42P01" || code === "PGRST205" || status === 404) return "Tabela não encontrada no banco";
    if (code === "42501" || code === "PGRST301" || status === 401 || status === 403) return "Sem permissão de leitura";
    return "Indisponível no momento";
  }

  async function loadCount(name, okNote) {
    var source = SOURCES[name];
    if (!source || !source.table) return;
    setKpi(name, "loading", "", "Carregando…");
    var res;
    try {
      res = await db().from(source.table).select("*", { count: "exact", head: true });
    } catch (e) { res = { error: e }; }
    if (res.error || typeof res.count !== "number") {
      setKpi(name, "error", "—", describeError(res.error));
      return;
    }
    setKpi(name, "ok", integer.format(res.count), okNote);
  }

  function loadProducts() {
    var list = typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS) ? PRODUCTS : null;
    if (!list) return setKpi("produtos", "error", "—", "Catálogo indisponível");
    setKpi("produtos", "ok", integer.format(list.length), list.length === 1 ? "peça no catálogo do site" : "peças no catálogo do site");
  }

  /* ---------- pedidos recentes ---------- */
  function orderRow(order) {
    var li = document.createElement("li");
    li.className = "adm-order";

    var id = document.createElement("div");
    id.className = "adm-order-id";
    var number = document.createElement("strong");
    number.textContent = order.numero_pedido || "#" + String(order.id || "").slice(0, 8);
    var date = document.createElement("span");
    var when = order.criado_em ? new Date(order.criado_em) : null;
    date.textContent = when && !isNaN(when) ? when.toLocaleDateString("pt-BR") : "—";
    id.append(number, date);

    var status = document.createElement("span");
    status.className = "adm-status";
    status.textContent = String(order.status || "—").replace(/_/g, " ");

    var total = document.createElement("span");
    total.className = "adm-order-total";
    var amount = Number(order.total);
    total.textContent = isFinite(amount) ? brl.format(amount) : "—";

    li.append(id, status, total);
    return li;
  }

  function renderOrdersMessage(box, text) {
    box.replaceChildren();
    var p = document.createElement("p");
    p.className = "adm-empty";
    p.textContent = text;
    box.append(p);
  }

  async function loadRecentOrders() {
    var box = $("[data-recent-orders]");
    if (!box) return;
    box.setAttribute("aria-busy", "true");
    renderOrdersMessage(box, "Carregando pedidos…");
    var res;
    try {
      res = await db().from(SOURCES.pedidos.table)
        .select("id,numero_pedido,status,total,criado_em")
        .order("criado_em", { ascending: false })
        .limit(RECENT_LIMIT);
    } catch (e) { res = { error: e }; }
    box.setAttribute("aria-busy", "false");
    if (res.error) return renderOrdersMessage(box, describeError(res.error) + ".");
    if (!res.data || !res.data.length) return renderOrdersMessage(box, "Nenhum pedido registrado ainda.");
    var ul = document.createElement("ul");
    ul.className = "adm-orders";
    res.data.forEach(function (o) { ul.append(orderRow(o)); });
    box.replaceChildren(ul);
  }

  /* ---------- carga geral ---------- */
  async function loadAll() {
    var btn = $("[data-refresh]");
    if (btn) btn.disabled = true;
    loadProducts();
    setKpi("cupons", "soon", "—", "Em breve · ainda sem tabela");
    await Promise.all([
      loadCount("pedidos", "pedidos registrados"),
      loadCount("clientes", "clientes cadastrados"),
      loadRecentOrders()
    ]);
    if (btn) btn.disabled = false;
  }

  function renderToday() {
    var el = $("[data-today]");
    if (!el) return;
    var text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    el.textContent = text.charAt(0).toUpperCase() + text.slice(1);
  }

  async function boot() {
    var user = await window.AdminAuth.requireAdmin();
    if (!user) return; /* redirecionado ao login (ou erro de conexão mostrado) */
    window.AdminShell.mount({ active: "dashboard", user: user });
    document.body.classList.add("adm-ready");
    renderToday();
    var refresh = $("[data-refresh]");
    if (refresh) refresh.addEventListener("click", loadAll);
    loadAll();
  }

  boot();
})();
