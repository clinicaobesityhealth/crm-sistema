-- v48.32 — O papel timbrado de cada médico: cabeçalho, carimbo e assinatura.
--
-- Rode depois da v48.25. Pode rodar mais de uma vez.
--
-- As cartas da clínica (internação, orçamento, prévia e solicitação de
-- reembolso) são hoje abas formatadas da planilha, e cada uma monta o papel a
-- partir da aba DADOS: foto/cabeçalho na E2, telefone na E6, nome na E64,
-- endereço na E65, CRM na E66, carimbo na E55.
--
-- Para a carta sair do CRM com a MESMA cara, esses pedaços precisam morar no
-- cadastro de quem assina — e não no desenho de cada carta. Um médico novo
-- entra com o papel dele; o cabeçalho muda uma vez e muda em todas as cartas.

alter table public.cirurgia_equipe add column if not exists endereco          text;
alter table public.cirurgia_equipe add column if not exists cabecalho_url     text;  -- a faixa do topo da página
alter table public.cirurgia_equipe add column if not exists carimbo_url       text;  -- carimbo com nome e CRM
alter table public.cirurgia_equipe add column if not exists assinatura_url    text;  -- assinatura digitalizada
alter table public.cirurgia_equipe add column if not exists rodape            text;  -- linha de endereço/contato no pé
alter table public.cirurgia_equipe add column if not exists titulo_assinatura text;  -- "Cirurgião do Aparelho Digestivo"

-- ===========================================================================
-- Onde as imagens ficam
-- ===========================================================================
-- Um balde próprio, público de leitura: a imagem entra no PDF da carta e no
-- que for enviado ao paciente, então precisa abrir sem autenticação. Não vai
-- documento de paciente aqui — só o papel timbrado da clínica.
insert into storage.buckets (id, name, public)
values ('papel-timbrado', 'papel-timbrado', true)
on conflict (id) do update set public = true;

do $$ begin
  create policy "papel timbrado leitura publica"
    on storage.objects for select
    using (bucket_id = 'papel-timbrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "papel timbrado escrita"
    on storage.objects for insert
    with check (bucket_id = 'papel-timbrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "papel timbrado atualizacao"
    on storage.objects for update
    using (bucket_id = 'papel-timbrado');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "papel timbrado remocao"
    on storage.objects for delete
    using (bucket_id = 'papel-timbrado');
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';

select
  count(*)                                               as pessoas_na_equipe,
  count(*) filter (where cabecalho_url is not null)      as com_cabecalho,
  count(*) filter (where carimbo_url is not null)        as com_carimbo,
  count(*) filter (where assinatura_url is not null)     as com_assinatura
  from public.cirurgia_equipe;
