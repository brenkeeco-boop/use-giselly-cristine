/* Checkout: o banco/RPC é a fonte de preço, cupom, estoque e total. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  let busy = false;
  function notice(message, type) { const el = $("#checkoutNotice"); el.textContent = message; el.style.color = type === "error" ? "var(--wine)" : ""; }
  function safe(value) { const d = document.createElement("div"); d.textContent = value == null ? "" : String(value); return d.innerHTML; }
  function drawCart() {
    const cart = getCart(); const subtotal = cartSubtotal();
    $("#orderMini").innerHTML = cart.map((item) => { const p = getProductById(item.productId); return p ? `<div class="cr-mini"><img src="${p.images[0] || ""}" alt=""><div><div>${safe(p.rawName || p.name)}</div><div style="color:var(--ink-soft)">${safe(item.color || "")}${item.size ? ` · Tam. ${safe(item.size)}` : ""} · ${item.qty}x</div></div></div>` : ""; }).join("") || "<p style=\"color:var(--ink-soft);font-size:.85rem\">Sua sacola está vazia.</p>";
    $("#sumSubtotal").textContent = formatBRL(subtotal); $("#sumFrete").textContent = "A confirmar"; $("#sumTotal").textContent = "Será calculado ao gerar o Pix";
    $("#placeOrderBtn").disabled = !cart.length;
  }
  function showServerTotals(result) {
    $("#sumSubtotal").textContent = formatBRL(Number(result.subtotal || 0));
    $("#sumFrete").textContent = Number(result.frete || 0) === 0 ? "Grátis" : formatBRL(Number(result.frete));
    $("#sumTotal").textContent = formatBRL(Number(result.total || 0));
    const coupon = Number(result.desconto_cupom || 0);
    const pix = Number(result.desconto_pix || 0);
    notice(`Valores confirmados pelo servidor.${coupon ? ` Cupom: -${formatBRL(coupon)}.` : ""}${pix ? ` Desconto Pix: -${formatBRL(pix)}.` : ""}`);
  }
  async function loadAddresses(user) {
    const select = $("#checkoutAddress");
    const { data, error } = await supabaseClient.from("enderecos").select("id,identificacao,nome_destinatario,rua,numero,bairro,cidade,estado,cep,principal").eq("usuario_id", user.id).order("principal", { ascending: false }).order("criado_em", { ascending: false });
    if (error) { select.innerHTML = "<option value=\"\">Não foi possível carregar endereços</option>"; notice("Não foi possível carregar seus endereços.", "error"); return; }
    select.innerHTML = '<option value="">Selecione um endereço</option>' + data.map(a => `<option value="${a.id}">${safe(a.identificacao || "Endereço")} — ${safe(a.rua)}, ${safe(a.numero)} · ${safe(a.cidade)}/${safe(a.estado)}</option>`).join("");
    if (data.length) { select.value = data[0].id; notice(""); } else notice("Cadastre um endereço para continuar.", "error");
  }
  async function createOrder() {
    if (busy) return; const { data: auth } = await supabaseClient.auth.getSession();
    if (!auth.session) { location.href = `conta.html?tab=entrar&returnTo=${encodeURIComponent("checkout.html")}`; return; }
    if (!getCart().length) return notice("Sua sacola está vazia.", "error");
    const addressId = $("#checkoutAddress").value; if (!addressId) return notice("Selecione um endereço de entrega.", "error");
    busy = true; const button = $("#placeOrderBtn"); button.disabled = true; button.textContent = "Validando pedido…"; notice("");
    const key = sessionStorage.getItem("ugc_checkout_key") || crypto.randomUUID(); sessionStorage.setItem("ugc_checkout_key", key);
    const { data: result, error } = await supabaseClient.rpc("criar_pedido_checkout", { p_endereco_id: addressId, p_cupom: $("#couponCode").value.trim(), p_metodo: "pix", p_chave_idempotencia: key });
    if (error) { busy = false; button.disabled = false; button.textContent = "Gerar Pix"; const message = /FRETE_PENDENTE/.test(error.message) ? "O frete desta região precisa ser confirmado antes do pagamento." : /CUPOM_INVALIDO/.test(error.message) ? "Cupom inválido, inativo ou expirado." : /ESTOQUE_INDISPONIVEL/.test(error.message) ? "Um item ficou sem estoque. Revise sua sacola." : /PEDIDO_PENDENTE/.test(error.message) ? "Você já possui um pagamento Pix pendente para esta sacola." : "Não foi possível validar o pedido. Tente novamente."; return notice(message, "error"); }
    showServerTotals(result);
    const { data: payment, error: paymentError } = await supabaseClient.functions.invoke("create-mercado-pago-payment", { body: { pedido_id: result.pedido_id } });
    busy = false; button.disabled = false; button.textContent = "Gerar Pix";
    if (paymentError || payment?.error) return notice("Pedido criado e aguardando pagamento. A geração do Pix ainda não está configurada.", "error");
    $("#pixPayment").hidden = false; $("#pixPayment").innerHTML = `${payment.qr_code_base64 ? `<img alt="QR Code Pix" src="data:image/jpeg;base64,${payment.qr_code_base64}">` : ""}<p><strong>Pedido ${safe(result.numero_pedido)}</strong></p><textarea readonly aria-label="Código Pix copia e cola">${safe(payment.qr_code || "")}</textarea><p class="label">Aguardando confirmação do pagamento.</p>`; notice("Pix gerado. A confirmação será atualizada pelo servidor.");
  }
  async function boot() {
    mountLayout(); drawCart();
    const { data } = await supabaseClient.auth.getSession(); if (!data.session) { notice("Entre na sua conta para finalizar a compra."); return; }
    await Promise.all([window.catalogReady, loadCloudCart()]); drawCart(); await loadAddresses(data.session.user);
    $("#placeOrderBtn").addEventListener("click", createOrder);
  }
  boot().catch(() => notice("Não foi possível iniciar o checkout.", "error"));
})();
