-- Use Giselly Cristine — Configurações (Admin Etapa 1)
-- Execute no SQL Editor do Supabase. Idempotente e sem sobrescrever dados.
create table if not exists public.configuracoes (
  chave text primary key,
  valor text not null default '',
  atualizado_em timestamptz not null default now()
);

alter table public.configuracoes add column if not exists valor text not null default '';
alter table public.configuracoes add column if not exists atualizado_em timestamptz not null default now();

alter table public.configuracoes enable row level security;
revoke all on table public.configuracoes from anon;
revoke all on table public.configuracoes from authenticated;
grant select, insert, update, delete on table public.configuracoes to authenticated;

drop policy if exists "admin gerencia configuracoes" on public.configuracoes;
create policy "admin gerencia configuracoes" on public.configuracoes for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.configuracoes_definir_atualizado_em() returns trigger
language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end;
$$;
drop trigger if exists configuracoes_atualizado_em on public.configuracoes;
create trigger configuracoes_atualizado_em before update on public.configuracoes
for each row execute function public.configuracoes_definir_atualizado_em();

insert into public.configuracoes (chave, valor) values
  ('nome_loja', 'Use Giselly Cristine'),
  ('instagram', ''),
  ('whatsapp', ''),
  ('dominio', 'www.usegisellycristine.com.br'),
  ('pix_desconto', '0'),
  ('frete_gratis_acima', '250'),
  ('frete_regiao', 'Valparaíso de Goiás e região'),
  ('prazo_entrega', '1 a 3 dias'),
  ('politica_troca', '7 dias úteis'),
  ('politica_reembolso', '24 horas')
on conflict (chave) do nothing;

comment on table public.configuracoes is 'Configurações simples da loja gerenciadas pelo painel administrativo.';
