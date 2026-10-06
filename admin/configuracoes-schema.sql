create table if not exists public.configuracoes (chave text primary key, valor text not null default '', atualizado_em timestamptz not null default now());
alter table public.configuracoes enable row level security;
grant select,insert,update,delete on public.configuracoes to authenticated;
drop policy if exists "admin gerencia configuracoes" on public.configuracoes;
create policy "admin gerencia configuracoes" on public.configuracoes for all to authenticated using ((select auth.jwt()->'app_metadata'->>'role')='admin') with check ((select auth.jwt()->'app_metadata'->>'role')='admin');
insert into public.configuracoes (chave,valor) values ('dominio','www.usegisellycristine.com.br'),('frete_gratis_acima','250'),('frete_regiao','Valparaíso de Goiás e região'),('prazo_entrega','1 a 3 dias'),('politica_troca','7 dias úteis'),('politica_reembolso','24 horas') on conflict (chave) do nothing;
