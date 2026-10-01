/* Painel administrativo — Produtos (Etapa 2): CRUD sobre public.produtos.
   Usa o cliente Supabase existente (window.supabaseClient). Nenhuma chave secreta aqui:
   quem protege os dados é o RLS (ver admin/produtos-schema.sql). Este arquivo só faz o que a
   conta logada tem permissão de fazer; se o banco negar, a tela mostra o motivo.

   Pontos de atenção do RLS que o código trata de propósito:
   • update/delete barrados pelo RLS NÃO dão erro — afetam 0 linhas. Por isso sempre pedimos
     as linhas de volta (.select) e só anunciamos sucesso se veio ao menos uma.
   • Listagem busca tudo de uma vez e filtra no navegador (catálogo pequeno). O Supabase devolve
     no máximo 1000 linhas por consulta; se o catálogo passar disso, trocar por paginação. */
(function () {
  "use strict";

  var TABLE = "produtos";
  var COLS = "id,nome,slug,descricao,categoria,preco,preco_promocional,imagens,image_url,estoque,ativo,criado_em,atualizado_em";
  var IMAGE_BUCKET = "produtos";
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  var IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var DERIVED_CATEGORIES = ["novidades", "promocoes"]; /* em products.js são regras (isNew/oldPrice), não categorias */
  var MAX_PRICE = 99999999.99;                          /* limite de numeric(10,2) */
  var MAX_STOCK = 999999;                               /* bem abaixo do limite do integer; evita números absurdos por engano */

  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  var integer = new Intl.NumberFormat("pt-BR");
  var state = { items: [], q: "", cat: "", status: "", error: null };
  var editing = null;       /* produto em edição (null = criando) */
  var pendingDelete = null; /* produto aguardando confirmação de exclusão */
  var saving = false;
  var photos = [];

  function db() { return window.supabaseClient; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  function productImageUrls(product) {
    var urls = Array.isArray(product && product.imagens) ? product.imagens.filter(function (url) { return typeof url === "string" && url; }) : [];
    if (product && typeof product.image_url === "string" && product.image_url && urls.indexOf(product.image_url) === -1) urls.unshift(product.image_url);
    return urls;
  }

  function storagePathFromUrl(url) {
    var marker = "/storage/v1/object/public/" + IMAGE_BUCKET + "/";
    var index = typeof url === "string" ? url.indexOf(marker) : -1;
    if (index === -1) return null;
    try { return decodeURIComponent(url.slice(index + marker.length)); } catch (e) { return null; }
  }

  function revokePhotoPreviews() {
    photos.forEach(function (photo) { if (photo.preview && photo.file) URL.revokeObjectURL(photo.preview); });
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) n.append(c); }); /* strings viram nós de texto, nunca HTML */
    return n;
  }

  /* ---------- utilitários ---------- */
  function norm(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
  function capitalize(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }

  function slugify(text) {
    var s = norm(text).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
    return s || "produto";
  }

  /* Aceita "289,90", "289.90", "1.099,90", "R$ 1099", "1.099". Devolve número, null (vazio) ou NaN (inválido). */
  function parseBRL(text) {
    var s = String(text == null ? "" : text).trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
    if (s === "") return null;
    if (s.indexOf(",") !== -1) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
    var n = Math.round(Number(s) * 100) / 100;
    return n > MAX_PRICE ? NaN : n;
  }
  function toInput(n) { return n == null ? "" : Number(n).toFixed(2).replace(".", ","); }
  function money(n) { return brl.format(Number(n)); }

  function categoryLabel(value) {
    var labels = typeof CATEGORY_LABELS !== "undefined" ? CATEGORY_LABELS : {};
    return labels[value] || capitalize(value);
  }
  /* Categorias oferecidas: as reais de products.js + qualquer outra que já exista no banco. */
  function allCategories() {
    var labels = typeof CATEGORY_LABELS !== "undefined" ? CATEGORY_LABELS : {};
    var list = Object.keys(labels).filter(function (k) { return DERIVED_CATEGORIES.indexOf(k) === -1; })
      .map(function (k) { return { value: k, label: labels[k] }; });
    var seen = {};
    list.forEach(function (c) { seen[c.value] = true; });
    state.items.forEach(function (p) {
      if (p.categoria && !seen[p.categoria]) { seen[p.categoria] = true; list.push({ value: p.categoria, label: categoryLabel(p.categoria) }); }
    });
    return list;
  }

  /* ---------- erros do Supabase → mensagem em português ---------- */
  function explain(error) {
    var code = (error && error.code) || "";
    var status = error && error.status;
    var msg = String((error && error.message) || "").toLowerCase();
    if (/failed to fetch|network|timeout/.test(msg)) return { kind: "network", text: "Sem conexão com o servidor. Verifique sua internet e tente novamente." };
    if (code === "42703" || code === "PGRST204" || (/column/.test(msg) && /estoque/.test(msg))) return { kind: "nocolumn", text: "A coluna de estoque ainda não existe no Supabase." };
    if (code === "42P01" || code === "PGRST205" || status === 404) return { kind: "missing", text: "A tabela de produtos ainda não existe no Supabase." };
    if (code === "42501" || code === "PGRST301" || status === 401 || status === 403) return { kind: "denied", text: "Sem permissão para alterar os produtos com esta conta." };
    if (code === "23505") return { kind: "duplicate", text: "Já existe um produto com esse endereço." };
    if (code === "23514") {
      return { kind: "invalid", text: msg.indexOf("promo") !== -1 ? "O preço promocional precisa ser menor que o preço." : msg.indexOf("estoque") !== -1 ? "O estoque não pode ser negativo." : "Algum valor está fora do permitido." };
    }
    return { kind: "other", text: "Não foi possível concluir a operação. Tente novamente." };
  }
  var NO_ROWS = "Nada foi alterado. O produto pode ter sido removido ou sua conta não tem permissão para esta ação.";

  async function call(fn) {
    try { return await fn(); } catch (e) { return { data: null, error: e }; }
  }

  /* ---------- acesso ao banco ---------- */
  async function fetchAll() {
    return call(function () { return db().from(TABLE).select(COLS).order("criado_em", { ascending: false }); });
  }

  function payloadFrom(v, imageUrls) {
    var payload = { nome: v.nome, descricao: v.descricao, categoria: v.categoria, preco: v.preco, preco_promocional: v.preco_promocional, estoque: v.estoque, ativo: v.ativo };
    if (imageUrls) {
      payload.imagens = imageUrls;
      payload.image_url = imageUrls[0] || null;
    }
    return payload;
  }

  async function createProduct(v, imageUrls) {
    var taken = {};
    state.items.forEach(function (p) { taken[p.slug] = true; });
    var base = slugify(v.nome), n = 1, slug = base;
    while (taken[slug]) { n++; slug = base + "-" + n; }
    for (var attempt = 0; attempt < 6; attempt++) {
      var body = payloadFrom(v, imageUrls); body.slug = slug;
      var res = await call(function () { return db().from(TABLE).insert(body).select(COLS); });
      if (!res.error) return { ok: true, row: res.data && res.data[0] };
      var ex = explain(res.error);
      if (ex.kind !== "duplicate") return { ok: false, message: ex.text };
      n++; slug = base + "-" + n; /* alguém criou o mesmo endereço no meio do caminho: tenta o próximo */
    }
    return { ok: false, message: "Não foi possível gerar um endereço único para este produto. Tente um nome um pouco diferente." };
  }

  async function updateProduct(id, patch) {
    var res = await call(function () { return db().from(TABLE).update(patch).eq("id", id).select(COLS); });
    if (res.error) return { ok: false, message: explain(res.error).text };
    if (!res.data || !res.data.length) return { ok: false, message: NO_ROWS };
    return { ok: true, row: res.data[0] };
  }

  async function deleteProduct(id) {
    var res = await call(function () { return db().from(TABLE).delete().eq("id", id).select("id"); });
    if (res.error) return { ok: false, message: explain(res.error).text };
    if (!res.data || !res.data.length) return { ok: false, message: NO_ROWS };
    return { ok: true };
  }

  /* ---------- avisos ---------- */
  function toast(text, type) {
    var box = $("#admToasts");
    while (box.children.length >= 3) box.firstChild.remove();
    var t = el("div", { class: "adm-toast adm-toast--" + (type || "info"), text: text });
    box.append(t);
    setTimeout(function () { t.classList.add("is-out"); setTimeout(function () { t.remove(); }, 300); }, type === "error" ? 6500 : 3800);
  }

  /* ---------- lista ---------- */
  function matches(p) {
    if (state.cat && p.categoria !== state.cat) return false;
    if (state.status === "ativo" && !p.ativo) return false;
    if (state.status === "inativo" && p.ativo) return false;
    if (state.q && norm(p.nome).indexOf(norm(state.q)) === -1) return false;
    return true;
  }
  function hasFilters() { return Boolean(state.q || state.cat || state.status); }

  function rebuildCategoryFilter() {
    var select = $("#pCategoria");
    var keep = state.cat;
    select.replaceChildren(el("option", { value: "", text: "Todas as categorias" }));
    allCategories().forEach(function (c) { select.append(el("option", { value: c.value, text: c.label })); });
    if (keep && !allCategories().some(function (c) { return c.value === keep; })) { state.cat = ""; keep = ""; }
    select.value = keep;
  }

  function renderLoading() {
    var box = $("[data-list]");
    box.setAttribute("aria-busy", "true");
    box.replaceChildren();
    for (var i = 0; i < 4; i++) box.append(el("div", { class: "adm-skel", "aria-hidden": "true" }));
    $("[data-count]").textContent = "";
  }

  function stateBox(title, text, actions, extra) {
    return el("div", { class: "adm-state" }, [
      el("h2", { text: title }), el("p", { text: text }), extra || null,
      actions && actions.length ? el("div", { class: "adm-state-actions" }, actions) : null
    ]);
  }

  function errorState(err) {
    var retry = el("button", { class: "btn btn-outline", type: "button", "data-retry": true, text: "Tentar novamente" });
    if (err.kind === "missing") {
      return stateBox("Tabela de produtos não encontrada", err.text,
        [retry], el("p", { class: "adm-state-steps", text: "Abra o arquivo admin/produtos-schema.sql, cole no SQL Editor do Supabase e execute. Depois volte aqui e clique em “Tentar novamente”." }));
    }
    if (err.kind === "nocolumn") {
      return stateBox("Falta atualizar o banco de dados", err.text,
        [retry], el("p", { class: "adm-state-steps", text: "Abra o arquivo admin/estoque-schema.sql, cole no SQL Editor do Supabase e execute. Depois volte aqui e clique em “Tentar novamente”." }));
    }
    if (err.kind === "denied") {
      return stateBox("Sem permissão para ler os produtos", "O banco recusou a leitura para esta conta.",
        [retry], el("p", { class: "adm-state-steps", text: "Confirme que (1) esta conta tem o papel de administrador e você saiu e entrou de novo depois disso, e (2) o arquivo produtos-schema.sql foi executado — ele cria as permissões e a política de administrador." }));
    }
    return stateBox("Não foi possível carregar os produtos", err.text, [retry]);
  }

  function priceCell(p) {
    var promo = p.preco_promocional != null && Number(p.preco_promocional) < Number(p.preco);
    return el("td", { class: "adm-td-price", "data-label": "Preço" }, promo
      ? [el("b", { text: money(p.preco_promocional) }), el("s", { text: money(p.preco) })]
      : [el("b", { text: money(p.preco) })]);
  }

  function stockCell(p) {
    var n = Number(p.estoque);
    if (!isFinite(n) || n < 0) n = 0;
    return el("td", { class: "adm-td-stock", "data-label": "Estoque" }, n > 0
      ? [el("b", { text: integer.format(n) })]
      : [el("b", { text: "0" }), " ", el("span", { class: "adm-stock-out", text: "Sem estoque" })]);
  }

  function statusCell(p) {
    var sw = el("button", {
      type: "button", class: "adm-switch", role: "switch", "aria-checked": String(Boolean(p.ativo)),
      "aria-label": "Produto ativo: " + p.nome, "data-toggle": p.id
    }, [el("span", { class: "adm-switch-knob" })]);
    return el("td", { class: "adm-td-status", "data-label": "Status" }, [sw, el("span", { class: "adm-switch-text", text: p.ativo ? "Ativo" : "Inativo" })]);
  }

  function row(p) {
    return el("tr", { class: p.ativo ? "" : "is-inactive", "data-id": p.id }, [
      el("td", { class: "adm-td-name", "data-label": "Produto" }, [el("strong", { text: p.nome }), el("span", { class: "adm-sub", text: p.slug })]),
      el("td", { "data-label": "Categoria", text: categoryLabel(p.categoria) }),
      priceCell(p),
      stockCell(p),
      statusCell(p),
      el("td", { class: "adm-td-actions" }, [
        el("button", { class: "btn btn-outline adm-btn-sm", type: "button", "data-edit": p.id, "aria-label": "Editar " + p.nome, text: "Editar" }),
        el("button", { class: "adm-linkdanger", type: "button", "data-delete": p.id, "aria-label": "Excluir " + p.nome, text: "Excluir" })
      ])
    ]);
  }

  function renderList() {
    var box = $("[data-list]");
    box.setAttribute("aria-busy", "false");
    box.replaceChildren();
    var count = $("[data-count]");
    if (state.error) { count.textContent = ""; return box.append(errorState(state.error)); }

    var total = state.items.length;
    var shown = state.items.filter(matches);
    count.textContent = !total ? "" : hasFilters()
      ? "Mostrando " + shown.length + " de " + total + (total === 1 ? " produto" : " produtos")
      : total + (total === 1 ? " produto" : " produtos");

    if (!total) {
      return box.append(stateBox("Nenhum produto cadastrado ainda", "Cadastre a primeira peça do catálogo para começar.",
        [el("button", { class: "btn btn-wine", type: "button", "data-new-empty": true, text: "Cadastrar primeiro produto" })]));
    }
    if (!shown.length) {
      return box.append(stateBox("Nenhum produto encontrado", "Nenhum produto corresponde à busca ou aos filtros escolhidos.",
        [el("button", { class: "btn btn-outline", type: "button", "data-clear": true, text: "Limpar filtros" })]));
    }
    var head = el("tr", {}, [
      el("th", { scope: "col", text: "Produto" }), el("th", { scope: "col", text: "Categoria" }),
      el("th", { scope: "col", text: "Preço" }), el("th", { scope: "col", text: "Estoque" }), el("th", { scope: "col", text: "Status" }),
      el("th", { scope: "col" }, [el("span", { class: "adm-sr", text: "Ações" })])
    ]);
    var body = el("tbody");
    shown.forEach(function (p) { body.append(row(p)); });
    box.append(el("table", { class: "adm-table" }, [el("thead", {}, [head]), body]));
  }

  async function reload(silent) {
    if (silent) $("[data-list]").setAttribute("aria-busy", "true"); else renderLoading();
    var res = await fetchAll();
    if (res.error) { state.error = explain(res.error); state.items = []; }
    else { state.error = null; state.items = res.data || []; }
    rebuildCategoryFilter();
    renderList();
  }

  /* ---------- formulário (criar / editar) ---------- */
  var dlg, form;

  function showFieldError(field, text) {
    var map = { nome: "Nome", categoria: "Categoria", descricao: "Descricao", preco: "Preco", promo: "Promo", estoque: "Estoque" };
    var p = $("#e" + map[field]);
    p.textContent = text; p.hidden = false;
    var input = { nome: "#fNome", categoria: "#fCategoria", descricao: "#fDescricao", preco: "#fPreco", promo: "#fPromo", estoque: "#fEstoque" }[field];
    $(input).setAttribute("aria-invalid", "true");
  }
  function clearErrors() {
    form.querySelectorAll(".adm-fielderr").forEach(function (p) { p.hidden = true; p.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach(function (i) { i.removeAttribute("aria-invalid"); });
    $("#pFormError").hidden = true;
  }

  function renderPhotoPreviews() {
    var box = $("#fImagensPreview");
    box.replaceChildren();
    photos.forEach(function (photo, index) {
      var image = el("img", { src: photo.preview || photo.url, alt: "Foto " + (index + 1) + " do produto" });
      var actions = el("div", { class: "adm-photo-actions" });
      var up = el("button", { type: "button", "data-photo-up": String(index), "aria-label": "Mover foto para antes", text: "↑" });
      var down = el("button", { type: "button", "data-photo-down": String(index), "aria-label": "Mover foto para depois", text: "↓" });
      var remove = el("button", { type: "button", class: "adm-photo-remove", "data-photo-remove": String(index), "aria-label": "Remover foto", text: "Remover" });
      up.disabled = index === 0; down.disabled = index === photos.length - 1;
      actions.append(up, down, remove);
      var card = el("div", { class: "adm-photo-card" }, [image, index === 0 ? el("span", { class: "adm-photo-main", text: "Principal" }) : null, actions]);
      box.append(card);
    });
  }

  function resetPhotos(product) {
    revokePhotoPreviews();
    photos = productImageUrls(product).map(function (url) { return { url: url, preview: url, file: null }; });
    $("#fImagens").value = "";
    renderPhotoPreviews();
  }

  function addSelectedPhotos(fileList) {
    var invalid = [];
    Array.prototype.forEach.call(fileList || [], function (file) {
      if (!IMAGE_TYPES[file.type]) invalid.push(file.name + ": use JPG, PNG ou WebP.");
      else if (file.size > MAX_IMAGE_BYTES) invalid.push(file.name + ": ultrapassa o limite de 5 MB.");
      else photos.push({ file: file, preview: URL.createObjectURL(file), url: null });
    });
    renderPhotoPreviews();
    if (invalid.length) {
      var box = $("#pFormError"); box.textContent = invalid.join(" "); box.hidden = false;
    }
  }

  function movePhoto(index, direction) {
    var next = index + direction;
    if (next < 0 || next >= photos.length) return;
    var current = photos[index]; photos[index] = photos[next]; photos[next] = current;
    renderPhotoPreviews();
  }

  function removePhoto(index) {
    var photo = photos[index];
    if (!photo) return;
    if (photo.file && photo.preview) URL.revokeObjectURL(photo.preview);
    photos.splice(index, 1);
    renderPhotoPreviews();
  }

  function safeImagePath(file) {
    var id = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    return "products/" + id + "." + IMAGE_TYPES[file.type];
  }

  async function removeStorageFiles(paths) {
    if (!paths.length) return { error: null };
    return call(function () { return db().storage.from(IMAGE_BUCKET).remove(paths); });
  }

  function storageMessage(error) {
    var code = (error && error.statusCode) || (error && error.status) || "";
    var message = String((error && error.message) || "").toLowerCase();
    if (code === 404 || /bucket.*not found/.test(message)) return "O bucket de fotos ainda não foi configurado. Execute admin/storage-produtos-schema.sql no Supabase.";
    if (code === 401 || code === 403 || /permission|row-level security|not authorized/.test(message)) return "Sua conta não tem permissão para enviar fotos de produtos.";
    if (code === 413 || /size|too large/.test(message)) return "Uma foto ultrapassa o limite de 5 MB.";
    return "Não foi possível enviar uma das fotos. Nenhum produto foi salvo.";
  }

  async function prepareImages() {
    var uploaded = [];
    var urls = [];
    try {
      for (var i = 0; i < photos.length; i++) {
        var photo = photos[i];
        if (!photo.file) { urls.push(photo.url); continue; }
        var path = safeImagePath(photo.file);
        var upload = await call(function () {
          return db().storage.from(IMAGE_BUCKET).upload(path, photo.file, { cacheControl: "31536000", upsert: false, contentType: photo.file.type });
        });
        if (upload.error) throw upload.error;
        uploaded.push(path);
        var publicUrl = db().storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
        urls.push(publicUrl);
      }
      return { ok: true, urls: urls, uploaded: uploaded };
    } catch (error) {
      await removeStorageFiles(uploaded);
      return { ok: false, message: storageMessage(error) };
    }
  }

  function removedExistingPaths() {
    if (!editing) return [];
    var remaining = photos.filter(function (photo) { return !photo.file; }).map(function (photo) { return photo.url; });
    return productImageUrls(editing).filter(function (url) { return remaining.indexOf(url) === -1; })
      .map(storagePathFromUrl).filter(Boolean);
  }

  function openForm(product) {
    editing = product || null;
    clearErrors();
    $("#pDialogTitle").textContent = editing ? "Editar produto" : "Novo produto";
    $("#pSave").textContent = editing ? "Salvar alterações" : "Salvar produto";

    var select = $("#fCategoria");
    select.replaceChildren(el("option", { value: "", text: "Selecione…" }));
    allCategories().forEach(function (c) { select.append(el("option", { value: c.value, text: c.label })); });

    $("#fNome").value = editing ? editing.nome : "";
    select.value = editing ? editing.categoria : "";
    $("#fDescricao").value = editing && editing.descricao ? editing.descricao : "";
    $("#fPreco").value = editing ? toInput(editing.preco) : "";
    $("#fPromo").value = editing ? toInput(editing.preco_promocional) : "";
    $("#fEstoque").value = editing ? String(editing.estoque == null ? 0 : editing.estoque) : "0";
    $("#fAtivo").checked = editing ? Boolean(editing.ativo) : true;
    resetPhotos(editing);

    $("#fSlugLine").hidden = !editing;
    if (editing) $("#fSlug").textContent = editing.slug;

    document.body.classList.add("adm-noscroll");
    dlg.showModal();
    $("#fNome").focus();
  }

  function setSaving(on) {
    saving = on;
    var save = $("#pSave");
    save.disabled = on;
    save.textContent = on ? "Salvando…" : (editing ? "Salvar alterações" : "Salvar produto");
    dlg.querySelectorAll("[data-close]").forEach(function (b) { b.disabled = on; });
  }

  function validate() {
    var errors = {};
    var nome = $("#fNome").value.trim().replace(/\s+/g, " ");
    var categoria = $("#fCategoria").value;
    var descricao = $("#fDescricao").value.trim();
    var preco = parseBRL($("#fPreco").value);
    var promo = parseBRL($("#fPromo").value);
    var estoqueText = $("#fEstoque").value.trim();

    if (!nome) errors.nome = "Informe o nome do produto.";
    if (!categoria) errors.categoria = "Escolha uma categoria.";
    if (descricao.length > 2000) errors.descricao = "A descrição pode ter no máximo 2000 caracteres.";
    if (preco === null) errors.preco = "Informe o preço.";
    else if (isNaN(preco)) errors.preco = "Use um valor válido, como 289,90.";
    else if (preco <= 0) errors.preco = "O preço precisa ser maior que zero.";
    if (promo !== null) {
      if (isNaN(promo)) errors.promo = "Use um valor válido, como 249,90.";
      else if (promo <= 0) errors.promo = "O preço promocional precisa ser maior que zero.";
      else if (typeof preco === "number" && !isNaN(preco) && promo >= preco) errors.promo = "Precisa ser menor que o preço.";
    }
    if (estoqueText === "") errors.estoque = "Informe a quantidade em estoque (use 0 se não houver).";
    else if (!/^\d+$/.test(estoqueText)) errors.estoque = "Use um número inteiro igual ou maior que zero, como 25.";
    else if (Number(estoqueText) > MAX_STOCK) errors.estoque = "O estoque pode ter no máximo 999.999 unidades.";
    if (Object.keys(errors).length) return { errors: errors };
    return { values: { nome: nome, categoria: categoria, descricao: descricao || null, preco: preco, preco_promocional: promo, estoque: parseInt(estoqueText, 10), ativo: $("#fAtivo").checked } };
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (saving) return;
    clearErrors();
    var result = validate();
    if (result.errors) {
      var order = ["nome", "categoria", "descricao", "preco", "promo", "estoque"];
      order.forEach(function (f) { if (result.errors[f]) showFieldError(f, result.errors[f]); });
      var first = order.filter(function (f) { return result.errors[f]; })[0];
      $({ nome: "#fNome", categoria: "#fCategoria", descricao: "#fDescricao", preco: "#fPreco", promo: "#fPromo", estoque: "#fEstoque" }[first]).focus();
      return;
    }
    var wasEditing = editing;
    setSaving(true);
    var images = await prepareImages();
    if (!images.ok) {
      setSaving(false);
      var imageError = $("#pFormError"); imageError.textContent = images.message; imageError.hidden = false;
      return;
    }
    var res = wasEditing
      ? await updateProduct(wasEditing.id, payloadFrom(result.values, images.urls))
      : await createProduct(result.values, images.urls);
    if (!res.ok && images.uploaded.length) await removeStorageFiles(images.uploaded);
    setSaving(false);
    if (!res.ok) {
      var box = $("#pFormError"); box.textContent = res.message; box.hidden = false; return;
    }
    var removed = await removeStorageFiles(removedExistingPaths());
    dlg.close();
    toast(removed.error ? "Produto salvo, mas uma foto removida ficou pendente no Storage." : (wasEditing ? "Produto atualizado." : "Produto criado."), removed.error ? "info" : "success");
    await reload(true);
    if (wasEditing) { var back = $('[data-edit="' + (window.CSS && CSS.escape ? CSS.escape(wasEditing.id) : wasEditing.id) + '"]'); if (back) back.focus(); }
    if (!wasEditing && res.row && !matches(res.row)) { /* não deixa o produto novo "sumir" atrás de um filtro */
      state.q = ""; state.cat = ""; state.status = "";
      $("#pSearch").value = ""; $("#pCategoria").value = ""; $("#pStatus").value = "";
      renderList();
    }
  }

  /* ---------- ativar/desativar ---------- */
  async function onToggle(id, button) {
    var p = state.items.filter(function (x) { return x.id === id; })[0];
    if (!p || button.disabled) return;
    var next = !p.ativo;
    button.disabled = true; button.setAttribute("aria-busy", "true");
    var res = await updateProduct(id, { ativo: next });
    if (!res.ok) { toast(res.message, "error"); renderList(); }
    else {
      p.ativo = res.row.ativo; p.atualizado_em = res.row.atualizado_em;
      renderList();
      toast(p.ativo ? "Produto ativado." : "Produto desativado.", "success");
    }
    var again = $('[data-toggle="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (again) again.focus();
  }

  /* ---------- exclusão com confirmação ---------- */
  function askDelete(p) {
    pendingDelete = p;
    $("#pConfirmText").textContent = "“" + p.nome + "” será excluído permanentemente e não poderá ser recuperado. Se você só quer tirá-lo de circulação, desative o produto em vez de excluir.";
    $("#pConfirmError").hidden = true;
    $("#pConfirmOk").disabled = false; $("#pConfirmCancel").disabled = false;
    $("#pConfirmOk").textContent = "Excluir";
    document.body.classList.add("adm-noscroll");
    $("#pConfirm").showModal();
    $("#pConfirmCancel").focus(); /* o foco começa no botão seguro */
  }

  async function confirmDelete() {
    var p = pendingDelete; if (!p) return;
    var ok = $("#pConfirmOk"), cancel = $("#pConfirmCancel");
    ok.disabled = true; cancel.disabled = true; ok.textContent = "Excluindo…";
    var res = await deleteProduct(p.id);
    if (!res.ok) {
      ok.disabled = false; cancel.disabled = false; ok.textContent = "Excluir";
      var box = $("#pConfirmError"); box.textContent = res.message; box.hidden = false; return;
    }
    pendingDelete = null;
    $("#pConfirm").close();
    toast("Produto excluído.", "success");
    await reload(true);
    $("[data-new]").focus();
  }

  /* ---------- eventos ---------- */
  function wireDialog(dialog, guard) {
    var downOnBackdrop = false;
    dialog.addEventListener("mousedown", function (e) { downOnBackdrop = e.target === dialog; });
    dialog.addEventListener("click", function (e) { if (downOnBackdrop && e.target === dialog && !guard()) dialog.close(); downOnBackdrop = false; });
    dialog.addEventListener("cancel", function (e) { if (guard()) e.preventDefault(); }); /* Esc não fecha durante operação em andamento */
    dialog.addEventListener("close", function () { if (!document.querySelector("dialog[open]")) document.body.classList.remove("adm-noscroll"); });
  }

  function bind() {
    dlg = $("#pDialog"); form = $("#pForm");
    wireDialog(dlg, function () { return saving; });
    wireDialog($("#pConfirm"), function () { return $("#pConfirmOk").disabled; });
    form.addEventListener("submit", onSubmit);
    $("#fImagens").addEventListener("change", function (event) {
      clearErrors();
      addSelectedPhotos(event.target.files);
      event.target.value = "";
    });
    $("#fImagensPreview").addEventListener("click", function (event) {
      var button = event.target.closest("button"); if (!button || saving) return;
      var index = Number(button.getAttribute("data-photo-up") || button.getAttribute("data-photo-down") || button.getAttribute("data-photo-remove"));
      if (!isFinite(index)) return;
      if (button.hasAttribute("data-photo-up")) movePhoto(index, -1);
      else if (button.hasAttribute("data-photo-down")) movePhoto(index, 1);
      else if (button.hasAttribute("data-photo-remove")) removePhoto(index);
    });
    dlg.addEventListener("close", function () { if (!saving) resetPhotos(null); });
    /* o erro de um campo some assim que a pessoa volta a editá-lo (o do promocional também some ao mudar o preço, pois depende dele) */
    var clears = { fNome: ["eNome"], fCategoria: ["eCategoria"], fDescricao: ["eDescricao"], fPreco: ["ePreco", "ePromo"], fPromo: ["ePromo"], fEstoque: ["eEstoque"] };
    var inputOf = { eNome: "fNome", eCategoria: "fCategoria", eDescricao: "fDescricao", ePreco: "fPreco", ePromo: "fPromo", eEstoque: "fEstoque" };
    Object.keys(clears).forEach(function (id) {
      var clear = function () {
        clears[id].forEach(function (eid) { var p = $("#" + eid); p.hidden = true; p.textContent = ""; $("#" + inputOf[eid]).removeAttribute("aria-invalid"); });
      };
      $("#" + id).addEventListener("input", clear);
      $("#" + id).addEventListener("change", clear);
    });
    dlg.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { if (!saving) dlg.close(); }); });
    $("#pConfirmCancel").addEventListener("click", function () { pendingDelete = null; $("#pConfirm").close(); });
    $("#pConfirmOk").addEventListener("click", confirmDelete);

    $("[data-new]").addEventListener("click", function () { openForm(null); });

    $("#pSearch").addEventListener("input", function (e) { state.q = e.target.value; renderList(); });
    $("#pCategoria").addEventListener("change", function (e) { state.cat = e.target.value; renderList(); });
    $("#pStatus").addEventListener("change", function (e) { state.status = e.target.value; renderList(); });

    $("[data-list]").addEventListener("click", function (e) {
      var t = e.target.closest("button"); if (!t) return;
      var find = function (id) { return state.items.filter(function (x) { return x.id === id; })[0]; };
      if (t.hasAttribute("data-toggle")) return onToggle(t.getAttribute("data-toggle"), t);
      if (t.hasAttribute("data-edit")) { var p = find(t.getAttribute("data-edit")); if (p) openForm(p); return; }
      if (t.hasAttribute("data-delete")) { var d = find(t.getAttribute("data-delete")); if (d) askDelete(d); return; }
      if (t.hasAttribute("data-new-empty")) return openForm(null);
      if (t.hasAttribute("data-retry")) return reload(false);
      if (t.hasAttribute("data-clear")) {
        state.q = ""; state.cat = ""; state.status = "";
        $("#pSearch").value = ""; $("#pCategoria").value = ""; $("#pStatus").value = "";
        renderList(); $("#pSearch").focus();
      }
    });
  }

  async function boot() {
    var user = await window.AdminAuth.requireAdmin();
    if (!user) return; /* redirecionado ao login (ou erro de conexão mostrado) */
    window.AdminShell.mount({ active: "produtos", user: user });
    document.body.classList.add("adm-ready");
    bind();
    reload(false);
  }

  boot();
})();
