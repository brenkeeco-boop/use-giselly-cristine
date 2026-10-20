-- =====================================================================================
-- Use Giselly Cristine — Etapa 2 · VERIFICAÇÃO
-- >>> NENHUMA DESTAS CONSULTAS FOI EXECUTADA POR MIM. Escritas sem acesso ao banco. <<<
-- Rode UMA consulta por vez no SQL Editor (selecione o trecho e Run).
--   PARTE A — PRÉ-MIGRAÇÃO: só leitura. Rode antes de qualquer migração.
--   PARTE B — PÓS-MIGRAÇÃO: só leitura. Rode depois (quando eu autorizar a migração).
--   PARTE C — TESTE DE FUNÇÕES: grava e DESFAZ tudo sozinho (ver aviso). Só com autorização.
-- =====================================================================================


-- #####################################################################################
-- PARTE A — PRÉ-MIGRAÇÃO (somente leitura)
-- #####################################################################################

-- A1. Colunas de pedidos e pedido_itens (tipo, obrigatória?, valor padrão).
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name in ('pedidos', 'pedido_itens')
 order by table_name, ordinal_position;

-- A2. Constraints (CHECK, FK com regra de exclusão, únicas) das tabelas envolvidas.
--     Procure: CHECKs de status/status_entrega/estoque_status e o ON DELETE do FK
--     produto_variacao_id (o desenho espera SET NULL).
select conrelid::regclass as tabela, conname, contype, pg_get_constraintdef(oid) as definicao
  from pg_constraint
 where conrelid in ('public.pedidos'::regclass, 'public.pedido_itens'::regclass,
                    'public.produto_variacoes'::regclass, 'public.configuracoes'::regclass)
 order by 1, 3, 2;

-- A3. Índices existentes.
select tablename, indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename in ('pedidos', 'pedido_itens', 'produto_variacoes')
 order by 1, 2;

-- A4. Permissões atuais nas tabelas (quem pode o quê).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('pedidos', 'pedido_itens', 'produto_variacoes', 'produto_cores',
                      'configuracoes', 'carrinho_itens', 'enderecos')
   and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
 group by table_name, grantee
 order by table_name, grantee;

-- A5. Políticas RLS atuais (quais permitem INSERT/UPDATE/DELETE a clientes?).
select tablename, policyname, cmd, roles, qual as using_expr, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('pedidos', 'pedido_itens', 'produto_variacoes', 'produto_cores', 'configuracoes')
 order by tablename, policyname;

select c.relname, c.relrowsecurity as rls_ligado, c.relforcerowsecurity as rls_forcado
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('pedidos', 'pedido_itens', 'produto_variacoes');

-- A6. Triggers já existentes nessas tabelas.
select event_object_table as tabela, trigger_name, event_manipulation as evento,
       action_timing as quando, action_statement
  from information_schema.triggers
 where trigger_schema = 'public'
   and event_object_table in ('pedidos', 'pedido_itens', 'produto_variacoes', 'produto_cores')
 order by 1, 2;

-- A7. Funções do schema public: dono, SECURITY DEFINER?, search_path e quem pode executar.
select p.oid::regprocedure as funcao,
       pg_get_userbyid(p.proowner) as dono,
       p.prosecdef as security_definer,
       p.proconfig as config,
       coalesce((select string_agg(distinct case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'), '(só dono)') as pode_executar
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by 1;

-- A8. Algum objeto que a migração cria já existe?
select 'função' as tipo, p.proname as nome
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('criar_pedido_com_reserva', 'registrar_pagamento_aprovado', 'liberar_reserva_pedido',
                     'listar_reservas_vencidas', 'registrar_evento_mercado_pago',
                     'admin_atualizar_status_entrega', 'ugc_config_numero',
                     'pedidos_definir_numero', 'pedidos_proteger_campos',
                     'pedido_itens_validar_alteracao', 'produto_variacoes_proteger_reservas')
union all
select 'tabela/sequence', c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('mercado_pago_eventos', 'mercado_pago_pagamentos', 'pedidos_numero_seq');

-- A9. Dados: pedidos, itens, reservas e configurações relevantes.
select (select count(*) from public.pedidos)       as pedidos,
       (select count(*) from public.pedido_itens)  as itens,
       (select count(*) from public.pedido_itens where estoque_status = 'reservado') as itens_reservados;
select chave, valor from public.configuracoes
 where chave in ('checkout_ativo', 'frete_gratis_acima', 'pix_desconto', 'frete_padrao', 'frete_expresso');

-- A10. Estoque por variação (fonte de verdade) e anomalias.
select count(*) as variacoes, sum(estoque) as unidades, count(*) filter (where estoque < 0) as negativas
  from public.produto_variacoes;

-- A11. pg_cron / pg_net instaladas? (para agendar a expiração depois)
select extname, extversion from pg_extension where extname in ('pg_cron', 'pg_net');

-- A12. O usuário existe em auth.users e há FK de pedidos.usuario_id? (ver A2: procure "auth.users")


-- #####################################################################################
-- PARTE B — PÓS-MIGRAÇÃO (somente leitura)
-- #####################################################################################

-- B1. Funções críticas: SECURITY DEFINER e search_path vazio. ESPERADO: proconfig = {search_path=""}
--     nas 11 linhas abaixo; security_definer = true onde a migração definiu.
select p.oid::regprocedure as funcao, p.prosecdef as security_definer, p.proconfig as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('criar_pedido_com_reserva', 'registrar_pagamento_aprovado', 'liberar_reserva_pedido',
                     'listar_reservas_vencidas', 'registrar_evento_mercado_pago',
                     'admin_atualizar_status_entrega', 'ugc_config_numero',
                     'pedidos_definir_numero', 'pedidos_definir_atualizado_em', 'pedidos_proteger_campos',
                     'pedido_itens_validar_alteracao', 'produto_variacoes_proteger_reservas')
 order by 1;

-- B2. Quem pode EXECUTAR cada função. ESPERADO:
--     criar_pedido_com_reserva, registrar_pagamento_aprovado, liberar_reserva_pedido,
--     listar_reservas_vencidas, registrar_evento_mercado_pago → somente service_role (e dono);
--     admin_atualizar_status_entrega → somente authenticated (e dono);
--     funções de trigger e ugc_config_numero → somente dono.
--     Nenhuma linha pode conter PUBLIC ou anon.
select p.oid::regprocedure as funcao,
       coalesce((select string_agg(distinct case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end, ', ')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'), '(só dono)') as pode_executar
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'pedido%' or p.proname like 'produto_variacoes_proteger%'
        or p.proname in ('criar_pedido_com_reserva', 'registrar_pagamento_aprovado', 'liberar_reserva_pedido',
                         'listar_reservas_vencidas', 'registrar_evento_mercado_pago',
                         'admin_atualizar_status_entrega', 'ugc_config_numero'))
 order by 1;

-- B3. Privilégios de TABELA efetivos. ESPERADO (só estas linhas devem aparecer):
--     pedidos / pedido_itens: authenticated = SELECT; service_role = SELECT.
--     mercado_pago_eventos: service_role = SELECT, UPDATE.
--     mercado_pago_pagamentos: authenticated = SELECT; service_role = SELECT.
--     anon: nenhuma linha. Nenhum DELETE/TRUNCATE em lugar nenhum dessas tabelas.
select r.papel, t.tabela, p.priv
  from (values ('anon'), ('authenticated'), ('service_role')) r(papel)
 cross join (values ('public.pedidos'), ('public.pedido_itens'),
                    ('public.mercado_pago_eventos'), ('public.mercado_pago_pagamentos')) t(tabela)
 cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                    ('REFERENCES'), ('TRIGGER')) p(priv)
 where has_table_privilege(r.papel, t.tabela, p.priv)
 order by t.tabela, r.papel, p.priv;

-- B3b. UPDATE por coluna. ESPERADO: service_role só em mercado_pago_preference_id.
select a.attname as coluna, has_column_privilege('service_role', 'public.pedidos', a.attname, 'UPDATE') as service_role_update,
       has_column_privilege('authenticated', 'public.pedidos', a.attname, 'UPDATE') as authenticated_update
  from pg_attribute a
 where a.attrelid = 'public.pedidos'::regclass and a.attnum > 0 and not a.attisdropped
   and (has_column_privilege('service_role', 'public.pedidos', a.attname, 'UPDATE')
     or has_column_privilege('authenticated', 'public.pedidos', a.attname, 'UPDATE'));

-- B3c. A sequence do número do pedido não é acessível ao navegador. ESPERADO: nenhuma linha.
select r.papel, has_sequence_privilege(r.papel, 'public.pedidos_numero_seq', 'USAGE') as usage
  from (values ('anon'), ('authenticated'), ('service_role')) r(papel)
 where has_sequence_privilege(r.papel, 'public.pedidos_numero_seq', 'USAGE');

-- B4. RLS ligado e políticas. ESPERADO: rls_ligado = true em eventos e pagamentos;
--     eventos sem nenhuma política; pagamentos só com a política de admin (SELECT).
select c.relname, c.relrowsecurity as rls_ligado
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('pedidos', 'pedido_itens', 'mercado_pago_eventos', 'mercado_pago_pagamentos', 'produto_variacoes');
select tablename, policyname, cmd, roles, qual
  from pg_policies
 where schemaname = 'public'
   and tablename in ('pedidos', 'pedido_itens', 'mercado_pago_eventos', 'mercado_pago_pagamentos')
 order by 1, 2;
-- Políticas antigas que permitam INSERT/UPDATE/DELETE a clientes ficam INERTES (falta GRANT),
-- mas devem ser listadas aqui para você decidir remover depois.

-- B5. Índices e constraints novos/mantidos. ESPERADO: únicos em numero_pedido, chave_idempotencia,
--     mercado_pago_payment_id, mercado_pago_preference_id; payment_id e chave_dedup únicos nas tabelas novas.
select conrelid::regclass as tabela, conname, pg_get_constraintdef(oid) as definicao
  from pg_constraint
 where conrelid in ('public.pedidos'::regclass, 'public.pedido_itens'::regclass,
                    'public.mercado_pago_eventos'::regclass, 'public.mercado_pago_pagamentos'::regclass)
   and contype in ('u', 'c', 'f')
 order by 1, 2;
select tablename, indexname from pg_indexes
 where schemaname = 'public'
   and tablename in ('pedidos', 'pedido_itens', 'mercado_pago_eventos', 'mercado_pago_pagamentos')
 order by 1, 2;

-- B6. Triggers. ESPERADO: pedidos_numero (INSERT), pedidos_atualizado_em e pedidos_proteger_campos (UPDATE),
--     pedido_itens_validar_alteracao (UPDATE), produto_variacoes_proteger_delete (DELETE) e
--     produto_variacoes_proteger_estoque (UPDATE).
select event_object_table as tabela, trigger_name, event_manipulation as evento, action_timing as quando
  from information_schema.triggers
 where trigger_schema = 'public'
   and (trigger_name like 'pedido%' or trigger_name like 'produto_variacoes_proteger%')
 order by 1, 2;

-- B7. CHECKOUT CONTINUA DESATIVADO. ESPERADO: valor = 'false'.
select chave, valor from public.configuracoes
 where chave in ('checkout_ativo', 'frete_padrao', 'frete_expresso', 'frete_gratis_acima', 'pix_desconto');

-- B8. INVARIANTES DE ESTOQUE (devem retornar ZERO linhas, sempre).
--     (a) item reservado cujo pedido não está aguardando pagamento nem em análise
select i.id, i.pedido_id, p.status from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
 where i.estoque_status = 'reservado' and p.status not in ('aguardando_pagamento', 'em_analise');
--     (b) pedido aguardando pagamento sem nenhum item reservado
select p.id, p.numero_pedido from public.pedidos p
 where p.status = 'aguardando_pagamento'
   and not exists (select 1 from public.pedido_itens i where i.pedido_id = p.id and i.estoque_status = 'reservado');
--     (c) reserva sem variação
select id from public.pedido_itens where estoque_status = 'reservado' and produto_variacao_id is null;
--     (d) pedido pago com item que não está consumido
select p.id, p.numero_pedido from public.pedidos p
 where p.status = 'pago'
   and exists (select 1 from public.pedido_itens i where i.pedido_id = p.id and i.estoque_status <> 'consumido');
--     (e) estoque negativo
select id, estoque from public.produto_variacoes where estoque < 0;

-- B9. Visão de reservas por variação (para conferir com o painel).
select pv.id as variacao_id, pv.estoque as disponivel,
       coalesce(sum(i.quantidade) filter (where i.estoque_status = 'reservado'), 0) as reservado,
       coalesce(sum(i.quantidade) filter (where i.estoque_status = 'consumido'), 0) as vendido
  from public.produto_variacoes pv
  left join public.pedido_itens i on i.produto_variacao_id = pv.id
 group by pv.id, pv.estoque
having coalesce(sum(i.quantidade) filter (where i.estoque_status = 'reservado'), 0) > 0
 order by 1;

-- B10. Pagamentos que exigem reembolso/análise manual (operação diária).
select recebido_em, payment_id, pedido_id, valor, resultado
  from public.mercado_pago_pagamentos
 where requer_reembolso_manual
 order by recebido_em;

-- B11. Numeração: estado da sequence. Depois de testes com ROLLBACK a sequence pode ter
--      avançado (sequence não é desfeita por rollback). Ver "ajuste da sequence" na PARTE C.
select last_value, is_called from public.pedidos_numero_seq;


-- #####################################################################################
-- PARTE C — TESTE DAS FUNÇÕES, COM DESFAZER AUTOMÁTICO
-- ESCRITO MAS NÃO EXECUTADO. Só rodar com minha autorização, de preferência num projeto
-- de teste/branch do Supabase (não em produção).
--
-- Como funciona: um único bloco que liga o checkout, faz as operações, confere os
-- resultados e TERMINA SEMPRE COM UM ERRO PROPOSITAL ("TESTES_OK_COM_ROLLBACK" se tudo
-- passou; outra mensagem se algo falhou). O erro faz o PostgreSQL desfazer tudo: pedidos,
-- itens, estoque e a mudança de checkout_ativo desaparecem. ÚNICO resíduo: a sequence
-- consome números (um UGC-000001 "perdido"). Para voltar ao zero, SOMENTE se ainda não
-- houver pedido real:   select setval('public.pedidos_numero_seq', 1, false);
--
-- Pré-requisito: existir 1 usuário em auth.users e 1 variação com estoque >= 3 de produto ativo.
-- Ele só cobre as regras de negócio; permissões de cliente/anônimo são conferidas na PARTE B
-- e depois, com chamadas reais pela API (não simuladas aqui).
-- #####################################################################################
do $teste$
declare
  v_user   uuid;
  v_slug   text; v_cor text; v_tam text; v_pv uuid; v_est0 integer;
  v_chave  uuid := gen_random_uuid();
  v_itens  jsonb;
  v_end    jsonb := '{"nome_destinatario":"Teste","cep":"72870-000","rua":"Rua A","numero":"1","bairro":"Centro","cidade":"Valparaiso de Goias","estado":"GO"}'::jsonb;
  v_r1     jsonb; v_r2 jsonb;
  v_msg    text;
  v_est    integer;
  v_n      integer;
  v_res    text;
  v_ped    uuid;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then raise exception 'PRE-REQUISITO: nenhum usuario em auth.users'; end if;

  select p.slug, c.nome, pv.tamanho, pv.id, pv.estoque
    into v_slug, v_cor, v_tam, v_pv, v_est0
    from public.produto_variacoes pv
    join public.produto_cores c on c.id = pv.produto_cor_id
    join public.produtos p on p.id = c.produto_id
   where p.ativo and pv.estoque >= 3
   order by pv.estoque desc limit 1;
  if v_pv is null then raise exception 'PRE-REQUISITO: nenhuma variacao ativa com estoque >= 3'; end if;

  v_itens := jsonb_build_array(jsonb_build_object('produto_id', v_slug, 'cor', v_cor, 'tamanho', v_tam, 'quantidade', 1));

  -- T0: com o checkout DESATIVADO, a função recusa.
  begin perform public.criar_pedido_com_reserva(v_user, v_chave, v_itens, v_end); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'checkout_desativado' then raise exception 'T0 esperado checkout_desativado, veio: %', v_msg; end if;

  update public.configuracoes set valor = 'true' where chave = 'checkout_ativo';   -- desfeito no fim

  -- T1: chave de idempotência nula é recusada.
  begin perform public.criar_pedido_com_reserva(v_user, null, v_itens, v_end); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'chave_idempotencia_invalida' then raise exception 'T1 veio: %', v_msg; end if;

  -- T2: quantidade agregada acima do limite (2 linhas de 6 = 12 > 10) é recusada.
  begin perform public.criar_pedido_com_reserva(v_user, gen_random_uuid(),
          jsonb_build_array(jsonb_build_object('produto_id', v_slug, 'cor', v_cor, 'tamanho', v_tam, 'quantidade', 6),
                            jsonb_build_object('produto_id', v_slug, 'cor', v_cor, 'tamanho', v_tam, 'quantidade', 6)),
          v_end); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'quantidade_invalida' then raise exception 'T2 veio: %', v_msg; end if;

  -- T3: item com texto no lugar do número é recusado com erro controlado (não erro de conversão).
  begin perform public.criar_pedido_com_reserva(v_user, gen_random_uuid(),
          jsonb_build_array(jsonb_build_object('produto_id', v_slug, 'cor', v_cor, 'tamanho', v_tam, 'quantidade', 'abc')),
          v_end); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'itens_invalidos' then raise exception 'T3 veio: %', v_msg; end if;

  -- T4: cria pedido reservando 1 unidade; estoque cai exatamente 1.
  v_r1 := public.criar_pedido_com_reserva(v_user, v_chave, v_itens, v_end);
  v_ped := (v_r1 ->> 'pedido_id')::uuid;
  select estoque into v_est from public.produto_variacoes where id = v_pv;
  if v_est <> v_est0 - 1 then raise exception 'T4 estoque esperado %, veio %', v_est0 - 1, v_est; end if;
  if (v_r1 ->> 'numero_pedido') !~ '^UGC-[0-9]{6,}$' then raise exception 'T4 numero invalido: %', v_r1 ->> 'numero_pedido'; end if;

  -- T5: mesma chave + mesmos itens devolve o MESMO pedido, sem reservar de novo.
  v_r2 := public.criar_pedido_com_reserva(v_user, v_chave, v_itens, v_end);
  if (v_r2 ->> 'pedido_id') <> (v_r1 ->> 'pedido_id') or (v_r2 ->> 'reaproveitado') <> 'true' then
    raise exception 'T5 nao reaproveitou o pedido'; end if;
  select estoque into v_est from public.produto_variacoes where id = v_pv;
  if v_est <> v_est0 - 1 then raise exception 'T5 reservou de novo: %', v_est; end if;

  -- T6: mesma chave com itens DIFERENTES é recusada.
  begin perform public.criar_pedido_com_reserva(v_user, v_chave,
          jsonb_build_array(jsonb_build_object('produto_id', v_slug, 'cor', v_cor, 'tamanho', v_tam, 'quantidade', 2)),
          v_end); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'chave_idempotencia_conflito' then raise exception 'T6 veio: %', v_msg; end if;

  -- T7: com reserva ativa, mexer no estoque da variação é bloqueado (mesmo para o dono) e apagar também.
  begin update public.produto_variacoes set estoque = estoque + 5 where id = v_pv; v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'estoque_com_reserva_ativa' then raise exception 'T7a veio: %', v_msg; end if;
  begin delete from public.produto_variacoes where id = v_pv; v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'variacao_com_reserva_ativa' then raise exception 'T7b veio: %', v_msg; end if;

  -- T8: liberar antes do prazo é recusado ('expirado'); cancelar devolve o estoque UMA vez.
  begin perform public.liberar_reserva_pedido(v_ped, 'expirado'); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'reserva_ainda_valida' then raise exception 'T8a veio: %', v_msg; end if;
  v_n := public.liberar_reserva_pedido(v_ped, 'cancelado');
  select estoque into v_est from public.produto_variacoes where id = v_pv;
  if v_n <> 1 or v_est <> v_est0 then raise exception 'T8b liberou % item(ns), estoque %', v_n, v_est; end if;
  if public.liberar_reserva_pedido(v_ped, 'cancelado') <> 0 then raise exception 'T8c liberou duas vezes'; end if;
  select estoque into v_est from public.produto_variacoes where id = v_pv;
  if v_est <> v_est0 then raise exception 'T8d estoque mudou na 2a chamada: %', v_est; end if;

  -- T9: pagamento aprovado DEPOIS da liberação vai para análise manual e fica registrado.
  v_res := public.registrar_pagamento_aprovado(v_ped, '900000001', (v_r1 ->> 'total')::numeric, 'BRL', true, 'pix');
  if v_res <> 'tardio_em_analise' then raise exception 'T9 veio: %', v_res; end if;
  if public.registrar_pagamento_aprovado(v_ped, '900000001', (v_r1 ->> 'total')::numeric, 'BRL', true, 'pix') <> 'ja_processado' then
    raise exception 'T9b nao foi idempotente'; end if;
  if not exists (select 1 from public.mercado_pago_pagamentos where payment_id = '900000001' and requer_reembolso_manual) then
    raise exception 'T9c pagamento tardio nao ficou registrado'; end if;

  -- T10: fluxo feliz — novo pedido, pagamento aprovado consome a reserva SEM descontar de novo.
  v_r1 := public.criar_pedido_com_reserva(v_user, gen_random_uuid(), v_itens, v_end);
  v_ped := (v_r1 ->> 'pedido_id')::uuid;
  v_res := public.registrar_pagamento_aprovado(v_ped, '900000002', (v_r1 ->> 'total')::numeric, 'BRL', true, 'credit_card');
  select estoque into v_est from public.produto_variacoes where id = v_pv;
  if v_res <> 'consumido' or v_est <> v_est0 - 1 then raise exception 'T10 resultado %, estoque %', v_res, v_est; end if;

  -- T11: segundo pagamento aprovado no mesmo pedido: registrado como duplicado (não se perde).
  v_res := public.registrar_pagamento_aprovado(v_ped, '900000003', (v_r1 ->> 'total')::numeric, 'BRL', true, 'pix');
  if v_res <> 'pagamento_duplicado' or not exists
     (select 1 from public.mercado_pago_pagamentos where payment_id = '900000003' and requer_reembolso_manual) then
    raise exception 'T11 veio: %', v_res; end if;

  -- T12: evento do webhook: repetido (mesmo request-id diferente) é deduplicado; sem assinatura é recusado.
  perform 1 from public.registrar_evento_mercado_pago('payment', 'payment.updated', '900000002', 'n1', 'req-A', true, true, '{}'::jsonb);
  perform 1 from public.registrar_evento_mercado_pago('payment', 'payment.updated', '900000002', 'n1', 'req-B', true, true, '{}'::jsonb);
  if (select count(*) from public.mercado_pago_eventos where recurso_id = '900000002') <> 1
     or (select tentativas from public.mercado_pago_eventos where recurso_id = '900000002') <> 2 then
    raise exception 'T12 deduplicacao falhou'; end if;
  begin perform 1 from public.registrar_evento_mercado_pago('payment', 'payment.updated', '1', 'x', 'r', true, false, '{}'::jsonb); v_msg := 'NAO_FALHOU';
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'assinatura_nao_validada' then raise exception 'T12b veio: %', v_msg; end if;

  raise exception 'TESTES_OK_COM_ROLLBACK: T0–T12 passaram; tudo foi desfeito.';
end
$teste$;
