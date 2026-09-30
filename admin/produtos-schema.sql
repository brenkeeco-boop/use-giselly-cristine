-- =====================================================================================
-- Use Giselly Cristine — Painel administrativo · Etapa 2 · Produtos
--
-- >>> ESTE ARQUIVO NÃO FOI EXECUTADO EM LUGAR NENHUM. <<<
-- Revise e rode você mesma no Supabase: SQL Editor → New query → cole → Run.
-- Pode ser executado mais de uma vez (é idempotente: não duplica categorias, produtos
-- nem políticas, e não apaga nem sobrescreve dados editados no painel).
--
-- Pré-requisito: a conta administradora já precisa ter app_metadata.role = 'admin'
-- (bloco 1 do arquivo proposta-admin-rls.sql, da Etapa 1).
--
-- O que este arquivo cria:  2 tabelas (public.produtos e public.categorias), 1 função +
--                           1 trigger, RLS ligado nas duas, permissões explícitas,
--                           4 políticas (admin + leitura pública em cada tabela),
--                           4 categorias e 12 produtos de referência SEM imagem.
-- O que NÃO mexe:          nenhuma tabela existente (pedidos, perfis, carrinho_itens...),
--                           nenhuma política de outras tabelas. Único ajuste em dados
--                           existentes: remove de produtos qualquer imagem que aponte
--                           para a logo da loja (a logo NÃO é imagem de produto).
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

-- Imagem de capa (opcional). Coluna nova e aditiva: o CRUD do painel não lê nem grava
-- esta coluna, então nada do que já existe muda. "add column if not exists" não duplica
-- nada se o arquivo for executado de novo.
alter table public.produtos add column if not exists image_url text;

comment on table  public.produtos                   is 'Catálogo de produtos gerenciado pelo painel admin.';
comment on column public.produtos.slug              is 'Identificador estável (mesmo formato do id em products.js / carrinho_itens.produto_id).';
comment on column public.produtos.preco             is 'Preço cheio. Em products.js corresponde a oldPrice (quando há promoção) ou a price (quando não há).';
comment on column public.produtos.preco_promocional is 'Preço vigente com desconto. Em products.js corresponde a price quando existe oldPrice.';
comment on column public.produtos.image_url         is 'Imagem de capa do produto. NULL = sem foto. Nunca usar a logo da loja aqui.';


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
-- 3) SEGURANÇA DE PRODUTOS — RLS + permissões explícitas + políticas
-- -------------------------------------------------------------------------------------
alter table public.produtos enable row level security;

-- Permissões de tabela (camada 1). Desde 2026 o Supabase deixou de conceder acesso
-- automático a tabelas novas do schema public; sem GRANT o admin receberia
-- "permission denied" mesmo com a política certa. Aqui fica tudo explícito:
--   • visitantes (anon): SOMENTE leitura (select). Não podem inserir, editar nem excluir.
--     Quais linhas eles enxergam é decidido pela política pública (camada 2): só ativas.
--   • logados (authenticated): precisam do privilégio para as políticas (camada 2) decidirem.
revoke all on table public.produtos from anon;
revoke all on table public.produtos from authenticated;
grant select                         on table public.produtos to anon;
grant select, insert, update, delete on table public.produtos to authenticated;

-- Política de admin (camada 2): só quem tem app_metadata.role = 'admin' enxerga TODAS as
-- linhas (inclusive inativas) e pode inserir, editar e excluir.
-- Uma cliente logada (authenticated, sem o papel) passa pelo GRANT mas é barrada aqui:
-- recebe erro ao tentar inserir; update/delete afetam 0 linhas.
-- app_metadata só pode ser gravado no servidor — o usuário não consegue se promover.
drop policy if exists "admin gerencia produtos" on public.produtos;
create policy "admin gerencia produtos"
  on public.produtos
  for all
  to authenticated
  using      ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' )
  with check ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' );

-- Política pública: visitantes e clientes logadas LEEM apenas produtos ativos.
-- É somente "select": não existe caminho público para inserir, editar ou excluir.
drop policy if exists "publico le produtos ativos" on public.produtos;
create policy "publico le produtos ativos"
  on public.produtos
  for select
  to anon, authenticated
  using ( ativo );


-- -------------------------------------------------------------------------------------
-- 4) CATEGORIAS — tabela + segurança + dados
-- -------------------------------------------------------------------------------------
-- Tabela separada e independente: produtos.categoria continua sendo texto (a chave, ex.:
-- "vestidos"), exatamente como o CRUD do painel já usa. Não há chave estrangeira de
-- propósito, para não alterar o comportamento do CRUD existente.
create table if not exists public.categorias (
  id         uuid        primary key default gen_random_uuid(),
  slug       text        not null,      -- mesma chave de CATEGORY_LABELS: vestidos, conjuntos...
  nome       text        not null,      -- rótulo exibido: Vestidos, Conjuntos...
  ordem      smallint    not null default 0,
  criado_em  timestamptz not null default now(),

  constraint categorias_slug_unico unique (slug),
  constraint categorias_slug_ck    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categorias_nome_ck    check (char_length(btrim(nome)) between 1 and 60)
);

comment on table public.categorias is 'Categorias da loja (leitura pública; escrita só admin).';

alter table public.categorias enable row level security;

-- Mesma lógica de duas camadas: anon só lê; authenticated recebe os privilégios e a
-- política de admin decide quem realmente escreve.
revoke all on table public.categorias from anon;
revoke all on table public.categorias from authenticated;
grant select                         on table public.categorias to anon;
grant select, insert, update, delete on table public.categorias to authenticated;

drop policy if exists "admin gerencia categorias" on public.categorias;
create policy "admin gerencia categorias"
  on public.categorias
  for all
  to authenticated
  using      ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' )
  with check ( (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' );

drop policy if exists "publico le categorias" on public.categorias;
create policy "publico le categorias"
  on public.categorias
  for select
  to anon, authenticated
  using ( true );

-- Categorias iniciais: SOMENTE estas 4. "on conflict do nothing": se já existirem (ou se
-- você tiver renomeado alguma no painel), nada é duplicado nem sobrescrito.
insert into public.categorias (slug, nome, ordem) values
  ('vestidos',  'Vestidos',  1),
  ('conjuntos', 'Conjuntos', 2),
  ('blusas',    'Blusas',    3),
  ('saias',     'Saias',     4)
on conflict (slug) do nothing;


-- -------------------------------------------------------------------------------------
-- 5) PRODUTOS DE REFERÊNCIA (os 12 de assets/js/products.js) — SEM IMAGEM
-- -------------------------------------------------------------------------------------
-- Todos entram com image_url = NULL e imagens = '[]' (lista vazia). A logo da loja NÃO é
-- usada como foto de produto. As fotos reais entram depois, pelo upload do painel.
-- Os 12 produtos entram como estão em products.js (inclusive os 2 de categoria 'calcas');
-- isso não cria categoria nenhuma, pois produtos.categoria é apenas texto.
-- Preço: preco = oldPrice (se houver) ou price; preco_promocional = price quando há oldPrice.
-- "on conflict (slug) do nothing": rodar de novo não duplica nem desfaz edições do painel.
insert into public.produtos
  (nome, slug, descricao, categoria, preco, preco_promocional, ativo, image_url, imagens)
values
  ('Vestido Midi Elegance', 'vestido-midi-elegance', 'Corte midi em tecido fluido, decote em V e amarração na cintura. Peça autoral da coleção atual, pensada para o dia a dia com um toque de sofisticação.', 'vestidos', 429.90, null, true, null, '[]'::jsonb),
  ('Conjunto Essential', 'conjunto-essential', 'Blazer alfaiataria e calça pantalona em tecido de caimento leve. Conjunto essencial para compor looks de trabalho ou eventos com elegância discreta.', 'conjuntos', 459.90, 389.90, true, null, '[]'::jsonb),
  ('Blusa Aurora', 'blusa-aurora', 'Blusa em cetim com mangas amplas e botões forrados. Um básico atemporal que eleva qualquer produção.', 'blusas', 179.90, null, true, null, '[]'::jsonb),
  ('Calça Alfaiataria Classic', 'calca-alfaiataria-classic', 'Modelagem reta de cintura alta com vinco frontal. Tecido estruturado que mantém o caimento perfeito durante todo o dia.', 'calcas', 299.90, 259.90, true, null, '[]'::jsonb),
  ('Saia Plissada Noir', 'saia-plissada-noir', 'Saia midi plissada com cós elástico. Movimento e leveza para o dia a dia, do escritório ao happy hour.', 'saias', 219.90, null, true, null, '[]'::jsonb),
  ('Vestido Longo Atelier', 'vestido-longo-atelier', 'Vestido longo em crepe com fenda lateral e alças reguláveis. Ideal para ocasiões especiais que pedem presença.', 'vestidos', 649.90, 549.90, true, null, '[]'::jsonb),
  ('Conjunto Linen Summer', 'conjunto-linen-summer', 'Top cropped e short em linho puro. Conjunto leve para dias quentes sem abrir mão do estilo.', 'conjuntos', 349.90, null, true, null, '[]'::jsonb),
  ('Blusa Seda Noite', 'blusa-seda-noite', 'Blusa em seda com gola laço, perfeita para compor looks noturnos com uma calça alfaiataria.', 'blusas', 239.90, 199.90, true, null, '[]'::jsonb),
  ('Calça Wide Camel', 'calca-wide-camel', 'Pantalona wide leg em alfaiataria camel, cintura alta e caimento fluido do quadril aos pés.', 'calcas', 279.90, null, true, null, '[]'::jsonb),
  ('Saia Midi Alfaiataria', 'saia-midi-alfaiataria', 'Saia midi reta com fenda traseira, em tecido alfaiataria de leve elasticidade para maior conforto.', 'saias', 229.90, null, true, null, '[]'::jsonb),
  ('Vestido Tricot Outono', 'vestido-tricot-outono', 'Vestido em tricot canelado, modelagem justa ao corpo com gola alta. Conforto e estilo para dias mais frios.', 'vestidos', 379.90, 319.90, true, null, '[]'::jsonb),
  ('Blusa Cropped Linho', 'blusa-cropped-linho', 'Blusa cropped em linho com amarração frontal, versátil para compor com saias e calças de cintura alta.', 'blusas', 149.90, null, true, null, '[]'::jsonb)
on conflict (slug) do nothing;

-- Limpeza: se algum produto (qualquer um) apontar para a logo da loja, zera a imagem.
-- Só toca linhas que referenciam "logo-use-giselly-cristine"; as demais ficam intactas.
update public.produtos
   set image_url = null,
       imagens   = '[]'::jsonb
 where image_url       ilike '%logo-use-giselly-cristine%'
    or imagens::text   ilike '%logo-use-giselly-cristine%';


-- -------------------------------------------------------------------------------------
-- 6) CONFERÊNCIA (somente leitura) — rode depois para validar
-- -------------------------------------------------------------------------------------
-- RLS ligado nas duas tabelas?  (rls_ligado deve ser true em ambas)
-- select relname as tabela, relrowsecurity as rls_ligado
--   from pg_class where oid in ('public.produtos'::regclass, 'public.categorias'::regclass);
--
-- Políticas?  (4 linhas: "admin gerencia ..." = ALL / {authenticated};
--              "publico le ..." = SELECT / {anon,authenticated})
-- select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename in ('produtos','categorias') order by tablename, policyname;
--
-- Permissões?  (anon: só SELECT; authenticated: SELECT/INSERT/UPDATE/DELETE)
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('produtos','categorias')
--     and grantee in ('anon','authenticated')
--   order by table_name, grantee, privilege_type;
--
-- Sem duplicações e sem imagens?  (categorias = 4; produtos de referência = 12, todos
-- com image_url nulo e imagens = [])
-- select count(*) from public.categorias;
-- select slug, image_url, imagens from public.produtos order by criado_em;


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

-- B) MAPEAMENTO DOS CAMPOS DE products.js → public.produtos (já aplicado na seção 5)
--
--   products.js          →  public.produtos
--   id (slug)            →  slug
--   name                 →  nome
--   category             →  categoria
--   description          →  descricao
--   images[]             →  imagens / image_url   (vazios por enquanto; upload na próxima etapa)
--   oldPrice ?? price    →  preco               (ATENÇÃO: price em products.js é o preço ATUAL)
--   oldPrice ? price : –  →  preco_promocional
--   isNew                →  (sem coluna: decidir se vira campo "novo" ou regra por data)
--   colors[] / sizes[]   →  produto_variacoes  (item A)
-- As categorias "novidades" e "promocoes" de CATEGORY_LABELS são derivadas (isNew / oldPrice),
-- não categorias reais. A tabela public.categorias tem SOMENTE: vestidos, conjuntos, blusas e saias.
