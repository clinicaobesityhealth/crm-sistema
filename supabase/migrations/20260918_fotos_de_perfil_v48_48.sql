-- v48.48 — As fotos de quem chega pelo Instagram param de sumir.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- O QUE ACONTECIA
--
-- O endereço da foto de perfil que o Instagram entrega é ASSINADO e VENCE —
-- dias, às vezes horas. O CRM guardava esse endereço no cadastro, e quando ele
-- vencia a foto sumia para sempre. Tentar de novo não adiantava: o botão pedia
-- exatamente o mesmo endereço morto.
--
-- A correção não é insistir, é parar de depender de endereço alheio: a foto
-- passa a ser BAIXADA uma vez e guardada aqui, com endereço nosso, que não
-- vence.

insert into storage.buckets (id, name, public)
values ('avatares', 'avatares', true)
on conflict (id) do update set public = true;

do $$ begin
  create policy "avatares leitura publica"
    on storage.objects for select
    using (bucket_id = 'avatares');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatares escrita"
    on storage.objects for insert
    with check (bucket_id = 'avatares');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatares atualizacao"
    on storage.objects for update
    using (bucket_id = 'avatares');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatares remocao"
    on storage.objects for delete
    using (bucket_id = 'avatares');
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

select id, public from storage.buckets where id = 'avatares';
