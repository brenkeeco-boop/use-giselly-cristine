/* Checkout Pro: o botão fica desativado até a validação final. Nenhum preço ou segredo sai daqui. */
(function () {
  "use strict";
  const CHECKOUT_ENABLED = false;
  const button = document.getElementById("placeOrderBtn");
  const notice = document.getElementById("checkoutNotice");

  function esc(value) { const node = document.createElement("span"); node.textContent = String(value ?? ""); return node.innerHTML; }
  function render() {
    const cart = getCart();
    const subtotal = cartSubtotal();
    document.getElementById("orderMini").innerHTML = cart.map((item) => {
      const product = getProductById(item.productId); if (!product) return "";
      const image = product.rawImages?.[0] || "";
      return `<div class="cr-mini">${image ? `<img src="${esc(image)}" alt="">` : ""}<div><div>${product.name}</div><div style="color:var(--ink-soft)">Tam. ${esc(item.size)} · ${item.qty}x</div></div></div>`;
    }).join("") || `<p style="color:var(--ink-soft);font-size:.85rem">Sua sacola está vazia.</p>`;
    document.getElementById("sumSubtotal").textContent = formatBRL(subtotal);
    // A RPC calcula o frete e o total no banco. Antes da criação do pedido, não exibimos
    // um total final que possa divergir da configuração comercial vigente no servidor.
    document.getElementById("sumFrete").textContent = "Calculado no pagamento";
    document.getElementById("sumTotal").textContent = "A confirmar";
    button.disabled = !CHECKOUT_ENABLED || !cart.length;
  }
  function addressFromForm() {
    const value = (name) => document.querySelector(`[name="${name}"]`).value.trim();
    return { nome_destinatario: value("nome_destinatario"), cep: value("cep"), rua: value("rua"), numero: value("numero"), complemento: value("complemento"), bairro: value("bairro"), cidade: value("cidade"), estado: value("estado").toUpperCase() };
  }
  function itemsFromCart() { return getCart().map((item) => ({ produto_id: item.productId, cor: item.color, tamanho: item.size, quantidade: item.qty })); }
  async function startPayment() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { location.href = `conta.html?tab=entrar&returnTo=${encodeURIComponent("checkout.html")}`; return; }
    const items = itemsFromCart(); if (!items.length) { notice.textContent = "Sua sacola está vazia."; return; }
    const required = [...document.querySelectorAll("input[required]")];
    if (required.some((input) => !input.reportValidity())) { notice.textContent = "Preencha os dados de entrega."; return; }
    button.disabled = true; notice.textContent = "Preparando o pagamento seguro…";
    const key = sessionStorage.getItem("ugc_payment_idempotency") || crypto.randomUUID(); sessionStorage.setItem("ugc_payment_idempotency", key);
    const { data, error } = await supabaseClient.functions.invoke("criar-pagamento", { body: { items, address: addressFromForm(), shippingType: document.querySelector('[name="shipping"]:checked').value, idempotencyKey: key } });
    if (error || !data?.checkoutUrl) { console.error("payment initiation failed", { message: error?.message, code: error?.context?.status }); notice.textContent = data?.error === "checkout_disabled" ? "As compras ainda estão desativadas." : "Não foi possível iniciar o pagamento. Tente novamente."; button.disabled = false; return; }
    sessionStorage.removeItem("ugc_payment_idempotency"); location.assign(data.checkoutUrl);
  }
  async function init() { mountLayout(); const catalog = await window.catalogReady; if (!catalog?.ok) { notice.textContent = "Não foi possível carregar o catálogo."; return; } await loadCloudCart().catch(() => {}); render(); }
  button.addEventListener("click", startPayment); document.addEventListener("ugc:cart-updated", render); init();
})();
