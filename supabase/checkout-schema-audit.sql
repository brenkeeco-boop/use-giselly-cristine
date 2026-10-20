-- AUDITORIA SOMENTE LEITURA — não altera schema, dados, RLS, permissões ou extensões.
-- Execute integralmente no SQL Editor do Supabase e guarde todos os conjuntos de resultados.

-- 1) Existência e RLS das tabelas usadas pelo checkout, carrinho e Admin.
select c.relname as tabela, c.relrowsecurity as rls_habilitado, c.relforcerowsecurity as rls_forcado,
       coalesce(obj_description(c.oid, 'pg_class'), '') as descricao
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p')
  and c.relname in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by c.relname;

-- 2) Colunas, tipos, nulidade e defaults. Confirme em especial carrinho_itens.produto_id (text/varchar) e produtos.slug.
select table_name, ordinal_position, column_name, data_type, udt_name, character_maximum_length,
       numeric_precision, numeric_scale, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by table_name, ordinal_position;

-- 3) Resumo dos pré-requisitos da migration; não é uma aprovação automática.
select
  to_regclass('public.produtos') is not null as produtos_existe,
  to_regclass('public.carrinhos') is not null as carrinhos_existe,
  to_regclass('public.carrinho_itens') is not null as carrinho_itens_existe,
  to_regclass('public.enderecos') is not null as enderecos_existe,
  to_regclass('public.cupons') is not null as cupons_existe,
  to_regclass('public.configuracoes') is not null as configuracoes_existe,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='carrinho_itens' and column_name='produto_id' and data_type in ('text','character varying')) as carrinho_produto_id_textual,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='produtos' and column_name='slug') as produtos_tem_slug;

-- 4) Chaves primárias, únicas, checks e estrangeiras (inclusive ações ON DELETE/UPDATE).
select con.conrelid::regclass::text as tabela, con.conname as constraint_nome, con.contype as tipo,
       pg_get_constraintdef(con.oid, true) as definicao
from pg_constraint con join pg_namespace n on n.oid = con.connamespace
where n.nspname='public'
  and con.conrelid::regclass::text in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by tabela, tipo, constraint_nome;

-- 5) Índices, inclusive o índice parcial de pedido pendente por carrinho.
select tablename as tabela, indexname as indice, indexdef as definicao
from pg_indexes
where schemaname='public'
  and tablename in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by tabela, indice;

-- 6) Policies RLS efetivas; compare com acesso de cliente e administrador.
select tablename as tabela, policyname as policy, permissive, roles, cmd, qual as using_expressao, with_check
from pg_policies
where schemaname='public'
  and tablename in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by tabela, policy;

-- 7) Permissões de tabelas para papéis relevantes. RLS não substitui estes grants.
select table_name as tabela, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','enderecos','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
  and grantee in ('anon','authenticated','service_role','postgres','PUBLIC')
order by tabela, grantee, privilege_type;

-- 8) Funções usadas pelo checkout: assinatura, corpo, SECURITY DEFINER, configuração e grants.
select n.nspname as schema, p.proname as funcao, pg_get_function_identity_arguments(p.oid) as argumentos,
       pg_get_function_result(p.oid) as retorno, p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '') as configuracao,
       pg_get_functiondef(p.oid) as definicao
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('criar_pedido_checkout','finalizar_pagamento_checkout','expirar_reservas_checkout')
order by p.proname, argumentos;

select p.proname as funcao, pg_get_function_identity_arguments(p.oid) as argumentos,
       coalesce(grantee.rolname, 'PUBLIC') as grantee, privilege_type
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
left join pg_roles grantee on grantee.oid=acl.grantee
where n.nspname='public'
  and p.proname in ('criar_pedido_checkout','finalizar_pagamento_checkout','expirar_reservas_checkout')
order by funcao, argumentos, grantee, privilege_type;

-- 9) Triggers existentes nas tabelas do fluxo. Verifique gatilhos de atualizado_em e efeitos não esperados.
select event_object_table as tabela, trigger_name, event_manipulation as evento, action_timing,
       action_statement, action_condition
from information_schema.triggers
where event_object_schema='public'
  and event_object_table in ('produtos','produto_cores','produto_variacoes','carrinhos','carrinho_itens','pedidos','pedido_itens','pagamentos','pagamento_eventos','cupons','configuracoes','frete_cep_elegiveis')
order by tabela, trigger_name, evento;

-- 10) Extensões necessárias para gen_random_uuid e capacidade de agendamento (somente inventário).
select extname as extensao, extversion as versao, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where extname in ('pgcrypto','pg_cron','pg_net')
order by extname;

-- 11) Observação: a existência de pg_cron aparece acima. Não há consulta a cron.job,
-- pois essa relação não existe em projetos sem a extensão e a auditoria precisa rodar neles.
