import { createClient } from "jsr:@supabase/supabase-js@2";

const result = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return result({ error: "method_not_allowed" }, 405);
  const expectedToken = Deno.env.get("EXPIRAR_RESERVAS_TOKEN");
  if (!expectedToken || request.headers.get("Authorization") !== `Bearer ${expectedToken}`) return result({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!url || !key || !mpToken) return result({ error: "server_not_configured" }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: expired, error } = await admin.rpc("listar_reservas_vencidas", { p_limite: 50 });
  if (error) return result({ error: "expired_orders_unavailable" }, 500);
  const summary = { checked: 0, released: 0, approved: 0, retained: 0, errors: 0 };
  for (const order of expired ?? []) {
    summary.checked++;
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(order.pedido_id)}&limit=100`, { headers: { Authorization: `Bearer ${mpToken}` } });
      if (!response.ok) throw new Error(`payment_search_${response.status}`);
      const payments = (await response.json()).results ?? [];
      const approved = payments.find((p: Record<string, unknown>) => p.status === "approved");
      if (approved) {
        const { error: approvalError } = await admin.rpc("registrar_pagamento_aprovado", { p_pedido_id: order.pedido_id, p_payment_id: String(approved.id), p_valor_pago: approved.transaction_amount, p_moeda: approved.currency_id, p_live_mode: approved.live_mode === true, p_metodo: approved.payment_type_id });
        if (approvalError) throw approvalError;
        summary.approved++; continue;
      }
      // pending/in_process/authorized are deliberately retained and rechecked on the next run.
      if (payments.some((p: Record<string, unknown>) => ["pending", "in_process", "authorized"].includes(String(p.status)))) { summary.retained++; continue; }
      const { error: releaseError } = await admin.rpc("liberar_reserva_pedido", { p_pedido_id: order.pedido_id, p_status_final: "expirado" });
      if (releaseError) throw releaseError;
      summary.released++;
    } catch (cause) { summary.errors++; console.error("reservation reconciliation failed", { orderId: order.pedido_id, cause: String(cause) }); }
  }
  return result(summary);
});
