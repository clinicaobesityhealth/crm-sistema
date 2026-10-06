-- v48.74 — Busca de paciente que aceita como as pessoas escrevem.
--
-- Pode rodar de novo sem problema.
--
-- O PROBLEMA
-- A busca era um ILIKE direto no nome. "JOAO" não achava "JOÃO", porque o
-- Postgres compara o acento como caractere; e ninguém digita acento com pressa.
-- Pior: o mesmo nome chega escrito de dois jeitos do MedX e do WhatsApp —
-- Thiago/Tiago, Luiz/Luís, Xavier/Chavier, Yasmin/Iasmin — e a secretária
-- concluía que o paciente não tinha cadastro e criava um duplicado.
--
-- A SOLUÇÃO
-- Reduzir os dois lados (o que está no banco e o que foi digitado) à mesma
-- chave: sem acento, sem pontuação, e com os sons que se confundem em português
-- escritos de um jeito só. Não é fonética completa nem quer ser — é o conjunto
-- de trocas que aparece de verdade em nome de paciente.

create extension if not exists pg_trgm;

-- Só tira acento e pontuação. Separada porque é útil sozinha.
create or replace function public.chave_busca(p text)
returns text
language sql
immutable
as $bus$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäéèêëíìîïóòôõöúùûüçñýÿ',
      'aaaaaeeeeiiiiooooouuuucnii'),
    '[^a-z0-9]+', ' ', 'g'))
$bus$;

-- Em cima disso, as trocas de som.
--
-- A ordem importa: os dígrafos são tratados antes de o "h" solto cair, senão
-- "lh" e "nh" virariam "l" e "n" e "Marília" casaria com "Maria".
create or replace function public.chave_fonetica(p text)
returns text
language sql
immutable
as $fon$
  select regexp_replace(
    replace(replace(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(
          public.chave_busca(p),
          'lh', '\1'), 'nh', '\2'),       -- guarda os dígrafos que ficam
          'ph', 'f'), 'ch', 'x'), 'sh', 'x'),
          'ss', 's'), 'ç', 'c'), 'w', 'v'), 'k', 'c'),
        'h', '', 'g'),                    -- o resto do "h" não soa: Thiago = Tiago
      '\1', 'lh'), '\2', 'nh'),           -- devolve os dígrafos
    '(.)\1+', '\1', 'g')                  -- letra dobrada não muda o som
$fon$;

-- y → i e z → s ficam por último, depois de os dígrafos voltarem.
create or replace function public.chave_nome(p text)
returns text
language sql
immutable
as $nom$
  select translate(public.chave_fonetica(p), 'yz', 'is')
$nom$;

-- Índice pela mesma chave: sem ele, cada busca leria a tabela inteira
-- calculando a função linha a linha.
create index if not exists contacts_chave_nome_idx
  on public.contacts using gin (public.chave_nome(full_name) gin_trgm_ops);

-- A busca em si. Fica no banco, e não na tela, para a regra valer igual em
-- qualquer lugar que procure paciente.
create or replace function public.buscar_contatos(p_termo text, p_limite integer default 8)
returns table (
  id uuid, full_name text, phone text,
  convenio_id uuid, plano_id uuid,
  carteirinha text, carteirinha_nome text, carteirinha_validade date
)
language sql
stable
security definer
set search_path = public
as $bc$
  select c.id, c.full_name, c.phone,
         c.convenio_id, c.plano_id,
         c.carteirinha, c.carteirinha_nome, c.carteirinha_validade
    from public.contacts c
   where
     -- Nome pela chave, ou telefone quando o que foi digitado tem dígitos.
     (btrim(public.chave_nome(p_termo)) <> ''
       and public.chave_nome(c.full_name) like '%' || public.chave_nome(p_termo) || '%')
     or (regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') <> ''
       and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g')
           like '%' || regexp_replace(p_termo, '[^0-9]', '', 'g') || '%')
   order by
     -- Quem começa com o que foi digitado vem primeiro: procurando "ana",
     -- "ANA PAULA" é mais provável do que "MARIANA".
     (public.chave_nome(c.full_name) like public.chave_nome(p_termo) || '%') desc,
     c.full_name
   limit greatest(coalesce(p_limite, 8), 1)
$bc$;

grant execute on function public.chave_busca(text) to authenticated;
grant execute on function public.chave_fonetica(text) to authenticated;
grant execute on function public.chave_nome(text) to authenticated;
grant execute on function public.buscar_contatos(text, integer) to authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Diagnósticos DA CIRURGIA (um ou mais)
-- ===========================================================================
-- O CID do catálogo do procedimento é o típico daquela cirurgia. O da CIRURGIA
-- é o do paciente: a mesma herniorrafia sai com K40.9 num caso e K40.2 no
-- outro, e é esse que vai na guia e nas cartas.
--
-- Por isso vira tabela e não coluna: "um ou mais" não cabe num campo de texto
-- sem alguém ter de separar por vírgula e o programa ter de adivinhar de novo.
create table if not exists public.cirurgia_cids (
  id uuid primary key default gen_random_uuid(),
  cirurgia_id uuid not null references public.cirurgias(id) on delete cascade,
  codigo text,
  descricao text not null,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cirurgia_cids_cir_idx on public.cirurgia_cids (cirurgia_id, ordem);

alter table public.cirurgia_cids enable row level security;
drop policy if exists "cirurgia_cids_rw" on public.cirurgia_cids;
create policy "cirurgia_cids_rw" on public.cirurgia_cids
  for all to authenticated using (true) with check (true);
