import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const allowedOrigins = (Deno.env.get("CHECKOUT_ALLOWED_ORIGINS") || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const corsFor = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
};
const sameMoney = (left: unknown, right: unknown) => Number(left).toFixed(2) === Number(right).toFixed(2);
const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(request), "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsFor(request) });
  if (request.method !== "POST") return json(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = request.headers.get("Authorization");
  if (!auth) return json(request, { error: "AUTH_REQUIRED" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: userData } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
  if (!userData.user) return json(request, { error: "AUTH_REQUIRED" }, 401);
  const input = await request.json().catch(() => ({}));
  const pedidoId = String(input.pedido_id || "");
  if (!pedidoId) return json(request, { error: "PEDIDO_INVALIDO" }, 400);
  const { data: order, error } = await supabase.from("pedidos").select("id,numero_pedido,usuario_id,total,metodo_pagamento,pagamento_status,reserva_expira_em").eq("id", pedidoId).eq("usuario_id", userData.user.id).single();
  if (error || !order || order.pagamento_status !== "pendente") return json(request, { error: "PEDIDO_INDISPONIVEL" }, 409);
  if (order.metodo_pagamento !== "pix") return json(request, { error: "METODO_AINDA_NAO_HABILITADO" }, 422);
  if (!order.reserva_expira_em || new Date(order.reserva_expira_em).getTime() <= Date.now()) return json(request, { error: "RESERVA_EXPIRADA" }, 409);
  if (!Number.isFinite(Number(order.total)) || Number(order.total) <= 0) return json(request, { error: "VALOR_INVALIDO" }, 422);
  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if (!accessToken) return json(request, { error: "PAGAMENTO_NAO_CONFIGURADO" }, 503);
  const payerEmail = userData.user.email;
  if (!payerEmail) return json(request, { error: "EMAIL_OBRIGATORIO" }, 422);
  const existing = await supabase.from("pagamentos").select("referencia_externa,detalhes").eq("pedido_id", order.id).maybeSingle();
  if (existing.error) return json(request, { error: "PAGAMENTO_INDISPONIVEL" }, 500);
  if (existing.data?.referencia_externa) return json(request, { error: "PAGAMENTO_JA_INICIADO" }, 409);
  let paymentResponse: Response;
  try { paymentResponse = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-Idempotency-Key": order.id },
    body: JSON.stringify({ transaction_amount: Number(order.total), description: `Pedido ${order.numero_pedido}`, external_reference: order.id, payment_method_id: "pix", payer: { email: payerEmail } })
  }); } catch { return json(request, { error: "MERCADO_PAGO_INDISPONIVEL" }, 502); }
  const payment = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok || !payment.id) return json(request, { error: "MERCADO_PAGO_RECUSOU_CRIACAO", details: payment.message || null }, 502);
  if (!sameMoney(payment.transaction_amount, order.total) || payment.currency_id !== "BRL" || payment.external_reference !== order.id) return json(request, { error: "RESPOSTA_PAGAMENTO_INVALIDA" }, 502);
  const { error: saveError } = await supabase.from("pagamentos").update({ referencia_externa: String(payment.id), detalhes: payment, atualizado_em: new Date().toISOString() }).eq("pedido_id", order.id).is("referencia_externa", null);
  if (saveError) return json(request, { error: "PAGAMENTO_NAO_REGISTRADO" }, 500);
  const tx = payment.point_of_interaction?.transaction_data || {};
  return json(request, { pedido_id: order.id, status: payment.status, qr_code: tx.qr_code || null, qr_code_base64: tx.qr_code_base64 || null, ticket_url: tx.ticket_url || null });
});
