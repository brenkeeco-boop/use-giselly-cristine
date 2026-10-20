import { createClient } from "jsr:@supabase/supabase-js@2";

const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
const cors = { "Access-Control-Allow-Origin": appUrl, "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), publishable = Deno.env.get("SUPABASE_PUBLISHABLE_KEY"), mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!supabaseUrl || !serviceRole || !publishable || !mpToken || !appUrl) return reply({ error: "server_not_configured" }, 500);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "unauthorized" }, 401);
  const caller = createClient(supabaseUrl, publishable, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return reply({ error: "unauthorized" }, 401);
  let body: { items?: unknown; address?: unknown; shippingType?: unknown; idempotencyKey?: unknown };
  try { body = await request.json(); } catch { return reply({ error: "invalid_json" }, 400); }
  if (typeof body.idempotencyKey !== "string" || !uuid.test(body.idempotencyKey)) return reply({ error: "invalid_idempotency_key" }, 400);
  if (!Array.isArray(body.items) || !body.items.length || typeof body.address !== "object" || body.address === null) return reply({ error: "invalid_checkout_data" }, 400);
  const shippingType = body.shippingType === "expresso" ? "expresso" : body.shippingType === "padrao" ? "padrao" : null;
  if (!shippingType) return reply({ error: "invalid_shipping_type" }, 400);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: order, error: orderError } = await admin.rpc("criar_pedido_com_reserva", { p_usuario_id: user.id, p_chave_idempotencia: body.idempotencyKey, p_itens: body.items, p_endereco: body.address, p_frete_tipo: shippingType, p_minutos_reserva: 15 });
  if (orderError || !order) {
    const disabled = orderError?.message === "checkout_desativado";
    console.error("order reservation rejected", { code: orderError?.code, message: orderError?.message });
    return reply({ error: disabled ? "checkout_disabled" : "order_unavailable" }, disabled ? 503 : 400);
  }
  if (order.status !== "aguardando_pagamento") return reply({ error: "order_not_payable" }, 409);

  let preference: Record<string, unknown> | null = null;
  if (order.mercado_pago_preference_id) {
    const existing = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(order.mercado_pago_preference_id)}`, { headers: { Authorization: `Bearer ${mpToken}` } });
    if (!existing.ok) return reply({ error: "preference_unavailable" }, 502);
    preference = await existing.json();
  } else {
    // Recovers a preference whose Mercado Pago response was lost before its ID was stored.
    const search = await fetch(`https://api.mercadopago.com/checkout/preferences/search?external_reference=${encodeURIComponent(order.pedido_id)}`, { headers: { Authorization: `Bearer ${mpToken}` } });
    if (search.ok) preference = (await search.json()).results?.[0] ?? null;
  }
  if (!preference) {
    const { data: items, error: itemsError } = await admin.from("pedido_itens").select("produto_id,nome_produto,quantidade,preco_unitario,imagem_produto").eq("pedido_id", order.pedido_id);
    if (itemsError || !items?.length) return reply({ error: "order_items_unavailable" }, 500);
    const created = await fetch("https://api.mercadopago.com/checkout/preferences", { method: "POST", headers: { Authorization: `Bearer ${mpToken}`, "Content-Type": "application/json" }, body: JSON.stringify({
      external_reference: order.pedido_id,
      items: items.map((item) => ({ id: item.produto_id, title: item.nome_produto, quantity: item.quantidade, unit_price: Number(item.preco_unitario), currency_id: "BRL", ...(item.imagem_produto ? { picture_url: item.imagem_produto } : {}) })),
      shipments: { cost: Number(order.frete), mode: "not_specified" },
      notification_url: `${supabaseUrl}/functions/v1/webhook-mercado-pago`,
      back_urls: { success: `${appUrl}/conta.html?tab=pedidos`, pending: `${appUrl}/conta.html?tab=pedidos`, failure: `${appUrl}/checkout.html` },
      auto_return: "approved", expires: true, expiration_date_to: order.pagamento_expira_em,
    }) });
    if (!created.ok) {
      const { error: releaseError } = await admin.rpc("liberar_reserva_pedido", { p_pedido_id: order.pedido_id, p_status_final: "cancelado" });
      console.error("preference creation failed", { status: created.status, reservationReleased: !releaseError });
      return reply({ error: "payment_provider_unavailable" }, 502);
    }
    preference = await created.json();
  }
  if (!preference?.id || !preference.init_point) return reply({ error: "invalid_provider_response" }, 502);
  const { error: saveError } = await admin.from("pedidos").update({ mercado_pago_preference_id: preference.id }).eq("id", order.pedido_id);
  if (saveError) { console.error("preference persistence failed", { code: saveError.code }); return reply({ error: "preference_not_persisted" }, 500); }
  return reply({ checkoutUrl: preference.init_point, expiresAt: order.pagamento_expira_em });
});
