# Checkout e Mercado Pago

## Antes de aplicar

1. Execute `outputs/checkout-schema-audit.sql` no SQL Editor e compare as colunas existentes.
2. Aplique `supabase/migrations/20261013_checkout_real.sql` somente se não houver conflitos no schema de pedidos existente.
3. Cadastre faixas de CEP realmente elegíveis em `public.frete_cep_elegiveis`. Sem uma faixa válida, o checkout bloqueia o pagamento em vez de inventar frete.

## Secrets das Edge Functions

Nunca coloque estes valores no JavaScript ou GitHub Pages:

```sh
supabase secrets set MERCADO_PAGO_ACCESS_TOKEN=TEST-... \
  MERCADO_PAGO_WEBHOOK_SECRET=... \
  SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_URL` é disponibilizada pelo ambiente das Functions. A chave pública do Mercado Pago ainda é necessária para habilitar cartão via SDK/Brick; até isso estar configurado, o checkout oferece somente Pix.

## Deploy

```sh
supabase functions deploy create-mercado-pago-payment
supabase functions deploy mercado-pago-webhook --no-verify-jwt
```

No painel Mercado Pago, registre a URL abaixo para o evento de pagamento e copie a assinatura secreta para `MERCADO_PAGO_WEBHOOK_SECRET`:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/mercado-pago-webhook
```

Use credenciais de teste primeiro. O webhook verifica assinatura, consulta o pagamento diretamente no Mercado Pago, confere pedido/valor/moeda e chama a RPC idempotente antes de mudar o estado.
