-- =====================================================================================
-- Use Giselly Cristine — Etapa 2 · Pagamentos (Mercado Pago Checkout Pro)   [REVISÃO 2]
-- Reserva de estoque, numeração de pedidos, permissões, auditoria de pagamentos/webhooks.
--
-- >>> ESTE ARQUIVO NÃO FOI EXECUTADO EM LUGAR NENHUM (nem validado por um parser de   <<<
-- >>> PostgreSQL). Rode primeiro etapa2_verificacao.sql (parte PRÉ, só leitura).       <<<
-- >>> Só execute depois de autorização explícita.                                      <<<
--
-- Roda em UMA transação: se qualquer passo falhar, nada é aplicado (inclusive permissões).
-- Pode ser reexecutado: não recria colunas/índices que já existem.
-- O checkout continua DESATIVADO (configuracoes.checkout_ativo = 'false').
--
-- DECISÕES QUE O DONO DA LOJA PRECISA CONFIRMAR (constantes no início das funções):
--   • máx. 10 unidades por variação (cor+tamanho) e 30 unidades por pedido;
--   • máx. 3 pedidos aguardando pagamento por cliente;
--   • frete grátis quando subtotal >= frete_gratis_acima (250). "Acima de" = estritamente
--     maior? Se sim, troque ">=" por ">" na função criar_pedido_com_reserva;
--   • frete expresso é sempre cobrado (nunca grátis).
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 0) PRÉ-CHECAGENS — junta TODOS os problemas e aborta uma única vez, com relatório.
--    Nada aqui altera dados.
-- -------------------------------------------------------------------------------------
do $$
declare
  v_erros  text := '';
  v_txt    constant text[] := array['text', 'character varying'];
  v_int    constant text[] := array['integer', 'smallint', 'bigint'];
  v_tmp    text;
  v_req    text[];
  r        record;
begin
  -- 0.1 colunas e tipos que as funções abaixo assumem --------------------------------
  select string_agg(format('%s.%s (esperado %s; encontrado %s)', e.t, e.c,
                           array_to_string(e.tipos, ' ou '), coalesce(col.data_type, 'AUSENTE')),
                    '; ' order by e.t, e.c)
    into v_tmp
    from (values
      ('pedidos', 'id', array['uuid']),
      ('pedidos', 'usuario_id', array['uuid']),
      ('pedidos', 'numero_pedido', v_txt),
      ('pedidos', 'status', v_txt),
      ('pedidos', 'status_entrega', v_txt),
      ('pedidos', 'subtotal', array['numeric']),
      ('pedidos', 'frete', array['numeric']),
      ('pedidos', 'desconto', array['numeric']),
      ('pedidos', 'total', array['numeric']),
      ('pedidos', 'nome_destinatario', v_txt),
      ('pedidos', 'cep', v_txt),
      ('pedidos', 'rua', v_txt),
      ('pedidos', 'numero', v_txt),
      ('pedidos', 'complemento', v_txt),
      ('pedidos', 'bairro', v_txt),
      ('pedidos', 'cidade', v_txt),
      ('pedidos', 'estado', v_txt),
      ('pedidos', 'referencia', v_txt),
      ('pedidos', 'criado_em', array['timestamp with time zone']),
      ('pedidos', 'atualizado_em', array['timestamp with time zone']),
      ('pedidos', 'pagamento_expira_em', array['timestamp with time zone']),
      ('pedidos', 'chave_idempotencia', array['uuid']),
      ('pedidos', 'mercado_pago_preference_id', v_txt),
      ('pedidos', 'mercado_pago_payment_id', v_txt),
      ('pedido_itens', 'pedido_id', array['uuid']),
      ('pedido_itens', 'produto_id', v_txt),
      ('pedido_itens', 'nome_produto', v_txt),
      ('pedido_itens', 'imagem_produto', v_txt),
      ('pedido_itens', 'tamanho', v_txt),
      ('pedido_itens', 'cor', v_txt),
      ('pedido_itens', 'quantidade', v_int),
      ('pedido_itens', 'preco_unitario', array['numeric']),
      ('pedido_itens', 'produto_variacao_id', array['uuid']),
      ('pedido_itens', 'estoque_status', array['*']),
      ('produto_variacoes', 'id', array['uuid']),
      ('produto_variacoes', 'produto_cor_id', array['uuid']),
      ('produto_variacoes', 'tamanho', v_txt),
      ('produto_variacoes', 'estoque', v_int),
      ('produto_cores', 'id', array['uuid']),
      ('produto_cores', 'produto_id', array['uuid']),
      ('produto_cores', 'nome', v_txt),
      ('produto_cores', 'imagens', array['jsonb']),
      ('produtos', 'id', array['uuid']),
      ('produtos', 'slug', v_txt),
      ('produtos', 'nome', v_txt),
      ('produtos', 'ativo', array['boolean']),
      ('produtos', 'preco', array['numeric']),
      ('produtos', 'preco_promocional', array['numeric']),
      ('produtos', 'image_url', v_txt),
      ('produtos', 'imagens', array['jsonb']),
      ('configuracoes', 'chave', v_txt),
      ('configuracoes', 'valor', v_txt)
    ) as e(t, c, tipos)
    left join information_schema.columns col
           on col.table_schema = 'public' and col.table_name = e.t and col.column_name = e.c
   where col.data_type is null
      or not (e.tipos = array['*'] or col.data_type = any (e.tipos));
  if v_tmp is not null then
    v_erros := v_erros || E'\n• Colunas ausentes ou com tipo diferente: ' || v_tmp;
  end if;

  -- 0.2 unicidade que o desenho exige (NÃO é criada aqui: já deve existir) -------------
  select string_agg(t.col, ', ') into v_tmp
    from (values ('numero_pedido'), ('chave_idempotencia'),
                 ('mercado_pago_payment_id'), ('mercado_pago_preference_id')) as t(col)
   where not exists (
     select 1
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = 'public.pedidos'::regclass
        and i.indisunique and i.indisvalid and i.indnatts = 1
        and a.attname = t.col);
  if v_tmp is not null then
    v_erros := v_erros || E'\n• Falta índice/constraint ÚNICO em pedidos para: ' || v_tmp;
  end if;

  -- 0.3 colunas NOT NULL sem default que o INSERT das funções não preenche --------------
  select string_agg(c.table_name || '.' || c.column_name, ', ' order by c.table_name, c.column_name)
    into v_tmp
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.is_nullable = 'NO'
     and c.column_default is null
     and coalesce(c.is_identity, 'NO') = 'NO'
     and coalesce(c.is_generated, 'NEVER') = 'NEVER'
     and (
          (c.table_name = 'pedidos' and c.column_name <> all (array[
             'usuario_id', 'status', 'status_entrega', 'subtotal', 'frete', 'desconto', 'total',
             'nome_destinatario', 'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado',
             'pagamento_expira_em', 'chave_idempotencia', 'numero_pedido']))
       or (c.table_name = 'pedido_itens' and c.column_name <> all (array[
             'pedido_id', 'produto_id', 'nome_produto', 'tamanho', 'cor', 'quantidade',
             'preco_unitario', 'produto_variacao_id', 'estoque_status']))
     );
  if v_tmp is not null then
    v_erros := v_erros || E'\n• Colunas NOT NULL sem valor padrão que as funções não preenchem (o INSERT falharia): ' || v_tmp;
  end if;

  -- 0.4 CHECKs existentes que enumeram valores e não aceitam os que usamos -------------
  for r in
    select c.conrelid::regclass::text as tabela, c.conname, a.attname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'c'
       and ((c.conrelid = 'public.pedidos'::regclass and a.attname in ('status', 'status_entrega'))
         or (c.conrelid = 'public.pedido_itens'::regclass and a.attname = 'estoque_status'))
  loop
    v_req := case r.attname
      when 'status'         then array['aguardando_pagamento', 'pago', 'em_analise', 'expirado', 'cancelado']
      when 'status_entrega' then array['aguardando_pagamento', 'em_preparacao', 'enviado', 'concluido', 'cancelado']
      else                       array['nao_aplicavel', 'reservado', 'consumido', 'liberado']
    end;
    if position('''' in r.def) > 0 then            -- só avalia CHECK que lista valores literais
      select string_agg(l, ', ') into v_tmp
        from unnest(v_req) as l
       where position(quote_literal(l) in r.def) = 0;
      if v_tmp is not null then
        v_erros := v_erros || format(E'\n• CHECK %s em %s não aceita: %s (definição: %s)',
                                     r.conname, r.tabela, v_tmp, r.def);
      end if;
    end if;
  end loop;

  -- 0.5 números de pedido já existentes fora do padrão UGC-000000 --------------------
  if exists (select 1 from public.pedidos
              where numero_pedido is not null and numero_pedido !~ '^UGC-[0-9]{6,}$') then
    v_erros := v_erros || E'\n• Existem pedidos com numero_pedido fora do padrão UGC-000000.';
  end if;

  -- 0.6 tabelas novas que já existam com formato diferente ---------------------------
  if to_regclass('public.mercado_pago_eventos') is not null then
    select string_agg(x.c, ', ') into v_tmp
      from unnest(array['chave_dedup', 'tipo', 'acao', 'recurso_id', 'notificacao_id', 'request_id',
                        'pedido_id', 'live_mode', 'status_processamento', 'tentativas', 'erro',
                        'payload', 'recebido_em', 'processado_em']) as x(c)
     where not exists (select 1 from information_schema.columns k
                        where k.table_schema = 'public' and k.table_name = 'mercado_pago_eventos'
                          and k.column_name = x.c);
    if v_tmp is not null then
      v_erros := v_erros || E'\n• mercado_pago_eventos já existe sem as colunas: ' || v_tmp;
    end if;
  end if;
  if to_regclass('public.mercado_pago_pagamentos') is not null then
    select string_agg(x.c, ', ') into v_tmp
      from unnest(array['payment_id', 'pedido_id', 'status_mp', 'valor', 'moeda', 'metodo', 'live_mode',
                        'resultado', 'requer_reembolso_manual', 'recebido_em']) as x(c)
     where not exists (select 1 from information_schema.columns k
                        where k.table_schema = 'public' and k.table_name = 'mercado_pago_pagamentos'
                          and k.column_name = x.c);
    if v_tmp is not null then
      v_erros := v_erros || E'\n• mercado_pago_pagamentos já existe sem as colunas: ' || v_tmp;
    end if;
  end if;

  if v_erros <> '' then
    raise exception E'Banco diferente do esperado — nada foi alterado.%', v_erros
      using errcode = 'P0001';
  end if;
end $$;


-- -------------------------------------------------------------------------------------
-- 1) NUMERAÇÃO DE PEDIDOS  (UGC-000001, UGC-000002, …)
--    Sequence + trigger. O número é SEMPRE gerado pelo banco no INSERT: qualquer valor
--    enviado por quem insere é ignorado. Pode haver lacunas (pedido que falhou depois de
--    pegar o número; testes com ROLLBACK também consomem número) — isso é esperado.
-- -------------------------------------------------------------------------------------
create sequence if not exists public.pedidos_numero_seq as bigint minvalue 1 start 1;
revoke all on sequence public.pedidos_numero_seq from PUBLIC, anon, authenticated, service_role;

-- Alinha a sequence com números UGC-xxxxxx que já existam (sem efeito se não houver).
do $$
declare
  v_max    bigint;
  v_last   bigint;
  v_called boolean;
  v_atual  bigint;
begin
  select coalesce(max(substring(numero_pedido from '^UGC-([0-9]+)$')::bigint), 0)
    into v_max from public.pedidos;
  select last_value, is_called into v_last, v_called from public.pedidos_numero_seq;
  v_atual := case when v_called then v_last else 0 end;
  if v_max > v_atual then
    perform setval('public.pedidos_numero_seq', v_max, true);
  end if;
end $$;

create or replace function public.pedidos_definir_numero()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  v_n := nextval('public.pedidos_numero_seq');
  new.numero_pedido := 'UGC-' || case when v_n < 1000000 then lpad(v_n::text, 6, '0') else v_n::text end;
  return new;
end;
$$;

drop trigger if exists pedidos_numero on public.pedidos;
create trigger pedidos_numero
  before insert on public.pedidos
  for each row execute function public.pedidos_definir_numero();

-- Preenche pedidos antigos sem número (hoje: nenhum), ANTES de ativar a trava de imutabilidade.
update public.pedidos p
   set numero_pedido = 'UGC-' || lpad(nextval('public.pedidos_numero_seq')::text, 6, '0')
 where p.numero_pedido is null;

alter table public.pedidos alter column numero_pedido set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pedidos_numero_pedido_formato_ck'
                    and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos
      add constraint pedidos_numero_pedido_formato_ck check (numero_pedido ~ '^UGC-[0-9]{6,}$');
  end if;
end $$;

-- atualizado_em automático (padrão do projeto: BEFORE UPDATE).
create or replace function public.pedidos_definir_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists pedidos_atualizado_em on public.pedidos;
create trigger pedidos_atualizado_em
  before update on public.pedidos
  for each row execute function public.pedidos_definir_atualizado_em();

-- Campos que nunca mudam depois que o pedido existe (valores, dono, número, chave).
-- usuario_id pode virar NULL (caso a exclusão de usuário use ON DELETE SET NULL).
create or replace function public.pedidos_proteger_campos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or (old.numero_pedido is not null and new.numero_pedido is distinct from old.numero_pedido)
     or (new.usuario_id is distinct from old.usuario_id and new.usuario_id is not null)
     or new.chave_idempotencia is distinct from old.chave_idempotencia
     or new.subtotal is distinct from old.subtotal
     or new.frete    is distinct from old.frete
     or new.desconto is distinct from old.desconto
     or new.total    is distinct from old.total then
    raise exception 'campo_imutavel_do_pedido' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists pedidos_proteger_campos on public.pedidos;
create trigger pedidos_proteger_campos
  before update on public.pedidos
  for each row execute function public.pedidos_proteger_campos();


-- -------------------------------------------------------------------------------------
-- 2) CONFIGURAÇÕES COMERCIAIS  (só insere o que falta; nunca sobrescreve)
--    Já existem: frete_gratis_acima = 250 e pix_desconto = 0 (não são tocados).
-- -------------------------------------------------------------------------------------
insert into public.configuracoes (chave, valor) values
  ('checkout_ativo', 'false'),
  ('frete_padrao',   '24.90'),
  ('frete_expresso', '34.90')
on conflict (chave) do nothing;

-- Se o checkout já estiver aberto, esta migração NÃO segue sem você decidir.
do $$
begin
  if exists (select 1 from public.configuracoes
              where chave = 'checkout_ativo' and lower(btrim(valor)) = 'true') then
    raise exception 'checkout_ativo = true. Desative antes de migrar (esta etapa exige o checkout fechado).'
      using errcode = 'P0001';
  end if;
end $$;

-- Leitura numérica validada (uso interno das funções abaixo). Rejeita vazio, texto, NaN,
-- infinito, negativo e valores absurdos (> 100000).
create or replace function public.ugc_config_numero(p_chave text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v text;
  n numeric;
begin
  select c.valor into v from public.configuracoes c where c.chave = p_chave;
  if v is null or btrim(v) = '' then
    raise exception 'configuracao_ausente: %', p_chave using errcode = 'P0001';
  end if;
  begin
    n := replace(btrim(v), ',', '.')::numeric;
  exception when others then
    raise exception 'configuracao_invalida: %', p_chave using errcode = 'P0001';
  end;
  if n < 0 or n > 100000 then          -- NaN e Infinity também caem aqui (maiores que tudo)
    raise exception 'configuracao_invalida: %', p_chave using errcode = 'P0001';
  end if;
  return n;
end;
$$;


-- -------------------------------------------------------------------------------------
-- 3) INTEGRIDADE DOS ITENS DO PEDIDO
--    • reserva precisa apontar para uma variação;
--    • estoque_status só muda reservado→consumido ou reservado→liberado. A transição
--      nao_aplicavel→reservado foi REMOVIDA: ela criaria "reserva" sem baixa de estoque,
--      e a liberação depois DEVOLVERIA unidades que nunca saíram (estoque inflado);
--    • pedido, quantidade e preço do item nunca mudam; a variação só pode virar NULL
--      (ON DELETE SET NULL, em itens já encerrados).
-- -------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'pedido_itens_reserva_tem_variacao_ck'
                    and conrelid = 'public.pedido_itens'::regclass) then
    alter table public.pedido_itens
      add constraint pedido_itens_reserva_tem_variacao_ck
      check (estoque_status <> 'reservado' or produto_variacao_id is not null);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'pedido_itens_quantidade_positiva_ck'
                    and conrelid = 'public.pedido_itens'::regclass) then
    alter table public.pedido_itens
      add constraint pedido_itens_quantidade_positiva_ck check (quantidade > 0);
  end if;
end $$;

create or replace function public.pedido_itens_validar_alteracao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estoque_status is distinct from old.estoque_status then
    if not (old.estoque_status = 'reservado' and new.estoque_status in ('consumido', 'liberado')) then
      raise exception 'transicao_estoque_invalida: % -> %', old.estoque_status, new.estoque_status
        using errcode = 'P0001';
    end if;
  end if;

  if new.quantidade     is distinct from old.quantidade
     or new.pedido_id   is distinct from old.pedido_id
     or new.preco_unitario is distinct from old.preco_unitario
     or (new.produto_variacao_id is distinct from old.produto_variacao_id
         and new.produto_variacao_id is not null) then
    raise exception 'item_do_pedido_imutavel' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists pedido_itens_validar_alteracao on public.pedido_itens;
create trigger pedido_itens_validar_alteracao
  before update on public.pedido_itens
  for each row execute function public.pedido_itens_validar_alteracao();

create index if not exists idx_pedido_itens_reservado_variacao
  on public.pedido_itens (produto_variacao_id) where estoque_status = 'reservado';
create index if not exists idx_pedidos_reservas_vencidas
  on public.pedidos (pagamento_expira_em) where status = 'aguardando_pagamento';


-- -------------------------------------------------------------------------------------
-- 4) PROTEÇÃO DAS VARIAÇÕES CONTRA O PAINEL ADMIN (e contra qualquer escrita avulsa)
--    • apagar variação (ou a cor/produto que a contém, por cascata) com reserva ativa
--      → bloqueado;
--    • ALTERAR estoque de variação que tenha unidades reservadas → bloqueado, para qualquer
--      papel, EXCETO dentro das funções de reserva/liberação abaixo, que sinalizam a
--      transação com a variável local 'ugc.estoque_interno' (vale só até o fim da transação).
--      Não depende do nome do papel (current_setting('role')), que era frágil.
--    LIMITE CONHECIDO: formulário do admin aberto ANTES de uma venda concluída e salvo
--    DEPOIS ainda grava o número antigo quando não há reserva ativa (não há versão para
--    comparar). Correção definitiva = ajuste em admin-variacoes.js (pendência da etapa
--    do painel).
-- -------------------------------------------------------------------------------------
create or replace function public.produto_variacoes_proteger_reservas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservado bigint;
begin
  if tg_op = 'DELETE' then
    select coalesce(sum(i.quantidade), 0) into v_reservado
      from public.pedido_itens i
     where i.produto_variacao_id = old.id and i.estoque_status = 'reservado';
    if v_reservado > 0 then
      raise exception 'variacao_com_reserva_ativa'
        using detail = format('%s unidade(s) reservada(s) em pedidos aguardando pagamento.', v_reservado),
              hint = 'Aguarde o pagamento ou a expiração (15 min) e tente de novo.',
              errcode = 'P0001';
    end if;
    return old;
  end if;

  if new.estoque is distinct from old.estoque
     and coalesce(current_setting('ugc.estoque_interno', true), '') <> 'on' then
    select coalesce(sum(i.quantidade), 0) into v_reservado
      from public.pedido_itens i
     where i.produto_variacao_id = old.id and i.estoque_status = 'reservado';
    if v_reservado > 0 then
      raise exception 'estoque_com_reserva_ativa'
        using detail = format('%s unidade(s) reservada(s) em pedidos aguardando pagamento.', v_reservado),
              hint = 'Aguarde o pagamento ou a expiração (15 min) e tente de novo.',
              errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists produto_variacoes_proteger_delete on public.produto_variacoes;
create trigger produto_variacoes_proteger_delete
  before delete on public.produto_variacoes
  for each row execute function public.produto_variacoes_proteger_reservas();

drop trigger if exists produto_variacoes_proteger_estoque on public.produto_variacoes;
create trigger produto_variacoes_proteger_estoque
  before update of estoque on public.produto_variacoes
  for each row execute function public.produto_variacoes_proteger_reservas();


-- -------------------------------------------------------------------------------------
-- 5) AUDITORIA: PAGAMENTOS E EVENTOS DO MERCADO PAGO
--    Criadas ANTES das funções (elas usam estas tabelas).
-- -------------------------------------------------------------------------------------

-- 5.1 Um registro por PAGAMENTO aprovado, mesmo quando o pedido já estava pago/expirado.
--     É daqui que se enxerga o que precisa de reembolso manual. Nunca guarda o objeto
--     completo do pagamento (tem dados pessoais): só os campos abaixo.
create table if not exists public.mercado_pago_pagamentos (
  id                       uuid primary key default gen_random_uuid(),
  payment_id               text not null,
  pedido_id                uuid not null references public.pedidos (id) on delete restrict,
  status_mp                text not null default 'approved',
  valor                    numeric(12,2),
  moeda                    text,
  metodo                   text,
  live_mode                boolean,
  resultado                text not null,
  requer_reembolso_manual  boolean not null default false,
  recebido_em              timestamptz not null default now(),
  constraint mercado_pago_pagamentos_payment_id_key unique (payment_id),
  constraint mercado_pago_pagamentos_resultado_ck check (resultado in (
    'consumido', 'pagamento_duplicado', 'valor_divergente',
    'reserva_inconsistente', 'tardio_em_analise', 'estado_invalido'))
);
create index if not exists idx_mp_pagamentos_pedido on public.mercado_pago_pagamentos (pedido_id);
create index if not exists idx_mp_pagamentos_reembolso
  on public.mercado_pago_pagamentos (recebido_em) where requer_reembolso_manual;

-- 5.2 Eventos do webhook (auditoria + deduplicação). A chave de deduplicação é montada
--     PELO BANCO a partir de campos estáveis da notificação:
--         tipo | ação | data.id | id da notificação (corpo)
--     O cabeçalho x-request-id NÃO entra na chave: ele muda a cada requisição (mesmo em
--     reenvios do mesmo evento) e só serve para a assinatura. Mesmo assim, a CORREÇÃO do
--     sistema não depende desta deduplicação: o efeito de negócio é idempotente por
--     payment_id (registrar_pagamento_aprovado). Aqui é rastreabilidade e economia.
create table if not exists public.mercado_pago_eventos (
  id                    uuid primary key default gen_random_uuid(),
  chave_dedup           text not null,
  tipo                  text not null,
  acao                  text,
  recurso_id            text not null,
  notificacao_id        text,
  request_id            text,
  pedido_id             uuid references public.pedidos (id) on delete set null,
  live_mode             boolean,
  status_processamento  text not null default 'recebido',
  tentativas            integer not null default 1,
  erro                  text,
  payload               jsonb,
  recebido_em           timestamptz not null default now(),
  processado_em         timestamptz,
  constraint mercado_pago_eventos_chave_dedup_key unique (chave_dedup),
  constraint mercado_pago_eventos_status_ck
    check (status_processamento in ('recebido', 'processado', 'ignorado', 'erro')),
  constraint mercado_pago_eventos_payload_ck
    check (payload is null or octet_length(payload::text) <= 20000)
);
create index if not exists idx_mp_eventos_recurso on public.mercado_pago_eventos (recurso_id);
create index if not exists idx_mp_eventos_pedido  on public.mercado_pago_eventos (pedido_id);

alter table public.mercado_pago_eventos    enable row level security;   -- sem políticas: só service_role
alter table public.mercado_pago_pagamentos enable row level security;

-- O painel admin LÊ os pagamentos (para o reembolso manual); ninguém do navegador escreve.
drop policy if exists "admin le pagamentos mercado pago" on public.mercado_pago_pagamentos;
create policy "admin le pagamentos mercado pago"
  on public.mercado_pago_pagamentos
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


-- -------------------------------------------------------------------------------------
-- 6) FUNÇÕES DE PEDIDO, ESTOQUE E WEBHOOK  (somente service_role = Edge Functions)
--    Ordem de travas, sempre a mesma, para não gerar deadlock:
--      chave de idempotência → usuário → pedido → variações em ordem de id.
-- -------------------------------------------------------------------------------------

-- 6.1  Cria o pedido + itens e RESERVA o estoque, tudo em uma transação.
--      Preço, frete e total são calculados aqui; nada do navegador é confiável.
--      p_itens: [{"produto_id":"<slug>","cor":"Preto","tamanho":"M","quantidade":2}, …]
--      p_endereco: {nome_destinatario,cep,rua,numero,complemento,bairro,cidade,estado,referencia}
--      Erros (mensagem exata): checkout_desativado, usuario_obrigatorio, usuario_invalido,
--        chave_idempotencia_invalida, itens_invalidos, quantidade_invalida, endereco_invalido,
--        frete_tipo_invalido, minutos_reserva_invalido, chave_idempotencia_em_uso,
--        chave_idempotencia_conflito, muitos_pedidos_abertos, item_indisponivel, preco_invalido,
--        estoque_insuficiente, total_invalido, reserva_inconsistente, configuracao_*.
--      Quando 'reaproveitado' = true o pedido já existia: a Edge Function NÃO deve criar nova
--      preferência se mercado_pago_preference_id vier preenchido, e NÃO deve seguir se o
--      status não for 'aguardando_pagamento'.
create or replace function public.criar_pedido_com_reserva(
  p_usuario_id          uuid,
  p_chave_idempotencia  uuid,
  p_itens               jsonb,
  p_endereco            jsonb,
  p_frete_tipo          text    default 'padrao',
  p_minutos_reserva     integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_abertos       constant integer := 3;    -- DECISÃO: pedidos aguardando pagamento por cliente
  c_max_linhas        constant integer := 50;   -- linhas enviadas
  c_max_qtd_variacao  constant integer := 10;   -- DECISÃO: unidades da MESMA variação (após somar)
  c_max_unidades      constant integer := 30;   -- DECISÃO: unidades no pedido inteiro

  v_pedido        public.pedidos%rowtype;
  v_entrada       jsonb;
  v_plano         jsonb;
  v_n_entrada     integer;
  v_unidades      integer;
  v_maior         integer;
  v_n_resolvidas  integer;
  v_n_sem_estoque integer;
  v_n_sem_preco   integer;
  v_subtotal      numeric(12,2);
  v_frete         numeric(12,2);
  v_total         numeric(12,2);
  v_limite_gratis numeric;
  v_expira        timestamptz;
  v_pedido_id     uuid;
  v_numero        text;
  v_abertos       integer;
  v_detalhe       text;
  v_linhas        integer;
  v_nome  text; v_cep text; v_rua text; v_num text; v_compl text;
  v_bairro text; v_cidade text; v_uf text; v_ref text;
begin
  -- Interruptor geral ----------------------------------------------------------------
  if lower(btrim(coalesce((select c.valor from public.configuracoes c where c.chave = 'checkout_ativo'), 'false'))) <> 'true' then
    raise exception 'checkout_desativado' using errcode = 'P0001';
  end if;

  -- Usuário e chave de idempotência (OBRIGATÓRIOS) ---------------------------------------
  if p_usuario_id is null then
    raise exception 'usuario_obrigatorio' using errcode = 'P0001';
  end if;
  if p_chave_idempotencia is null or p_chave_idempotencia = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'chave_idempotencia_invalida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_usuario_id) then
    raise exception 'usuario_invalido' using errcode = 'P0001';
  end if;

  if coalesce(p_frete_tipo, '') not in ('padrao', 'expresso') then
    raise exception 'frete_tipo_invalido' using errcode = 'P0001';
  end if;
  if p_minutos_reserva is null or p_minutos_reserva < 1 or p_minutos_reserva > 30 then
    raise exception 'minutos_reserva_invalido' using errcode = 'P0001';
  end if;

  -- Itens: formato (antes de qualquer conversão), depois valores ---------------------------
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) < 1 or jsonb_array_length(p_itens) > c_max_linhas then
    raise exception 'itens_invalidos' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_itens) as e(v)
     where jsonb_typeof(e.v) is distinct from 'object'
        or jsonb_typeof(e.v -> 'produto_id') is distinct from 'string'
        or jsonb_typeof(e.v -> 'cor')        is distinct from 'string'
        or jsonb_typeof(e.v -> 'tamanho')    is distinct from 'string'
        or jsonb_typeof(e.v -> 'quantidade') is distinct from 'number'
  ) then
    raise exception 'itens_invalidos' using errcode = 'P0001';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(p_itens) as x(produto_id text, cor text, tamanho text, quantidade numeric)
     where btrim(x.produto_id) = '' or char_length(x.produto_id) > 120
        or btrim(x.cor) = ''        or char_length(x.cor) > 60
        or upper(btrim(x.tamanho)) not in ('P', 'M', 'G')
        or x.quantidade <> trunc(x.quantidade)
        or x.quantidade < 1 or x.quantidade > c_max_qtd_variacao
  ) then
    raise exception 'itens_invalidos' using errcode = 'P0001';
  end if;

  -- Soma linhas repetidas da mesma variação e valida a quantidade AGREGADA ----------------
  select jsonb_agg(jsonb_build_object('slug', s.slug, 'cor', s.cor, 'tamanho', s.tamanho, 'quantidade', s.qtd)),
         count(*),
         coalesce(sum(s.qtd), 0),
         coalesce(max(s.qtd), 0)
    into v_entrada, v_n_entrada, v_unidades, v_maior
    from (
      select btrim(x.produto_id)       as slug,
             lower(btrim(x.cor))       as cor,
             upper(btrim(x.tamanho))   as tamanho,
             sum(x.quantidade)::integer as qtd
        from jsonb_to_recordset(p_itens) as x(produto_id text, cor text, tamanho text, quantidade numeric)
       group by 1, 2, 3
    ) s;
  if v_maior > c_max_qtd_variacao or v_unidades > c_max_unidades then
    raise exception 'quantidade_invalida' using errcode = 'P0001';
  end if;

  -- Endereço ------------------------------------------------------------------------------
  if p_endereco is null or jsonb_typeof(p_endereco) <> 'object' then
    raise exception 'endereco_invalido' using errcode = 'P0001';
  end if;
  v_nome   := btrim(coalesce(p_endereco->>'nome_destinatario', ''));
  v_cep    := regexp_replace(coalesce(p_endereco->>'cep', ''), '\D', '', 'g');
  v_rua    := btrim(coalesce(p_endereco->>'rua', ''));
  v_num    := btrim(coalesce(p_endereco->>'numero', ''));
  v_compl  := nullif(btrim(coalesce(p_endereco->>'complemento', '')), '');
  v_bairro := btrim(coalesce(p_endereco->>'bairro', ''));
  v_cidade := btrim(coalesce(p_endereco->>'cidade', ''));
  v_uf     := upper(btrim(coalesce(p_endereco->>'estado', '')));
  v_ref    := nullif(btrim(coalesce(p_endereco->>'referencia', '')), '');
  if v_nome = '' or char_length(v_nome) > 120
     or length(v_cep) <> 8
     or v_rua = '' or char_length(v_rua) > 200
     or v_num = '' or char_length(v_num) > 20
     or char_length(coalesce(v_compl, '')) > 100
     or v_bairro = '' or char_length(v_bairro) > 100
     or v_cidade = '' or char_length(v_cidade) > 100
     or v_uf !~ '^[A-Z]{2}$'
     or char_length(coalesce(v_ref, '')) > 200 then
    raise exception 'endereco_invalido' using errcode = 'P0001';
  end if;

  -- Idempotência: mesma chave devolve o MESMO pedido, sem reservar de novo ------------------
  perform pg_advisory_xact_lock(hashtextextended('ugc_pedido:' || p_chave_idempotencia::text, 0));
  select * into v_pedido from public.pedidos where chave_idempotencia = p_chave_idempotencia;
  if found then
    if v_pedido.usuario_id is distinct from p_usuario_id then
      raise exception 'chave_idempotencia_em_uso' using errcode = 'P0001';
    end if;
    -- mesma chave com itens DIFERENTES = erro do cliente, não reaproveitamento
    if exists (
         (select i.produto_id::text, lower(btrim(i.cor))::text, i.tamanho::text, sum(i.quantidade)::integer
            from public.pedido_itens i where i.pedido_id = v_pedido.id group by 1, 2, 3)
         except
         (select a.slug, a.cor, a.tamanho, a.quantidade
            from jsonb_to_recordset(v_entrada) as a(slug text, cor text, tamanho text, quantidade integer))
       ) or exists (
         (select a.slug, a.cor, a.tamanho, a.quantidade
            from jsonb_to_recordset(v_entrada) as a(slug text, cor text, tamanho text, quantidade integer))
         except
         (select i.produto_id::text, lower(btrim(i.cor))::text, i.tamanho::text, sum(i.quantidade)::integer
            from public.pedido_itens i where i.pedido_id = v_pedido.id group by 1, 2, 3)
       ) then
      raise exception 'chave_idempotencia_conflito' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'pedido_id', v_pedido.id, 'numero_pedido', v_pedido.numero_pedido,
      'status', v_pedido.status,
      'subtotal', v_pedido.subtotal, 'frete', v_pedido.frete, 'desconto', v_pedido.desconto,
      'total', v_pedido.total, 'pagamento_expira_em', v_pedido.pagamento_expira_em,
      'mercado_pago_preference_id', v_pedido.mercado_pago_preference_id,
      'reaproveitado', true);
  end if;

  -- Limite de pedidos abertos por cliente (evita segurar estoque em massa) -------------------
  perform pg_advisory_xact_lock(hashtextextended('ugc_usuario:' || p_usuario_id::text, 0));
  select count(*) into v_abertos
    from public.pedidos p
   where p.usuario_id = p_usuario_id and p.status = 'aguardando_pagamento';
  if v_abertos >= c_max_abertos then
    raise exception 'muitos_pedidos_abertos' using errcode = 'P0001';
  end if;

  -- Trava as variações envolvidas, SEMPRE em ordem de id ------------------------------------
  perform 1
     from public.produto_variacoes pv
    where pv.id in (
      select pv2.id
        from jsonb_to_recordset(v_entrada) as a(slug text, cor text, tamanho text, quantidade integer)
        join public.produtos p on p.slug = a.slug and p.ativo
        join public.produto_cores c on c.produto_id = p.id and lower(btrim(c.nome)) = a.cor
        join public.produto_variacoes pv2 on pv2.produto_cor_id = c.id and pv2.tamanho = a.tamanho
    )
    order by pv.id
      for update;

  -- Plano: produto → cor → variação validados JUNTOS (relação, não só IDs soltos) --------------
  with linhas as (
    select pv.id as variacao_id,
           p.slug,
           p.nome as nome_produto,
           c.nome as cor_nome,
           pv.tamanho,
           a.quantidade,
           pv.estoque,
           case when p.preco_promocional is not null
                 and p.preco_promocional > 0
                 and p.preco_promocional < p.preco
                then p.preco_promocional else p.preco end as preco_unit,
           coalesce(nullif(btrim(c.imagens->>0), ''), nullif(btrim(p.image_url), ''),
                    nullif(btrim(p.imagens->>0), '')) as imagem
      from jsonb_to_recordset(v_entrada) as a(slug text, cor text, tamanho text, quantidade integer)
      join public.produtos p on p.slug = a.slug and p.ativo
      join public.produto_cores c on c.produto_id = p.id and lower(btrim(c.nome)) = a.cor
      join public.produto_variacoes pv on pv.produto_cor_id = c.id and pv.tamanho = a.tamanho
  )
  select count(*),
         coalesce(sum(round(l.preco_unit, 2) * l.quantidade), 0),
         count(*) filter (where l.estoque < l.quantidade),
         count(*) filter (where l.preco_unit is null or round(l.preco_unit, 2) <= 0),
         jsonb_agg(to_jsonb(l) order by l.variacao_id)
    into v_n_resolvidas, v_subtotal, v_n_sem_estoque, v_n_sem_preco, v_plano
    from linhas l;

  if v_n_resolvidas is distinct from v_n_entrada then
    raise exception 'item_indisponivel' using errcode = 'P0001';
  end if;
  if v_n_sem_preco > 0 then
    raise exception 'preco_invalido' using errcode = 'P0001';
  end if;
  if v_n_sem_estoque > 0 then
    select string_agg(format('%s %s/%s (disponível %s, pedido %s)',
                             l.nome_produto, l.cor_nome, l.tamanho, l.estoque, l.quantidade), '; ')
      into v_detalhe
      from jsonb_to_recordset(v_plano)
           as l(nome_produto text, cor_nome text, tamanho text, estoque integer, quantidade integer)
     where l.estoque < l.quantidade;
    raise exception 'estoque_insuficiente' using detail = v_detalhe, errcode = 'P0001';
  end if;

  -- Frete e total (calculados no banco) ---------------------------------------------------------
  --   padrão: grátis a partir de frete_gratis_acima (DECISÃO: ">=" ou ">"); expresso: sempre cobrado.
  --   Desconto = 0 (a forma de pagamento só é escolhida dentro do Checkout Pro; pix_desconto = 0).
  v_limite_gratis := public.ugc_config_numero('frete_gratis_acima');
  if p_frete_tipo = 'expresso' then
    v_frete := public.ugc_config_numero('frete_expresso');
  elsif v_subtotal >= v_limite_gratis then
    v_frete := 0;
  else
    v_frete := public.ugc_config_numero('frete_padrao');
  end if;
  v_total := v_subtotal + v_frete;
  if v_subtotal <= 0 or v_total <= 0 then
    raise exception 'total_invalido' using errcode = 'P0001';
  end if;

  -- Pedido, itens e baixa do estoque -------------------------------------------------------------
  v_expira := now() + make_interval(mins => p_minutos_reserva);

  insert into public.pedidos (
    usuario_id, status, status_entrega, subtotal, frete, desconto, total,
    nome_destinatario, cep, rua, numero, complemento, bairro, cidade, estado, referencia,
    pagamento_expira_em, chave_idempotencia)
  values (
    p_usuario_id, 'aguardando_pagamento', 'aguardando_pagamento', v_subtotal, v_frete, 0, v_total,
    v_nome, v_cep, v_rua, v_num, v_compl, v_bairro, v_cidade, v_uf, v_ref,
    v_expira, p_chave_idempotencia)
  returning id, numero_pedido into v_pedido_id, v_numero;

  insert into public.pedido_itens (
    pedido_id, produto_id, nome_produto, imagem_produto, tamanho, cor,
    quantidade, preco_unitario, produto_variacao_id, estoque_status)
  select v_pedido_id, l.slug, l.nome_produto, l.imagem, l.tamanho, l.cor_nome,
         l.quantidade, round(l.preco_unit, 2), l.variacao_id, 'reservado'
    from jsonb_to_recordset(v_plano)
         as l(slug text, nome_produto text, imagem text, tamanho text, cor_nome text,
              quantidade integer, preco_unit numeric, variacao_id uuid);
  get diagnostics v_linhas = row_count;
  if v_linhas <> v_n_resolvidas then
    raise exception 'reserva_inconsistente' using errcode = 'P0001';
  end if;

  -- Baixa o estoque (única forma permitida de mexer em estoque com reserva ativa) ---------------
  perform set_config('ugc.estoque_interno', 'on', true);
  update public.produto_variacoes pv
     set estoque = pv.estoque - l.quantidade
    from jsonb_to_recordset(v_plano) as l(variacao_id uuid, quantidade integer)
   where pv.id = l.variacao_id;          -- CHECK (estoque >= 0) é a última barreira
  get diagnostics v_linhas = row_count;
  perform set_config('ugc.estoque_interno', 'off', true);
  if v_linhas <> v_n_resolvidas then
    raise exception 'reserva_inconsistente' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'pedido_id', v_pedido_id, 'numero_pedido', v_numero, 'status', 'aguardando_pagamento',
    'subtotal', v_subtotal, 'frete', v_frete, 'desconto', 0, 'total', v_total,
    'pagamento_expira_em', v_expira, 'mercado_pago_preference_id', null,
    'reaproveitado', false);
end;
$$;


-- 6.2  Pagamento APROVADO (só o webhook chama, DEPOIS de validar a assinatura e de consultar o
--      pagamento direto na API do Mercado Pago). Consome a reserva sem descontar de novo.
--      Idempotente por payment_id. TODO pagamento aprovado fica registrado em
--      mercado_pago_pagamentos, inclusive o segundo pagamento do mesmo pedido.
--      Retorna: consumido | ja_processado | pagamento_duplicado | valor_divergente |
--               reserva_inconsistente | tardio_em_analise | estado_invalido
--      Tudo diferente de 'consumido' e 'ja_processado' exige olhar manual (reembolso).
create or replace function public.registrar_pagamento_aprovado(
  p_pedido_id   uuid,
  p_payment_id  text,
  p_valor_pago  numeric,
  p_moeda       text,
  p_live_mode   boolean,
  p_metodo      text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p         public.pedidos%rowtype;
  v_pg        public.mercado_pago_pagamentos%rowtype;
  v_total     integer;
  v_nao_res   integer;
  v_dados_ok  boolean;
  v_resultado text;
  v_manual    boolean := false;
begin
  if p_pedido_id is null then
    raise exception 'pedido_obrigatorio' using errcode = 'P0001';
  end if;
  if p_payment_id is null or p_payment_id !~ '^[0-9]{1,30}$' then
    raise exception 'payment_id_invalido' using errcode = 'P0001';
  end if;

  select * into v_p from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'pedido_nao_encontrado' using errcode = 'P0001';
  end if;

  -- Idempotência por pagamento -------------------------------------------------------------
  select * into v_pg from public.mercado_pago_pagamentos where payment_id = p_payment_id;
  if found then
    if v_pg.pedido_id <> p_pedido_id then
      raise exception 'pagamento_de_outro_pedido' using errcode = 'P0001';
    end if;
    return 'ja_processado';
  end if;

  -- Valor, moeda e ambiente (somente produção) conferem? ---------------------------------------
  v_dados_ok := p_valor_pago is not null
                and round(p_valor_pago, 2) = round(v_p.total, 2)
                and upper(coalesce(p_moeda, '')) = 'BRL'
                and p_live_mode is true;

  if v_p.status in ('pago', 'em_analise') then
    -- Outro pagamento aprovado para um pedido que já tem pagamento/análise: reembolso manual.
    v_resultado := 'pagamento_duplicado';
    v_manual := true;

  elsif v_p.status = 'aguardando_pagamento' then
    if not v_dados_ok then
      v_resultado := 'valor_divergente';
      v_manual := true;
      update public.pedidos
         set status = 'em_analise',
             mercado_pago_payment_id = coalesce(mercado_pago_payment_id, p_payment_id)
       where id = v_p.id;
    else
      select count(*), count(*) filter (where i.estoque_status <> 'reservado')
        into v_total, v_nao_res
        from public.pedido_itens i where i.pedido_id = v_p.id;
      if v_total = 0 or v_nao_res > 0 then
        v_resultado := 'reserva_inconsistente';
        v_manual := true;
        update public.pedidos
           set status = 'em_analise',
               mercado_pago_payment_id = coalesce(mercado_pago_payment_id, p_payment_id)
         where id = v_p.id;
      else
        -- Reserva ainda de pé (mesmo vencida no relógio, enquanto o estoque não foi
        -- devolvido ele continua nosso): honra o pagamento e consome a reserva.
        update public.pedido_itens set estoque_status = 'consumido'
         where pedido_id = v_p.id and estoque_status = 'reservado';
        update public.pedidos
           set status = 'pago', status_entrega = 'em_preparacao',
               mercado_pago_payment_id = coalesce(mercado_pago_payment_id, p_payment_id)
         where id = v_p.id;
        v_resultado := 'consumido';
      end if;
    end if;

  elsif v_p.status in ('expirado', 'cancelado') then
    -- Aprovado depois de o estoque ter sido devolvido: NÃO reserva de novo; análise manual
    -- e reembolso manual (nunca automático).
    v_resultado := 'tardio_em_analise';
    v_manual := true;
    update public.pedidos
       set status = 'em_analise',
           mercado_pago_payment_id = coalesce(mercado_pago_payment_id, p_payment_id)
     where id = v_p.id;

  else
    v_resultado := 'estado_invalido';
    v_manual := true;
  end if;

  insert into public.mercado_pago_pagamentos
    (payment_id, pedido_id, status_mp, valor, moeda, metodo, live_mode, resultado, requer_reembolso_manual)
  values
    (p_payment_id, v_p.id, 'approved', round(p_valor_pago, 2), upper(left(coalesce(p_moeda, ''), 3)),
     left(p_metodo, 40), p_live_mode, v_resultado, v_manual);

  return v_resultado;
end;
$$;


-- 6.3  Libera a reserva (expirado/cancelado) e devolve o estoque UMA vez.
--      Só age em pedido 'aguardando_pagamento' (e, à mão, em 'em_analise' que ainda segure
--      estoque, com 'cancelado'). Chamar de novo não faz nada (retorna 0).
--      'expirado' só é aceito depois do prazo (pagamento_expira_em). A Edge Function de
--      expiração DEVE consultar/cancelar a tentativa no Mercado Pago ANTES de chamar isto e
--      NÃO chamar se a consulta falhar: o banco não consegue verificar o pagamento sozinho.
create or replace function public.liberar_reserva_pedido(
  p_pedido_id     uuid,
  p_status_final  text default 'expirado'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p         public.pedidos%rowtype;
  v_n         integer;
  v_var_esp   integer;
  v_var_upd   integer;
begin
  if coalesce(p_status_final, '') not in ('expirado', 'cancelado') then
    raise exception 'status_final_invalido' using errcode = 'P0001';
  end if;

  select * into v_p from public.pedidos where id = p_pedido_id for update;
  if not found then
    raise exception 'pedido_nao_encontrado' using errcode = 'P0001';
  end if;

  if v_p.status <> 'aguardando_pagamento' then
    -- Exceção: pedido em_analise que ainda segura estoque (pagamento com valor divergente)
    -- pode ser cancelado À MÃO, depois do reembolso, com 'cancelado'. Qualquer outro caso
    -- (ex.: pagamento tardio, que já devolveu o estoque) não faz nada.
    if not (v_p.status = 'em_analise' and p_status_final = 'cancelado'
            and exists (select 1 from public.pedido_itens i
                         where i.pedido_id = v_p.id and i.estoque_status = 'reservado')) then
      return 0;
    end if;
  elsif p_status_final = 'expirado'
        and (v_p.pagamento_expira_em is null or v_p.pagamento_expira_em > now()) then
    raise exception 'reserva_ainda_valida' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.pedido_itens i
              where i.pedido_id = v_p.id and i.estoque_status = 'reservado'
                and i.produto_variacao_id is null) then
    raise exception 'reserva_sem_variacao' using errcode = 'P0001';
  end if;

  select count(distinct i.produto_variacao_id) into v_var_esp
    from public.pedido_itens i
   where i.pedido_id = v_p.id and i.estoque_status = 'reservado';

  perform 1
     from public.produto_variacoes pv
    where pv.id in (select i.produto_variacao_id from public.pedido_itens i
                     where i.pedido_id = v_p.id and i.estoque_status = 'reservado')
    order by pv.id
      for update;

  -- Devolve o estoque (somando linhas da mesma variação) e só então encerra os itens.
  perform set_config('ugc.estoque_interno', 'on', true);
  update public.produto_variacoes pv
     set estoque = pv.estoque + s.qtd
    from (select i.produto_variacao_id as vid, sum(i.quantidade)::integer as qtd
            from public.pedido_itens i
           where i.pedido_id = v_p.id and i.estoque_status = 'reservado'
           group by i.produto_variacao_id) s
   where pv.id = s.vid;
  get diagnostics v_var_upd = row_count;
  perform set_config('ugc.estoque_interno', 'off', true);
  if v_var_upd <> v_var_esp then
    raise exception 'reserva_inconsistente' using errcode = 'P0001';   -- desfaz tudo
  end if;

  update public.pedido_itens
     set estoque_status = 'liberado'
   where pedido_id = v_p.id and estoque_status = 'reservado';
  get diagnostics v_n = row_count;

  update public.pedidos
     set status = p_status_final, status_entrega = 'cancelado'
   where id = v_p.id;

  return v_n;
end;
$$;


-- 6.4  Lista pedidos com reserva vencida, para a rotina de expiração (Edge Function agendada).
--      Só LISTA: quem decide liberar é a Edge Function, depois de consultar o Mercado Pago.
--      Funciona com o checkout desativado (reservas existentes precisam expirar mesmo assim).
create or replace function public.listar_reservas_vencidas(p_limite integer default 50)
returns table (
  pedido_id uuid,
  numero_pedido text,
  mercado_pago_preference_id text,
  mercado_pago_payment_id text,
  pagamento_expira_em timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.numero_pedido, p.mercado_pago_preference_id,
         p.mercado_pago_payment_id, p.pagamento_expira_em
    from public.pedidos p
   where p.status = 'aguardando_pagamento'
     and p.pagamento_expira_em is not null
     and p.pagamento_expira_em < now()
     and exists (select 1 from public.pedido_itens i
                  where i.pedido_id = p.id and i.estoque_status = 'reservado')
   order by p.pagamento_expira_em
   limit greatest(1, least(coalesce(p_limite, 50), 500));
$$;


-- 6.5  Registra (e deduplica) a notificação do webhook. Só chamar DEPOIS de validar a assinatura:
--      notificação sem assinatura válida é recusada aqui (não polui a tabela).
--      Retorna deve_processar = true para evento novo OU repetido que ainda não foi concluído
--      ('recebido'/'erro'); false para o que já foi 'processado'/'ignorado'.
--      O cabeçalho x-request-id é guardado só para auditoria; NÃO entra na chave.
create or replace function public.registrar_evento_mercado_pago(
  p_tipo              text,
  p_acao              text,
  p_recurso_id        text,
  p_notificacao_id    text,
  p_request_id        text,
  p_live_mode         boolean,
  p_assinatura_valida boolean,
  p_payload           jsonb
)
returns table (evento_id uuid, deve_processar boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chave   text;
  v_id      uuid;
  v_status  text;
  v_payload jsonb;
begin
  if p_assinatura_valida is not true then
    raise exception 'assinatura_nao_validada' using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_tipo), '') = '' or coalesce(btrim(p_recurso_id), '') = ''
     or char_length(p_tipo) > 60 or char_length(p_recurso_id) > 100
     or char_length(coalesce(p_acao, '')) > 100 or char_length(coalesce(p_notificacao_id, '')) > 100
     or char_length(coalesce(p_request_id, '')) > 200 then
    raise exception 'evento_invalido' using errcode = 'P0001';
  end if;

  v_chave := btrim(p_tipo) || '|' || coalesce(btrim(p_acao), '') || '|' || btrim(p_recurso_id)
             || '|' || coalesce(btrim(p_notificacao_id), '');
  v_payload := case when p_payload is not null and octet_length(p_payload::text) > 20000
                    then jsonb_build_object('truncado', true) else p_payload end;

  insert into public.mercado_pago_eventos as e
    (chave_dedup, tipo, acao, recurso_id, notificacao_id, request_id, live_mode, payload)
  values
    (v_chave, btrim(p_tipo), nullif(btrim(p_acao), ''), btrim(p_recurso_id),
     nullif(btrim(p_notificacao_id), ''), p_request_id, p_live_mode, v_payload)
  on conflict (chave_dedup) do update set tentativas = e.tentativas + 1
  returning e.id, e.status_processamento into v_id, v_status;

  evento_id := v_id;
  deve_processar := v_status in ('recebido', 'erro');
  return next;
end;
$$;


-- 6.6  Painel admin: muda SÓ o status de entrega, e só de pedido já pago pelo webhook.
--      O painel não consegue marcar pagamento (UPDATE direto em pedidos deixa de existir).
create or replace function public.admin_atualizar_status_entrega(
  p_pedido_id      uuid,
  p_status_entrega text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'acesso_negado' using errcode = '42501';
  end if;
  if coalesce(p_status_entrega, '') not in ('em_preparacao', 'enviado', 'concluido') then
    raise exception 'status_entrega_invalido' using errcode = 'P0001';
  end if;
  update public.pedidos
     set status_entrega = p_status_entrega
   where id = p_pedido_id and status = 'pago';
  if not found then
    raise exception 'pedido_inexistente_ou_nao_pago' using errcode = 'P0001';
  end if;
end;
$$;


-- -------------------------------------------------------------------------------------
-- 7) PERMISSÕES
--    O Supabase concede EXECUTE a anon/authenticated em toda função nova do schema public;
--    por isso os REVOKE são explícitos. Tudo isto está na MESMA transação das criações:
--    se algo falhar antes, nada (nem função, nem permissão) fica aplicado.
-- -------------------------------------------------------------------------------------

-- 7.1 Tabelas de pedido: o navegador só LÊ (RLS continua limitando cada cliente aos seus).
--     O backend (service_role) só LÊ e grava o id da preferência; criar pedido, pagar e
--     liberar estoque acontecem exclusivamente pelas funções (que rodam como dono).
--     Ninguém apaga pedido.
revoke all on table public.pedidos      from PUBLIC, anon, authenticated, service_role;
revoke all on table public.pedido_itens from PUBLIC, anon, authenticated, service_role;
grant select on table public.pedidos      to authenticated, service_role;
grant select on table public.pedido_itens to authenticated, service_role;
grant update (mercado_pago_preference_id) on table public.pedidos to service_role;

-- 7.2 Painel precisa ver os itens dos pedidos (hoje só o próprio cliente, via política).
drop policy if exists "admin le itens dos pedidos" on public.pedido_itens;
create policy "admin le itens dos pedidos"
  on public.pedido_itens
  for select
  to authenticated
  using ((select (auth.jwt() -> 'app_metadata' ->> 'role')) = 'admin');

-- 7.3 Tabelas de auditoria.
revoke all on table public.mercado_pago_eventos    from PUBLIC, anon, authenticated, service_role;
revoke all on table public.mercado_pago_pagamentos from PUBLIC, anon, authenticated, service_role;
grant select, update on table public.mercado_pago_eventos    to service_role;   -- update: concluir status
grant select         on table public.mercado_pago_pagamentos to service_role;
grant select         on table public.mercado_pago_pagamentos to authenticated;  -- política: só admin

-- 7.4 Funções exclusivas do backend.
revoke all on function public.criar_pedido_com_reserva(uuid, uuid, jsonb, jsonb, text, integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.registrar_pagamento_aprovado(uuid, text, numeric, text, boolean, text)
  from PUBLIC, anon, authenticated;
revoke all on function public.liberar_reserva_pedido(uuid, text)
  from PUBLIC, anon, authenticated;
revoke all on function public.listar_reservas_vencidas(integer)
  from PUBLIC, anon, authenticated;
revoke all on function public.registrar_evento_mercado_pago(text, text, text, text, text, boolean, boolean, jsonb)
  from PUBLIC, anon, authenticated;
revoke all on function public.ugc_config_numero(text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.criar_pedido_com_reserva(uuid, uuid, jsonb, jsonb, text, integer)        to service_role;
grant execute on function public.registrar_pagamento_aprovado(uuid, text, numeric, text, boolean, text)   to service_role;
grant execute on function public.liberar_reserva_pedido(uuid, text)                                        to service_role;
grant execute on function public.listar_reservas_vencidas(integer)                                         to service_role;
grant execute on function public.registrar_evento_mercado_pago(text, text, text, text, text, boolean, boolean, jsonb) to service_role;
-- ugc_config_numero: só é chamada por dentro das funções acima (rodam como dono).

-- 7.5 Funções de trigger: ninguém as chama diretamente.
revoke all on function public.pedidos_definir_numero()               from PUBLIC, anon, authenticated, service_role;
revoke all on function public.pedidos_definir_atualizado_em()        from PUBLIC, anon, authenticated, service_role;
revoke all on function public.pedidos_proteger_campos()              from PUBLIC, anon, authenticated, service_role;
revoke all on function public.pedido_itens_validar_alteracao()       from PUBLIC, anon, authenticated, service_role;
revoke all on function public.produto_variacoes_proteger_reservas()  from PUBLIC, anon, authenticated, service_role;

-- 7.6 Painel admin: só authenticated (a função confere o papel admin dentro dela).
revoke all on function public.admin_atualizar_status_entrega(uuid, text) from PUBLIC, anon, service_role;
grant execute on function public.admin_atualizar_status_entrega(uuid, text) to authenticated;


-- -------------------------------------------------------------------------------------
-- 8) DOCUMENTAÇÃO NO PRÓPRIO BANCO
-- -------------------------------------------------------------------------------------
comment on column public.pedidos.status is
  'Situação do PAGAMENTO (só funções do backend alteram): aguardando_pagamento | pago | expirado | cancelado | em_analise (pagamento tardio/divergente/duplicado: reembolso manual). Sem CHECK próprio por compatibilidade.';
comment on column public.pedidos.status_entrega is
  'Situação da ENTREGA: aguardando_pagamento | em_preparacao | enviado | concluido | cancelado. Admin altera via admin_atualizar_status_entrega(), só com status = pago.';
comment on column public.pedido_itens.estoque_status is
  'nao_aplicavel; reservado → consumido (pago) ou liberado (expirou/cancelou). Transições validadas por trigger.';
comment on table public.mercado_pago_eventos is
  'Notificações do Mercado Pago (auditoria e deduplicação). Só service_role. Não guardar tokens, assinaturas nem dados de cartão.';
comment on table public.mercado_pago_pagamentos is
  'Um registro por pagamento APROVADO, inclusive duplicados e tardios (requer_reembolso_manual). Sem dados pessoais do pagador.';

notify pgrst, 'reload schema';

commit;
