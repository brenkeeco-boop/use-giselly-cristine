import { createClient } from "jsr:@supabase/supabase-js@2";

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const safeEqual = (a: string, b: string) => a.length === b.length && ![...a].reduce((v, c, i) => v | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0);
async function validSignature(signature: string | null, requestId: string | null, dataId: string, secret: string) {
  const fields = Object.fromEntries((signature ?? "").split(",").map((part) => part.trim().split("=", 2)));
  if (!fields.ts || !fields.v1) return false;
  const manifest = [`id:${dataId.toLowerCase()};`, requestId ? `request-id:${requestId};` : "", `ts:${fields.ts};`].join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return safeEqual(hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest))), fields.v1);
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("", { status: 405 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), secret = Deno.env.get("MP_WEBHOOK_SECRET"), token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!supabaseUrl || !serviceKey || !secret || !token) return new Response("", { status: 500 });
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return new Response("", { status: 400 }); }
  const dataId = request.url.includes("data.id=") ? new URL(request.url).searchParams.get("data.id") : (body.data as Record<string, unknown> | undefined)?.id;
  if (typeof dataId !== "string" && typeof dataId !== "number") return new Response("", { status: 400 });
  const paymentId = String(dataId);
  if (!await validSignature(request.headers.get("x-signature"), request.headers.get("x-request-id"), paymentId, secret)) return new Response("", { status: 401 });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: event, error } = await admin.rpc("registrar_evento_mercado_pago", { p_tipo: String(body.type ?? "payment"), p_acao: String(body.action ?? ""), p_recurso_id: paymentId, p_notificacao_id: body.id ? String(body.id) : null, p_request_id: request.headers.get("x-request-id"), p_live_mode: body.live_mode === true, p_assinatura_valida: true, p_payload: body });
  if (error) return new Response("", { status: 500 });
  const eventId = event?.[0]?.evento_id; if (!event?.[0]?.deve_processar) return new Response("", { status: 200 });
  try {
    if (body.type !== "payment") { await admin.from("mercado_pago_eventos").update({ status_processamento: "ignorado", processado_em: new Date().toISOString() }).eq("id", eventId); return new Response("", { status: 200 }); }
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!paymentResponse.ok) throw new Error(`payment_lookup_${paymentResponse.status}`);
    const payment = await paymentResponse.json();
    if (payment.live_mode !== true) {
      await admin.from("mercado_pago_eventos").update({ status_processamento: "ignorado", processado_em: new Date().toISOString(), erro: "ambiente_nao_producao" }).eq("id", eventId);
      return new Response("", { status: 200 });
    }
    if (payment.status === "approved") {
      if (payment.currency_id !== "BRL" || typeof payment.external_reference !== "string" || !/^[0-9a-f-]{36}$/i.test(payment.external_reference)) throw new Error("payment_data_invalid");
      const { error: approvalError } = await admin.rpc("registrar_pagamento_aprovado", { p_pedido_id: payment.external_reference, p_payment_id: paymentId, p_valor_pago: payment.transaction_amount, p_moeda: payment.currency_id, p_live_mode: true, p_metodo: payment.payment_type_id });
      if (approvalError) throw approvalError;
      await admin.from("mercado_pago_eventos").update({ pedido_id: payment.external_reference }).eq("id", eventId);
    }
    await admin.from("mercado_pago_eventos").update({ status_processamento: "processado", processado_em: new Date().toISOString(), erro: null }).eq("id", eventId);
    return new Response("", { status: 200 });
  } catch (cause) { console.error("webhook processing failed", { eventId, cause: String(cause) }); await admin.from("mercado_pago_eventos").update({ status_processamento: "erro", erro: "falha_de_processamento" }).eq("id", eventId); return new Response("", { status: 500 }); }
});
