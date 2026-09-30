-- =====================================================================================
-- Use Giselly Cristine — Painel administrativo · Etapa 2 · Produtos
--
-- >>> ESTE ARQUIVO NÃO FOI EXECUTADO EM LUGAR NENHUM. <<<
-- Revise e rode você mesma no Supabase: SQL Editor → New query → cole → Run.
-- Pode ser executado mais de uma vez (é idempotente: não duplica nem apaga dados).
--
-- Pré-requisito: a conta administradora já precisa ter app_metadata.role = 'admin'
-- (bloco 1 do arquivo proposta-admin-rls.sql, da Etapa 1).
--
-- O que este arquivo cria:  1 tabela (public.produtos), 1 função + 1 trigger,
--                           RLS ligado, permissões explícitas e 1 política (admin).
-- O que NÃO mexe:          nenhuma tabela existente (pedidos, perfis, carrinho_itens...),
--                           nenhuma política existente, nenhum dado.
-- =====================================================================================


-- -------------------------------------------------------------------------------------
-- 1) TABELA
-- -------------------------------------------------------------------------------------
create table if not exists public.produtos (
  id                 uuid          primary key default gen_random_uuid(),
  nome               text          not null,
  -- slug = identificador estável e único do produto (ex.: "vestido-midi-elegance").
  -- É o mesmo formato do "id" de assets/js/products.js e do carrinho_itens.produto_id,
  -- então a futura migração do catálogo público preserva carrinhos e favoritos.
  slug               text          not null,
  descricao          text,
  categoria          text          not null,   -- mesma chave de CATEGORY_LABELS: vestidos, blusas...
  preco              numeric(10,2) not null,   -- preço cheio ("de")
  preco_promocional  numeric(10,2),            -- preço "por"; NULL = sem promoção
  ativo              boolean       not null default true,
  -- Preparação para imagens (upload ainda NÃO implementado): lista de URLs/caminhos.
  -- Quando o Storage for configurado, basta gravar aqui. Sem upload, fica '[]'.
  imagens            jsonb         not null default '[]'::jsonb,
  criado_em          timestamptz   not null default now(),
  atualizado_em      timestamptz   not null default now(),

  constraint produtos_slug_unico     unique (slug),
  constraint produtos_nome_ck        check (char_length(btrim(nome)) between 1 and 120),
  constraint produtos_slug_ck        check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint produtos_categoria_ck   check (char_length(btrim(categoria)) > 0),
  constraint produtos_descricao_ck   check (descricao is null or char_length(descricao) <= 2000),
  constraint produtos_preco_ck       check (preco >= 0),
  constraint produtos_promo_ck       check (preco_promocional is null
                                            or (preco_promocional >= 0 and preco_promocional < preco)),
  constraint produtos_imagens_ck     check (jsonb_typeof(imagens) = 'array')
);

comment on table  public.produtos                   is 'Catálogo de produtos gerenciado pelo painel admin.';
comment on column public.produtos.slug              is 'Identificador estável (mesmo formato do id em products.js / carrinho_itens.produto_id).';
comment on column public.produtos.preco             is 'Preço cheio. Em products.js corresponde a oldPrice (quando há promoção) ou a price (quando não há).';
comment on column public.produtos.preco_promocional is 'Preço vigente com desconto. Em products.js corresponde a price quando existe oldPrice.';


-- -------------------------------------------------------------------------------------
-- 2) atualizado_em automático (função e trigger exclusivas desta tabela)
-- -------------------------------------------------------------------------------------
create or replace function public.produtos_definir_atualizado_em()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists produtos_atualizado_em on public.produtos;
create trigger produtos_atualizado_em
  before update on public.produtos
  for each row execute function public.produtos_definir_atualizado_em();


-- -------------------------------------------------------------------------------------
-- 3) SEGURANÇA — RLS + permissões explícitas
-- -------------------------------------------------------------------------------------
alter table public.produtos enable row level security;

-- Permissões de tabela (camada 1). Desde 2026 o Supabase deixou de conceder acesso
-- automático a tabelas novas do schema public; sem GRANT o admin receberia
-- "permission denied" mesmo com a política certa. Aqui fica tudo explícito:
--   • visitantes (anon): NENHUM acesso — não podem nem ler, inserir, editar ou excluir.
--   • logados (authenticated): precisam do privilégio para a política (camada 2) poder decidir.
revoke all on table public.produtos from anon;
revoke all on table public.produtos from authenticated;
grant select, insert, update, delete on table public.produtos to authenticated;

-- Política (camada 2): só quem tem app_metadata.role = 'admin' enxerga e altera linhas.
-- Uma cliente logada (authenticated, sem o papel) passa pelo GRANT mas é barrada aqui:
-- não lê nenhuma linha e recebe erro ao tentar inserir; update/delete afetam 0 linhas.
-- app_metadata só pode ser gravado no servidor — o usuário não consegue se promover.
drop policy if exists "admin gerencia produtos" on public.produtos;
create policy "admin gerencia produtos"
  on public.produtos
  for all
  to authenticated
  using      ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' )
  with check ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' );


-- -------------------------------------------------------------------------------------
-- 4) CONFERÊNCIA (somente leitura) — rode depois para validar
-- -------------------------------------------------------------------------------------
-- RLS ligado?  (rls_ligado deve ser true)
-- select relname as tabela, relrowsecurity as rls_ligado
--   from pg_class where oid = 'public.produtos'::regclass;
--
-- Política criada?  (deve listar "admin gerencia produtos", cmd = ALL, roles = {authenticated})
-- select policyname, cmd, roles from pg_policies where schemaname = 'public' and tablename = 'produtos';
--
-- Permissões?  (anon NÃO deve aparecer; authenticated deve ter só SELECT/INSERT/UPDATE/DELETE)
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'produtos' and grantee in ('anon','authenticated')
--   order by grantee, privilege_type;


-- =====================================================================================
-- REFERÊNCIA PARA AS PRÓXIMAS ETAPAS — tudo abaixo está COMENTADO e NÃO deve ser
-- executado agora. É só a proposta de estrutura mínima, para você aprovar antes.
-- =====================================================================================

-- A) TAMANHOS + CORES + ESTOQUE  (1 única tabela nova, quando formos implementar)
--
-- Situação atual (products.js): cada produto tem `sizes` (duas escalas: PP/P/M/G/GG e
-- 36–44), `colors` (1 a 2 cores, com nome e hex) e NENHUM campo de estoque. O carrinho
-- (carrinho_itens) já identifica o item por (produto_id, tamanho, cor) em texto.
-- Uma linha por combinação cobre os três requisitos e casa 1:1 com o carrinho:
--
-- create table public.produto_variacoes (
--   id          uuid    primary key default gen_random_uuid(),
--   produto_id  uuid    not null references public.produtos(id) on delete cascade,
--   tamanho     text    not null,                 -- "P", "M", "38"  (= carrinho_itens.tamanho)
--   cor         text    not null,                 -- "Vinho"         (= carrinho_itens.cor)
--   cor_hex     text,                             -- "#6E2430"
--   estoque     integer not null default 0 check (estoque >= 0),
--   unique (produto_id, tamanho, cor)
-- );
-- (+ RLS e a mesma política de admin. Por que tabela e não jsonb em produtos: a baixa de
--  estoque no checkout precisa ser atômica — "update ... set estoque = estoque - n
--  where estoque >= n" — e isso não é seguro em um campo jsonb.)

-- B) LEITURA PÚBLICA, quando o catálogo da loja passar a vir do banco
--
-- grant select on table public.produtos to anon;
-- create policy "publico le produtos ativos"
--   on public.produtos for select to anon, authenticated
--   using ( ativo );

-- C) MIGRAÇÃO DOS 12 PRODUTOS DE products.js (mapeamento de campos)
--
--   products.js          →  public.produtos
--   id (slug)            →  slug
--   name                 →  nome
--   category             →  categoria
--   description          →  descricao
--   images[]             →  imagens
--   oldPrice ?? price    →  preco               (ATENÇÃO: price em products.js é o preço ATUAL)
--   oldPrice ? price : –  →  preco_promocional
--   isNew                →  (sem coluna: decidir se vira campo "novo" ou regra por data)
--   colors[] / sizes[]   →  produto_variacoes  (item A)
-- As categorias "novidades" e "promocoes" de CATEGORY_LABELS são derivadas (isNew / oldPrice),
-- não categorias reais — por isso o admin só oferece vestidos, conjuntos, blusas, calças e saias.
