create table if not exists public.cupons (id uuid primary key default gen_random_uuid(), codigo text not null, percentual numeric(5,2) not null check (percentual > 0 and percentual <= 100), ativo boolean not null default true, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), constraint cupons_codigo_unico unique (codigo));
alter table public.cupons enable row level security;
grant select,insert,update,delete on public.cupons to authenticated;
drop policy if exists "admin gerencia cupons" on public.cupons;
create policy "admin gerencia cupons" on public.cupons for all to authenticated using ((select auth.jwt()->'app_metadata'->>'role')='admin') with check ((select auth.jwt()->'app_metadata'->>'role')='admin');
