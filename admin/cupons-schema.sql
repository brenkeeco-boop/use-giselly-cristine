-- Use Giselly Cristine — Cupons (Admin Etapa 1)
-- Execute no SQL Editor do Supabase. Idempotente e sem exclusão de dados.
create table if not exists public.cupons (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  percentual numeric(5,2) not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint cupons_percentual_ck check (percentual > 0 and percentual <= 100)
);

alter table public.cupons add column if not exists codigo text;
alter table public.cupons add column if not exists percentual numeric(5,2);
alter table public.cupons add column if not exists ativo boolean not null default true;
alter table public.cupons add column if not exists criado_em timestamptz not null default now();
alter table public.cupons add column if not exists atualizado_em timestamptz not null default now();

create unique index if not exists cupons_codigo_unico on public.cupons (lower(btrim(codigo)));
create index if not exists cupons_ativo_idx on public.cupons (ativo);

alter table public.cupons enable row level security;
revoke all on table public.cupons from anon;
revoke all on table public.cupons from authenticated;
grant select, insert, update, delete on table public.cupons to authenticated;

drop policy if exists "admin gerencia cupons" on public.cupons;
create policy "admin gerencia cupons" on public.cupons for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.cupons_definir_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end;
$$;
drop trigger if exists cupons_atualizado_em on public.cupons;
create trigger cupons_atualizado_em before update on public.cupons
for each row execute function public.cupons_definir_atualizado_em();

comment on table public.cupons is 'Cupons percentuais gerenciados pelo painel administrativo.';
comment on column public.cupons.percentual is 'Desconto percentual entre 0 e 100.';
