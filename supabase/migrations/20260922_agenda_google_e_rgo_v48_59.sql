-- v48.59 — Cirurgias no Google Agenda direto pelo CRM + descrição cirúrgica (RGO).
--
-- Rode quando quiser. Pode rodar mais de uma vez. NADA muda sozinho: a agenda
-- só começa a ser mexida quando a chave for ligada em Configurações →
-- Cirurgias → Google Agenda (e o gatilho da planilha for desligado, para não
-- haver evento duplicado).
--
-- COMO FUNCIONA
--   Qualquer mudança numa cirurgia (tela, Sofia, sincronização da planilha)
--   avisa o n8n pelo próprio banco. O n8n cria, altera ou apaga o evento na
--   agenda do cirurgião e na agenda geral da Obesity, igual ao que a planilha
--   fazia: título "⏰ PACIENTE - CIRURGIA - CIRURGIÃO", 1 hora, local = hospital,
--   descrição com medicações, observação, WhatsApp do paciente e o link da
--   descrição cirúrgica. Situações de cancelamento/remarcação tiram o evento.

-- 1) Configuração -----------------------------------------------------------
alter table public.clinic_settings add column if not exists agenda_cirurgica jsonb
  default '{"ativa": false, "calendario_geral": ""}'::jsonb;

-- 2) Onde a cirurgia está em cada agenda: { "<id da agenda>": "<id do evento>" }
alter table public.cirurgias add column if not exists agenda_eventos jsonb not null default '{}'::jsonb;
alter table public.cirurgias add column if not exists agenda_sync_em timestamptz;
alter table public.cirurgias add column if not exists agenda_erro text;

-- 3) Descrição cirúrgica (RGO) ------------------------------------------------
--    Um link por cirurgia, com uma chave que não dá para adivinhar. É o link
--    que vai dentro do evento da agenda: o cirurgião abre no celular no dia,
--    fotografa a descrição e pronto — a cirurgia vira "realizada".
alter table public.cirurgias add column if not exists rgo_token text;
alter table public.cirurgias add column if not exists rgo_arquivos jsonb not null default '[]'::jsonb;  -- [{url, nome, tipo, enviado_em}]
alter table public.cirurgias add column if not exists rgo_recebida_em timestamptz;
alter table public.cirurgias add column if not exists rgo_enviada_paciente_em timestamptz;

update public.cirurgias set rgo_token = replace(gen_random_uuid()::text, '-', '')
 where rgo_token is null;
alter table public.cirurgias alter column rgo_token set default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists idx_cirurgias_rgo_token on public.cirurgias(rgo_token);

insert into storage.buckets (id, name, public) values ('rgo', 'rgo', true)
on conflict (id) do nothing;

-- 4) Aviso ao n8n a cada mudança que importa para a agenda ---------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.crm_avisar_agenda_cirurgia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ativa boolean;
  corpo jsonb;
begin
  select coalesce((agenda_cirurgica ->> 'ativa')::boolean, false) into ativa
    from public.clinic_settings limit 1;
  if not coalesce(ativa, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    corpo := jsonb_build_object('op', 'delete', 'id', old.id, 'eventos', old.agenda_eventos);
  else
    if tg_op = 'UPDATE' and
       (new.paciente_nome, new.paciente_telefone, new.data_cirurgia, new.hora, new.status,
        new.categoria, new.procedimento_nome, new.procedimento_sigla, new.hospital,
        new.cirurgiao, new.cirurgiao_id, new.observacao, new.medicacoes)
       is not distinct from
       (old.paciente_nome, old.paciente_telefone, old.data_cirurgia, old.hora, old.status,
        old.categoria, old.procedimento_nome, old.procedimento_sigla, old.hospital,
        old.cirurgiao, old.cirurgiao_id, old.observacao, old.medicacoes) then
      return new;  -- nada que apareça na agenda mudou
    end if;
    corpo := jsonb_build_object('op', lower(tg_op), 'id', new.id);
  end if;

  perform net.http_post(
    url := 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/crm-cirurgia-agenda',
    body := corpo,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return coalesce(new, old);
exception when others then
  -- A agenda nunca pode impedir de salvar uma cirurgia.
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_crm_agenda_cirurgia on public.cirurgias;
create trigger trg_crm_agenda_cirurgia
after insert or update or delete on public.cirurgias
for each row execute function public.crm_avisar_agenda_cirurgia();

notify pgrst, 'reload schema';

select 'ok' as agenda_google_e_rgo;
