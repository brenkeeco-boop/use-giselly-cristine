# Operação do checkout (preparação local)

Nada deste diretório foi aplicado ao Supabase nesta etapa.

1. Execute `checkout-schema-audit.sql` no SQL Editor e guarde o resultado.
2. Compare tipos, chaves estrangeiras, índices, grants e policies das tabelas listadas no relatório com a migration `migrations/20261013_checkout_real.sql`.
3. Somente se os pré-requisitos estiverem confirmados, aplique a migration em ambiente de teste. Ela aborta se o carrinho não usar `produto_id` textual com o `slug` de `produtos`.
4. Configure nos segredos das Edge Functions: `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` e `CHECKOUT_ALLOWED_ORIGINS` (lista de origens separada por vírgula; não use `*`). Nunca ponha esses valores no frontend.
5. Depois da validação em sandbox, configure uma rotina externa/cron para executar `select public.expirar_reservas_checkout();` periodicamente (por exemplo, a cada 5 minutos). Não habilite o agendamento sem revisar permissões e observabilidade.

O webhook é público somente porque o Mercado Pago não possui JWT do Supabase; a autenticação dele depende da assinatura `x-signature` e da consulta posterior da API do Mercado Pago.
