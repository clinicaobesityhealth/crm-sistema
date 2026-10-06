-- v48.01 — Cadastros da agenda de cirurgias.
--
-- Rode este SQL no editor do Supabase ANTES de subir o zip.
-- Ele só cria coisas novas: não altera nem apaga nada que já existe.
--
-- O que este arquivo cria é a BASE do módulo de cirurgias: as listas que hoje
-- moram nas abas DADOS e DADOS CARTAS da planilha "CIRURGIAS OBESITY".
-- A partir daqui o CRM tem os dados dele próprio — a planilha continua viva,
-- mas deixa de ser a dona da informação.
--
-- Uma decisão que vale explicar: na planilha, o TUSS e o CID vivem dentro do
-- texto do nome da cirurgia ("HERNIORRAFIA UMBILICAL (TUSS 31009166)"). Aqui
-- eles saem para tabelas próprias, uma linha por código. Isso é necessário
-- porque uma cirurgia pode ter MAIS DE UM TUSS — o cisto sacro-coccígeo tem
-- dois, as hemorroidas têm três — e porque a guia do convênio e a carta pedem
-- o número isolado, não o nome com o número no meio.

-- ===========================================================================
-- 1) Procedimentos (abreviação, nome, valores, materiais)
-- ===========================================================================
create table if not exists public.cirurgia_procedimentos (
  id uuid primary key default gen_random_uuid(),

  -- sigla: a abreviação que a equipe já usa (BP, Sleeve, HIB, HVvideo...).
  -- É por ela que a secretária encontra a cirurgia na hora de lançar.
  sigla text not null,
  nome  text not null,

  valor_equipe      numeric(10,2) not null default 0,
  valor_anestesista numeric(10,2) not null default 0,

  materiais   text,
  orientacoes text,
  empresas    text,

  ativo boolean not null default true,
  ordem integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_cirurgia_proc_sigla
  on public.cirurgia_procedimentos (lower(sigla));

create table if not exists public.cirurgia_proc_tuss (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.cirurgia_procedimentos(id) on delete cascade,
  codigo text not null,
  descricao text,
  ordem integer not null default 0
);
create index if not exists idx_cirurgia_tuss_proc on public.cirurgia_proc_tuss(procedimento_id);
create index if not exists idx_cirurgia_tuss_codigo on public.cirurgia_proc_tuss(codigo);

create table if not exists public.cirurgia_proc_cid (
  id uuid primary key default gen_random_uuid(),
  procedimento_id uuid not null references public.cirurgia_procedimentos(id) on delete cascade,
  codigo text not null,
  descricao text,
  ordem integer not null default 0
);
create index if not exists idx_cirurgia_cid_proc on public.cirurgia_proc_cid(procedimento_id);

-- ===========================================================================
-- 2) Listas auxiliares (aba DADOS)
-- ===========================================================================
create table if not exists public.cirurgia_hospitais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index if not exists idx_cirurgia_hospitais_nome on public.cirurgia_hospitais (lower(nome));

-- A equipe cirúrgica. Não são usuários do CRM: são as pessoas que entram na
-- carta e na distribuição de honorários (cirurgião, auxiliar, instrumentador).
create table if not exists public.cirurgia_equipe (
  id uuid primary key default gen_random_uuid(),
  nome_curto    text not null,          -- DR. JOÃO JORGE
  nome_completo text,                   -- DR. JOÃO JORGE DE BARROS NETO
  documento     text,                   -- CRM 109958 / CPF ...
  especialidade text,
  funcao        text,                   -- CIRURGIÃO, INSTRUMENTADOR, ...
  telefone      text,                   -- usado nos links de WhatsApp das cartas
  agenda_externa text,                  -- id da agenda Google, enquanto existir
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index if not exists idx_cirurgia_equipe_nome on public.cirurgia_equipe (lower(nome_curto));

-- Situação da cirurgia (coluna L da aba DADOS).
-- categoria agrupa o que a planilha resolve com abas separadas:
--   aberta     -> ainda em andamento (fica na lista principal)
--   realizada  -> foi feita
--   cancelada  -> não vai acontecer
create table if not exists public.cirurgia_status (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'aberta',
  cor text not null default '#64748b',
  -- Marca a situação que dispara as mensagens de pré e pós-operatório.
  -- Hoje, na planilha, isso é AUTORIZADA — mas fica configurável.
  dispara_mensagens boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index if not exists idx_cirurgia_status_nome on public.cirurgia_status (lower(nome));

create table if not exists public.cirurgia_modalidades (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index if not exists idx_cirurgia_modalidades_nome on public.cirurgia_modalidades (lower(nome));

create table if not exists public.cirurgia_formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  ordem integer not null default 0
);
create unique index if not exists idx_cirurgia_formas_nome on public.cirurgia_formas_pagamento (lower(nome));

-- ===========================================================================
-- 3) Permissões
-- ===========================================================================
-- Mesmo desenho das outras telas de Configurações: quem está logado no CRM lê
-- e escreve. Quem não está logado não enxerga nada.
do $perm$
declare t text;
begin
  foreach t in array array[
    'cirurgia_procedimentos','cirurgia_proc_tuss','cirurgia_proc_cid',
    'cirurgia_hospitais','cirurgia_equipe','cirurgia_status',
    'cirurgia_modalidades','cirurgia_formas_pagamento'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s_rw" on public.%I', t, t);
    execute format(
      'create policy "%s_rw" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end
$perm$;

-- ===========================================================================
-- 4) Carga inicial
-- ===========================================================================
-- Tudo aqui é "só se ainda não existir". Rodar este arquivo duas vezes não
-- duplica nada e não desfaz nenhuma edição feita na tela.

-- Função auxiliar: cria um procedimento com seus TUSS e CIDs.
create or replace function public.seed_cirurgia_procedimento(
  p_sigla text, p_nome text, p_equipe numeric, p_anest numeric,
  p_materiais text, p_empresas text, p_ordem integer,
  p_tuss jsonb, p_cid jsonb
) returns void language plpgsql as $fn$
declare
  v_id uuid;
  v_item jsonb;
  v_i integer := 0;
begin
  select id into v_id from public.cirurgia_procedimentos where lower(sigla) = lower(p_sigla);
  if v_id is not null then return; end if;   -- já existe: não mexe

  insert into public.cirurgia_procedimentos
    (sigla, nome, valor_equipe, valor_anestesista, materiais, empresas, ordem)
  values
    (p_sigla, p_nome, p_equipe, p_anest,
     nullif(p_materiais, ''), nullif(p_empresas, ''), p_ordem)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_tuss) loop
    v_i := v_i + 1;
    insert into public.cirurgia_proc_tuss (procedimento_id, codigo, descricao, ordem)
    values (v_id, v_item->>0, v_item->>1, v_i);
  end loop;

  v_i := 0;
  for v_item in select * from jsonb_array_elements(p_cid) loop
    v_i := v_i + 1;
    insert into public.cirurgia_proc_cid (procedimento_id, codigo, descricao, ordem)
    values (v_id, v_item->>0, v_item->>1, v_i);
  end loop;
end
$fn$;

do $seed$
begin
  perform public.seed_cirurgia_procedimento(
    $T$BP$T$, $T$Gastroplastia por Videolaparoscopia (By pass Gastro-jejunal)$T$, 18000, 2500,
    $T$* 1 unidade - Agulha de Veres - UV120
* 1 unidade - Trocarte descartável 12/5mm Xcel - K12LT
* 1 unidade - Grampeador Elétrico (Echelon Powered) 60mm - PSE60A
* 3 unidades - Cargas Azuis 60 mm - GST60B
* 3 unidades - Cargas Brancas 60mm - GST60W
* 1 unidade - Tesoura Coaguladora Ultracision (Harmonic) - HAR36
* 1 unidade - Clip Horizon 3200
* 1 unidade - Meia massageadora pneumática anti-trombótica (Sequel)$T$, $T$MEDTRONIC, ETHICON E TC CIRURGICA$T$, 1,
    $T$[["31002390", "Gastroplastia por videolaparoscopia"]]$T$::jsonb,
    $T$[["E66", "Obesidade"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$BXHEPÁTICA$T$, $T$Biópsia Hepática por Videolaparoscopia$T$, 3500, 0,
    $T$$T$, $T$MEDTRONIC, BARD$T$, 2,
    $T$[["31005675", "Biópsia hepática por videolaparoscopia"]]$T$::jsonb,
    $T$[["K76", "Esteato-hepatite não alcoólica"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$CCC$T$, $T$Colecistectomia com Colangiografia por Videolaparoscopia$T$, 10000, 2000,
    $T$* 1 unidade - Trocarte 11/5mm (D11LT)
* 1 unidade - Agulha de Veres (UV120)
* 2 unidades - Clip Horizon 3200$T$, $T$$T$, 3,
    $T$[["31005470", "Colecistectomia com colangiografia por videolaparoscopia"]]$T$::jsonb,
    $T$[["K81.1", "Colecistopatia crônica"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$CS$T$, $T$Cisto sacro-coccígeo - tratamento cirúrgico$T$, 6000, 0,
    $T$* 1 unidade - Curativo Prevena customizável (PRE2055)
* 1 unidade - Reservatório de 300ml (M8275058)
* 1 unidade - Máquina ActiVAC
* 1 unidade - Placa de hidrocoloide 10x10cm$T$, $T$$T$, 4,
    $T$[["31009042", "Cisto sacro-coccígeo - tratamento cirúrgico"], ["30101522", "Extensos ferimentos, retalhos cutâneos da região sacro-coccígea"]]$T$::jsonb,
    $T$[["L05", "Cisto pilonidal com fístula cutânea"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HEPIGASTRICA$T$, $T$Herniorrafia Epigástrica$T$, 5000, 0,
    $T$Sem material$T$, $T$$T$, 5,
    $T$[["31009093", "Herniorrafia epigástrica"]]$T$::jsonb,
    $T$[["K43", "Hérnia epigástrica"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$Hemorroidas$T$, $T$Hemorroidectomia, Fissurectomia e Excisão de Plicoma$T$, 8000, 0,
    $T$Sem material$T$, $T$$T$, 6,
    $T$[["31004202", "Hemorroidectomia"], ["31004105", "Fissurectomia"], ["31004091", "Excisão de plicoma"]]$T$::jsonb,
    $T$[["K60", "Fissura anal"], ["I84.6", "Plicoma anal"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HH$T$, $T$Tratamento do Refluxo Gastro-esofageano$T$, 10000, 0,
    $T$* 1 unidade - Agulha de Veres (UV120)
* 1 unidade - Trocarte 11/5mm (D11LT)
* 1 unidade - Maryland Bipolar Ligasure 37 cm (LF1937)
* 1 unidade - Clip Horizon 3200$T$, $T$$T$, 7,
    $T$[["31001360", "Tratamento cirúrgico do refluxo gastro-esofageano"]]$T$::jsonb,
    $T$[["K21.0", "Doença do refluxo gastro-esofageano"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HIB$T$, $T$Herniorrafia Inguinal Bilateral por Videolaparoscopia$T$, 8000, 2500,
    $T$* 1 unidade - Agulha de Veres (UV120)
* 1 unidade - Trocarte 11/5mm (D11LT)
* 2 unidades - Tela Parietene (prolene) 15x15 cm (PP1515)
* 1 unidade - Grampeador absorvível Secure Strap 12 (Strap12)
* 2 unidades - Fio de sutura farpado Stratafix Espiral 3-0, 20 cm, Monocryl Plus (SXMP1B427)
* 1 unidade - Clip Horizon 3200$T$, $T$Ethicon, Medtronic$T$, 8,
    $T$[["31009336", "Herniorrafia inguinal por videolaparoscopia"]]$T$::jsonb,
    $T$[["K40.2", "Hérnia inguinal bilateral"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HID$T$, $T$Herniorrafia Inguinal Direita por Videolaparoscopia$T$, 6000, 0,
    $T$* 1 unidade - Agulha de Veres
* 1 unidade - Trocarte 12/5mm descartável
* 1 unidade - Tela Parietex 15x15 cm (PPM1515)
* 1 unidade - SecureStrap 15$T$, $T$$T$, 9,
    $T$[["31009336", "Herniorrafia inguinal por videolaparoscopia"]]$T$::jsonb,
    $T$[["K40.9", "Hérnia inguinal direita"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HIE$T$, $T$Herniorrafia Inguinal Esquerda por Videolaparoscopia$T$, 6000, 0,
    $T$* 1 unidade - Agulha de Veres
* 1 unidade - Trocarte 12/5mm descartável
* 1 unidade - Tela Parietex 15x15 cm (PPM1515)
* 1 unidade - SecureStrap 15$T$, $T$$T$, 10,
    $T$[["31009336", "Herniorrafia inguinal por videolaparoscopia"]]$T$::jsonb,
    $T$[["K40.9", "Hérnia inguinal esquerda"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HIEr$T$, $T$Herniorrafia Inguinal Esquerda - Robótica$T$, 8000, 2000,
    $T$* 1 unidade - Agulha de Veres
* 1 unidade - Trocarte 12/5mm descartável
* 1 unidade - Tela Parietene 15x15 cm (PPM1515)
* 1 unidade - Tela Parietex 30x30 cm (PPM3030)$T$, $T$$T$, 11,
    $T$[["31009336", "Herniorrafia inguinal por videolaparoscopia"]]$T$::jsonb,
    $T$[["K40.9", "Hérnia inguinal esquerda"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HIDr$T$, $T$Herniorrafia Inguinal Direita - Robótica$T$, 8000, 2000,
    $T$* 1 unidade - Agulha de Veres
* 1 unidade - Trocarte 12/5mm descartável
* 1 unidade - Tela Parietene 15x15 cm (PPM1515)
* 1 unidade - Tela Parietex 30x30 cm (PPM3030)$T$, $T$$T$, 12,
    $T$[["31009336", "Herniorrafia inguinal por videolaparoscopia"]]$T$::jsonb,
    $T$[["K40.9", "Hérnia inguinal direita"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HU$T$, $T$Herniorrafia Umbilical$T$, 5000, 1000,
    $T$Sem material$T$, $T$$T$, 13,
    $T$[["31009166", "Herniorrafia umbilical"]]$T$::jsonb,
    $T$[["K42.9", "Hérnia umbilical"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HVvideo$T$, $T$Herniorrafia Umbilical e Epigástrica por Videolaparoscopia$T$, 12500, 2000,
    $T$* 1 unidade - Agulha de Veres (UV120)
* 1 unidade - Trocarte 11/5mm (D11LT)
* 1 unidade - Tela Symbotex, Ventralight ST Echo PS ou Proceed
    Oval 20 x 25 cm (PCDH1)
    Quadrada 30,5 x 30,5 cm (PCDL1)
    Quadrada 15 x 15 cm (PCDM1)
    Retangular 7,5 x 15 cm (PCDR1)
* 1 unidade - Grampeador absorvível Secure Strap 25 (Strap25) ou Absorbatack 30$T$, $T$$T$, 14,
    $T$[["31009166", "Herniorrafia umbilical por videolaparoscopia"], ["31009093", "Herniorrafia epigástrica por videolaparoscopia"]]$T$::jsonb,
    $T$[["K43.9", "Hérnia ventral"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HINCISIONALr$T$, $T$Herniorrafia Recidivante Robótica$T$, 18800, 2000,
    $T$* 1 unidade - Agulha de Veres
* 1 unidade - Trocarte 12/5mm descartável
* 1 unidade - Tela Parietene 15x15 cm (PPM1515)
* 1 unidade - Tela Parietex 30x30 cm (PPM3030)$T$, $T$$T$, 15,
    $T$[["31009344", "Herniorrafia incisional / recidivante"]]$T$::jsonb,
    $T$[["K43.9", "Hérnia ventral recidivante"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HINCISIONAL$T$, $T$Herniorrafia Recidivante por Videolaparoscopia$T$, 16800, 2000,
    $T$* 1 unidade - Agulha de Veres (UV120)
* 1 unidade - Trocarte 11/5mm (D11LT)
* 1 unidade - Tela Proceed
    Oval 20 x 25 cm (PCDH1)
    Quadrada 30,5 x 30,5 cm (PCDL1)
    Quadrada 15 x 15 cm (PCDM1)
    Retangular 7,5 x 15 cm (PCDR1)
* 1 unidade - Grampeador absorvível Secure Strap 25 (Strap25)$T$, $T$$T$, 16,
    $T$[["31009344", "Herniorrafia incisional / recidivante"]]$T$::jsonb,
    $T$[["K43.9", "Hérnia ventral recidivante"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$HV$T$, $T$Herniorrafia Ventral por Videolaparoscopia$T$, 16800, 2000,
    $T$* 1 unidade - Agulha de Veres (UV120)
* 1 unidade - Trocarte 11/5mm (D11LT)
* 1 unidade - Tela Proceed
    Oval 20 x 25 cm (PCDH1)
    Quadrada 30,5 x 30,5 cm (PCDL1)
    Quadrada 15 x 15 cm (PCDM1)
    Retangular 7,5 x 15 cm (PCDR1)
* 1 unidade - Grampeador absorvível Secure Strap 25 (Strap25)$T$, $T$$T$, 17,
    $T$[["31009344", "Herniorrafia incisional / recidivante"]]$T$::jsonb,
    $T$[["K43.9", "Hérnia ventral"]]$T$::jsonb);
  perform public.seed_cirurgia_procedimento(
    $T$Sleeve$T$, $T$Gastroplastia por Videolaparoscopia (Sleeve)$T$, 18800, 3000,
    $T$* 1 unidade - Agulha de Veres (172016)
* 1 unidade - Trocarte descartável 12/5mm VersaOne sem lâmina (ONB12STF)
* 1 unidade - EndoGrampeador Elétrico (Signia) Medtronic (SIGNIA)
* 5 unidades - Cargas Roxas 60 mm (EGIA60AMT)
* 1 unidade - Carga Preta 60 mm (EGIA60AXT)
* 1 unidade - Selador de vasos Sonicision 48 cm (SCD48)
* 1 unidade - Clip Horizon 3200
* 1 unidade - Meia massageadora pneumática anti-trombótica (Sequel)$T$, $T$$T$, 18,
    $T$[["31002390", "Gastroplastia por videolaparoscopia"]]$T$::jsonb,
    $T$[["E66", "Obesidade"]]$T$::jsonb);
end
$seed$;

-- As listas auxiliares, vindas da aba DADOS.
insert into public.cirurgia_hospitais (nome, ordem) values
  ('BLANC', 1), ('SÃO LUIZ - ITAIM', 2), ('SÃO LUIZ - JABAQUARA', 3),
  ('VILA NOVA STAR', 4), ('EINSTEIN', 5), ('SANTA PAULA', 6), ('VITÓRIA', 7)
on conflict do nothing;

insert into public.cirurgia_modalidades (nome, ordem) values
  ('PARTICULAR TOTAL', 1), ('PARTICULAR COM CONVÊNIO', 2)
on conflict do nothing;

insert into public.cirurgia_formas_pagamento (nome, ordem) values
  ('DINHEIRO', 1), ('PIX', 2), ('SAFRA', 3), ('REDE', 4), ('TON', 5), ('LINK SAFRA', 6)
on conflict do nothing;

insert into public.cirurgia_equipe (nome_curto, nome_completo, documento, especialidade, funcao, ordem) values
  ('DR. GIOVANNI',   'DR. GIOVANNI CAPOZZIELLI',        'CRM 124333',           'Cirurgia bariátrica e cirurgia geral, robótica e videolaparoscopia', 'CIRURGIÃO', 1),
  ('DR. JOÃO JORGE', 'DR. JOÃO JORGE DE BARROS NETO',   'CRM 109958',           'Cirurgia bariátrica e cirurgia geral, robótica e videolaparoscopia', 'CIRURGIÃO', 2),
  ('DR. MARCELLO',   'DR. MARCELLO BIANCHI TRIVINO',    'CRM 105081',           'Cirurgia digestiva e proctologia, robótica e videolaparoscopia',     'CIRURGIÃO', 3),
  ('DR. PHILIPPE',   'DR. PHILIPE KEHDE MOUJAES',       'CRM 140494',           null,                                                                 'CIRURGIÃO', 4),
  ('GREICE',         'GREICE DOS SANTOS AMOR',          'CPF 279.285.848-67',   null,                                                                 'INSTRUMENTADOR', 5),
  ('GISELE',         'GISELE BERNARDO VALENTE',          null,                  null,                                                                 'INSTRUMENTADOR', 6)
on conflict do nothing;

-- A lista de situações, na ordem em que aparece na coluna L.
-- AUTORIZADA vem marcada como a que dispara as mensagens de pré e pós, que é
-- o comportamento atual do script da planilha.
insert into public.cirurgia_status (nome, categoria, cor, dispara_mensagens, ordem) values
  ('PRÉ-OPERATÓRIO',              'aberta',    '#0ea5e9', false,  1),
  ('AGENDAR',                     'aberta',    '#64748b', false,  2),
  ('SOLICITADO ORÇAMENTO',        'aberta',    '#f59e0b', false,  3),
  ('ORÇAMENTO APROVADO',          'aberta',    '#84cc16', false,  4),
  ('SOLICITADO AO HOSPITAL',      'aberta',    '#f59e0b', false,  5),
  ('SOLICITADO AO CONVÊNIO',      'aberta',    '#f59e0b', false,  6),
  ('PENDÊNCIA',                   'aberta',    '#ef4444', false,  7),
  ('ENVIADO RELATÓRIO',           'aberta',    '#8b5cf6', false,  8),
  ('AUTORIZADA',                  'aberta',    '#10b981', true,   9),
  ('CIRURGIA REALIZADA',          'realizada', '#059669', false, 10),
  ('REMARCADA PELO MÉDICO',       'aberta',    '#f97316', false, 11),
  ('REMARCADA PELO PACIENTE',     'aberta',    '#f97316', false, 12),
  ('REMARCADA PELO HOSPITAL',     'aberta',    '#f97316', false, 13),
  ('NEGADA PELO CONVÊNIO',        'cancelada', '#dc2626', false, 14),
  ('CANCELADA',                   'cancelada', '#dc2626', false, 15),
  ('AG. DOCUMENTOS',              'aberta',    '#64748b', false, 16),
  ('AG. PAGAMENTO 1° PARCELA',    'aberta',    '#64748b', false, 17),
  ('AG. PAGAMENTO 2° PARCELA',    'aberta',    '#64748b', false, 18),
  ('INDECISO',                    'aberta',    '#94a3b8', false, 19),
  ('AG. LAUDO VASECTOMIA',        'aberta',    '#64748b', false, 20),
  ('SEM RETORNO DO PAC',          'aberta',    '#94a3b8', false, 21)
on conflict do nothing;
