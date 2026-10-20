import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const hex = (input: ArrayBuffer) => Array.from(new Uint8Array(input)).map(x => x.toString(16).padStart(2, "0")).join("");
const secureEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const sameMoney = (left: unknown, right: unknown) => Number(left).toFixed(2) === Number(right).toFixed(2);
async function signatureIsValid(request: Request, paymentId: string, secret: string) {
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const entries = Object.fromEntries(signature.split(",").map(part => part.trim().split("=", 2)));
  if (!entries.ts || !entries.v1) return false;
  const manifest = `id:${paymentId.toLowerCase()};request-id:${requestId};ts:${entries.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest)));
  return secureEqual(expected, entries.v1);
}
Deno.serve(async (request) => {
  const url = new URL(request.url); const paymentId = url.searchParams.get("data.id") || "";
  const secret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET");
  if (request.method !== "POST" || !paymentId || !secret || !(await signatureIsValid(request, paymentId, secret))) return new Response("unauthorized", { status: 401 });
  const token = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!token) return new Response("not configured", { status: 503 });
  let response: Response;
  try { response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${token}` } }); } catch { return new Response("provider unavailable", { status: 502 }); }
  const payment = await response.json().catch(() => ({})); if (!response.ok || payment.currency_id !== "BRL" || !payment.external_reference) return new Response("invalid", { status: 422 });
  const { data: order } = await supabase.from("pedidos").select("id,total").eq("id", payment.external_reference).single();
  if (!order || !sameMoney(order.total, payment.transaction_amount)) return new Response("mismatch", { status: 422 });
  const { error } = await supabase.rpc("finalizar_pagamento_checkout", { p_pedido_id: order.id, p_status: String(payment.status || "pending"), p_referencia: String(payment.id), p_detalhes: payment, p_evento_id: `${paymentId}:${payment.status}:${payment.date_last_updated || ""}` });
  return new Response(error ? "error" : "ok", { status: error ? 500 : 200 });
});
