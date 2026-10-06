-- Use Giselly Cristine — Etapa 2: cores, imagens e estoque por tamanho.
-- Esta migration é somente aditiva: ela não modifica nem migra produtos existentes.

create table if not exists public.produto_cores (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  nome text not null,
  imagens jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint produto_cores_nome_ck check (char_length(btrim(nome)) between 1 and 60),
  constraint produto_cores_imagens_array_ck check (jsonb_typeof(imagens) = 'array'),
  constraint produto_cores_duas_imagens_ck check (jsonb_array_length(imagens) <= 2),
  constraint produto_cores_nome_unico unique (produto_id, nome)
);

create table if not exists public.produto_variacoes (
  id uuid primary key default gen_random_uuid(),
  produto_cor_id uuid not null references public.produto_cores(id) on delete cascade,
  tamanho text not null,
  estoque integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint produto_variacoes_tamanho_ck check (tamanho in ('P', 'M', 'G')),
  constraint produto_variacoes_estoque_ck check (estoque >= 0),
  constraint produto_variacoes_cor_tamanho_unico unique (produto_cor_id, tamanho)
);

create index if not exists produto_cores_produto_id_idx on public.produto_cores(produto_id);
create unique index if not exists produto_cores_nome_normalizado_unico on public.produto_cores(produto_id, lower(btrim(nome)));
create index if not exists produto_variacoes_cor_id_idx on public.produto_variacoes(produto_cor_id);

create or replace function public.produto_variacoes_definir_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end;
$$;

drop trigger if exists produto_cores_atualizado_em on public.produto_cores;
create trigger produto_cores_atualizado_em before update on public.produto_cores
for each row execute function public.produto_variacoes_definir_atualizado_em();

drop trigger if exists produto_variacoes_atualizado_em on public.produto_variacoes;
create trigger produto_variacoes_atualizado_em before update on public.produto_variacoes
for each row execute function public.produto_variacoes_definir_atualizado_em();

alter table public.produto_cores enable row level security;
alter table public.produto_variacoes enable row level security;

revoke all on public.produto_cores from anon, authenticated;
revoke all on public.produto_variacoes from anon, authenticated;
grant select on public.produto_cores, public.produto_variacoes to anon;
grant select, insert, update, delete on public.produto_cores, public.produto_variacoes to authenticated;

drop policy if exists "admin gerencia produto cores" on public.produto_cores;
create policy "admin gerencia produto cores" on public.produto_cores for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "admin gerencia produto variacoes" on public.produto_variacoes;
create policy "admin gerencia produto variacoes" on public.produto_variacoes for all to authenticated
using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "publico le cores de produtos ativos" on public.produto_cores;
create policy "publico le cores de produtos ativos" on public.produto_cores for select to anon, authenticated
using (exists (select 1 from public.produtos p where p.id = produto_id and p.ativo));

drop policy if exists "publico le variacoes de produtos ativos" on public.produto_variacoes;
create policy "publico le variacoes de produtos ativos" on public.produto_variacoes for select to anon, authenticated
using (exists (select 1 from public.produto_cores c join public.produtos p on p.id = c.produto_id where c.id = produto_cor_id and p.ativo));
