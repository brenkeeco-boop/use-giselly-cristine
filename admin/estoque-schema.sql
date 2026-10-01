-- =====================================================================================
-- Use Giselly Cristine — Painel administrativo · Estoque dos produtos
--
-- >>> ESTE ARQUIVO NÃO FOI EXECUTADO EM LUGAR NENHUM. <<<
-- Revise e rode você mesma no Supabase: SQL Editor → New query → cole → Run.
-- Pode ser executado mais de uma vez (idempotente): não duplica coluna nem regra e não
-- altera nenhum estoque já preenchido.
--
-- Pré-requisito: a tabela public.produtos já existe (admin/produtos-schema.sql).
--
-- O que este arquivo faz:
--   • adiciona public.produtos.estoque  (integer, obrigatório, padrão 0);
--   • impede estoque negativo (check estoque >= 0);
--   • pede ao Supabase para recarregar o esquema da API (a coluna nova aparece na hora).
--
-- O que NÃO mexe:
--   • RLS e políticas — continuam exatamente as mesmas (o admin lê/grava tudo; visitantes
--     leem só produtos ativos). Nenhuma política nova é necessária.
--   • permissões (GRANT) — já valem para a tabela inteira, inclusive para a coluna nova.
--   • nenhuma outra tabela, nenhum dado existente: produtos que já existem ficam com estoque 0.
--
-- Observação: como o acesso de leitura dos visitantes (anon) é por tabela, a coluna
-- "estoque" também fica legível pela API pública para produtos ATIVOS. O site público
-- não a utiliza (o catálogo pede só colunas específicas). Se um dia o número de unidades
-- não puder ser público, o caminho é restringir as colunas do anon com GRANT por coluna.
-- =====================================================================================


-- -------------------------------------------------------------------------------------
-- 1) COLUNA
-- -------------------------------------------------------------------------------------
-- Em produtos existentes a coluna nasce com 0 (default). Sem "if not exists" duplicando.
alter table public.produtos
  add column if not exists estoque integer not null default 0;

-- Garantias caso a coluna já tivesse sido criada à mão de outro jeito (nenhum efeito
-- quando ela acabou de ser criada acima):
update public.produtos set estoque = 0 where estoque is null;
alter table public.produtos alter column estoque set default 0;
alter table public.produtos alter column estoque set not null;

comment on column public.produtos.estoque is 'Quantidade em estoque (unidades inteiras, nunca negativa). Gerenciada no painel admin.';


-- -------------------------------------------------------------------------------------
-- 2) NUNCA NEGATIVO
-- -------------------------------------------------------------------------------------
-- "add constraint" não tem "if not exists"; o bloco abaixo só cria se ainda não existir.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname  = 'produtos_estoque_ck'
       and conrelid = 'public.produtos'::regclass
  ) then
    alter table public.produtos
      add constraint produtos_estoque_ck check (estoque >= 0);
  end if;
end
$$;


-- -------------------------------------------------------------------------------------
-- 3) Atualiza o cache de esquema da API do Supabase (PostgREST)
-- -------------------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- -------------------------------------------------------------------------------------
-- 4) CONFERÊNCIA (opcional) — rode separado depois; deve devolver 1 linha:
--    estoque | integer | NO | 0
-- -------------------------------------------------------------------------------------
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'produtos' and column_name = 'estoque';
