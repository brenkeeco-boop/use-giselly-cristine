-- Use Giselly Cristine — Storage das fotos de produtos
-- Execute uma vez no Supabase Dashboard: SQL Editor → New query → Run.
-- É idempotente: cria/configura somente o bucket e as políticas de Storage.
-- Não altera public.produtos, tabelas existentes, nem usa service_role no frontend.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'produtos',
  'produtos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Leitura pública: o catálogo público usa as URLs públicas gravadas em produtos.imagens.
drop policy if exists "publico le imagens de produtos" on storage.objects;
create policy "publico le imagens de produtos"
  on storage.objects
  for select
  to public
  using (bucket_id = 'produtos');

-- Escrita apenas para administradores autenticados. O frontend usa a mesma sessão e
-- o mesmo app_metadata.role = 'admin' já exigidos pelo CRUD de public.produtos.
drop policy if exists "admin envia imagens de produtos" on storage.objects;
create policy "admin envia imagens de produtos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'produtos'
    and name like 'products/%'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "admin atualiza imagens de produtos" on storage.objects;
create policy "admin atualiza imagens de produtos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'produtos'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'produtos'
    and name like 'products/%'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "admin exclui imagens de produtos" on storage.objects;
create policy "admin exclui imagens de produtos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'produtos'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Conferência opcional:
-- select id, name, public, file_size_limit, allowed_mime_types
--   from storage.buckets where id = 'produtos';
-- select policyname, cmd, roles from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname like '%imagens de produtos%';
