# Etapa 2 — Pagamentos Mercado Pago

O checkout continua desativado em duas camadas: `checkout_ativo` permanece `false` no banco e `assets/js/checkout.js` deixa o botão bloqueado. Não altere nenhuma delas antes da validação final.

## Inspeção realizada

As assinaturas no SQL do repositório, usadas por estas funções, são:

- `criar_pedido_com_reserva(uuid, uuid, jsonb, jsonb, text, integer) returns jsonb`
- `registrar_pagamento_aprovado(uuid, text, numeric, text, boolean, text) returns text`
- `liberar_reserva_pedido(uuid, text) returns integer`
- `listar_reservas_vencidas(integer) returns table (pedido_id, numero_pedido, mercado_pago_preference_id, mercado_pago_payment_id, pagamento_expira_em)`
- `registrar_evento_mercado_pago(text, text, text, text, text, boolean, boolean, jsonb) returns table (evento_id, deve_processar)`

Foi informado que a migração e as verificações pós-migração passaram. Este projeto não teve acesso remoto ao banco para conferir essa informação diretamente.

## Arquivos criados ou alterados

- `supabase/functions/criar-pagamento/index.ts`: autentica o cliente, chama a RPC de reserva com 15 minutos, recupera preferências repetidas por pedido e cria a preferência Checkout Pro somente com itens/preços vindos do banco.
- `supabase/functions/webhook-mercado-pago/index.ts`: valida `x-signature` com HMAC SHA-256, busca o pagamento na API do Mercado Pago e processa aprovações de produção de forma idempotente.
- `supabase/functions/expirar-reservas/index.ts`: busca reservas vencidas em lote, consulta pagamentos e só libera as sem pagamento ou com estado terminal. Pendentes/em processamento são mantidos para nova conciliação.
- `supabase/config.toml`: configura a verificação de JWT por função.
- `checkout.html` e `assets/js/checkout.js`: usam catálogo/carrinho reais e enviam apenas slug, cor, tamanho e quantidade; não enviam preços ou dados de cartão.

## Conflitos preservados do projeto principal

O projeto já possuía `create-mercado-pago-payment`, `mercado-pago-webhook`, `checkout-real.js` e uma migração de checkout anterior, voltados a um fluxo Pix diferente. Eles não foram removidos nem modificados. `checkout.html` passou a apontar para o fluxo novo `criar-pagamento`/Checkout Pro; antes do deploy, escolha formalmente qual fluxo será mantido em produção para evitar dois caminhos de pagamento concorrentes.

O resumo mostra somente o subtotal local e informa que frete/total serão calculados no servidor. Assim, a interface não exibe um total incorreto caso `frete_padrao` ou `frete_expresso` ainda não estejam em zero no banco.

## Secrets do Supabase

Cadastre pelo painel ou CLI, sem incluir valores em arquivos ou chat:

- `MP_ACCESS_TOKEN`: token privado de produção do Mercado Pago.
- `MP_WEBHOOK_SECRET`: chave secreta do webhook da aplicação Mercado Pago.
- `APP_URL`: URL HTTPS pública do site, sem barra no final.
- `EXPIRAR_RESERVAS_TOKEN`: token aleatório exclusivo do agendador.

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_PUBLISHABLE_KEY` são lidos somente dentro do runtime das Edge Functions.

## Implantação (depois da validação)

```powershell
supabase secrets set MP_ACCESS_TOKEN="..." MP_WEBHOOK_SECRET="..." APP_URL="https://www.seu-dominio.com.br" EXPIRAR_RESERVAS_TOKEN="..."
supabase functions deploy criar-pagamento
supabase functions deploy webhook-mercado-pago --no-verify-jwt
supabase functions deploy expirar-reservas --no-verify-jwt
```

No painel Mercado Pago, configure o evento **Payments** para:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/webhook-mercado-pago
```

O endpoint exige HTTPS e valida a assinatura enviada pelo Mercado Pago. A URL definida por preferência também aponta para esse endpoint.

## Agendamento de expiração

Não foi escolhido um mecanismo automaticamente. A verificação prévia deve indicar se `pg_cron`/`pg_net` estão disponíveis; caso estejam, o agendamento pode chamar `expirar-reservas` a cada 2–5 minutos com `Authorization: Bearer <EXPIRAR_RESERVAS_TOKEN>`. Caso não estejam, configure um agendador externo confiável com o mesmo cabeçalho. O endpoint processa no máximo 50 reservas por execução.

## Testes e pendências

Verificado localmente: sintaxe JavaScript do checkout, referências aos nomes e retornos das RPCs no SQL local, ausência de segredos inseridos no frontend e empacotamento do projeto. Não foram feitas chamadas ao Supabase remoto, Mercado Pago, webhook ou pagamento real. Deno e a CLI do Supabase não estão instalados neste ambiente, portanto não foi executado lint/deploy das Edge Functions.

Antes de ativar compras, confirme que `frete_padrao` e `frete_expresso` estejam em `0` em `configuracoes` — a RPC calcula esses valores no servidor. Em seguida, faça o deploy, simule somente a entrega do webhook pelo painel Mercado Pago, valide os registros e o comportamento de reserva em ambiente de teste/branch. Só então remova o bloqueio do botão e altere `checkout_ativo` conforme seu processo de aprovação.
