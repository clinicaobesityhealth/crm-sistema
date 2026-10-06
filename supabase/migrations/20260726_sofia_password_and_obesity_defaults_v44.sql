-- v44: segunda senha para a área da Sofia e restauração do conteúdo administrativo
-- da Obesity Health. O hash nunca é devolvido ao navegador.
create extension if not exists pgcrypto;

alter table public.clinic_settings
  add column if not exists sofia_admin_password_hash text;

update public.clinic_settings
set sofia_admin_password_hash = crypt('12345678', gen_salt('bf', 12))
where sofia_admin_password_hash is null;

revoke all on function public.is_crm_admin(uuid) from public;
grant execute on function public.is_crm_admin(uuid) to authenticated;

create or replace function public.verify_sofia_admin_password(candidate text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
declare stored_hash text;
begin
  if not public.is_crm_admin(auth.uid()) then return false; end if;
  select sofia_admin_password_hash into stored_hash from public.clinic_settings limit 1;
  return stored_hash is not null and stored_hash = crypt(candidate, stored_hash);
end;
$$;

create or replace function public.change_sofia_admin_password(current_password text, new_password text)
returns boolean language plpgsql security definer set search_path = public, extensions
as $$
begin
  if not public.is_crm_admin(auth.uid()) then raise exception 'Acesso negado'; end if;
  if length(coalesce(new_password, '')) < 8 then raise exception 'A nova senha deve ter pelo menos 8 caracteres'; end if;
  if not public.verify_sofia_admin_password(current_password) then return false; end if;
  update public.clinic_settings set sofia_admin_password_hash = crypt(new_password, gen_salt('bf', 12));
  return true;
end;
$$;

revoke all on function public.verify_sofia_admin_password(text) from public, anon;
revoke all on function public.change_sofia_admin_password(text, text) from public, anon;
grant execute on function public.verify_sofia_admin_password(text) to authenticated;
grant execute on function public.change_sofia_admin_password(text, text) to authenticated;

update public.clinic_settings
set sofia_config = coalesce(sofia_config, '{}'::jsonb) || jsonb_build_object(
  'assistant_name', 'Sofia',
  'clinic_name', 'Obesity Health',
  'clinic_description', 'Clínica especializada em cirurgia bariátrica e obesidade, cirurgia geral, gastrocirurgia, nutrição, nutrologia, modulação intestinal, emagrecimento e psicologia.',
  'general_prompt', $cfg$Seja acolhedora, breve e direta — o paciente está no WhatsApp. Responda em português brasileiro, com tom humano e profissional e mensagens curtas. Antes de perguntar, considere tudo o que o paciente já informou e nunca repita uma pergunta já respondida. Primeiro reconheça de forma humana e específica o conteúdo trazido; depois faça somente a próxima pergunta realmente necessária. Quando houver mensagens sequenciais, trate-as como uma única fala e responda uma única vez. Faça no máximo uma pergunta de continuidade por vez. Ajude o paciente a perceber o valor da consulta, da clínica e dos profissionais, principalmente se ele hesitar em agendar, questionar valores ou quiser desmarcar. Se pedir cancelamento, pergunte se deseja reagendar. Não seja insistente nem repetitiva.$cfg$,
  'clinic_rules', $cfg$Consultas: atendimento particular ou por reembolso. Emitimos nota fiscal em todas as consultas. Quando perguntarem sobre convênio ou reembolso, explique que existe a modalidade Sem Retorno, consulta avulsa com valor mais baixo, que costuma ficar próxima do reembolso do convênio, e ofereça o agendamento sem insistir repetidamente. Cirurgias: convênios podem ser utilizados para cobertura hospitalar e materiais; encaminhar os detalhes à secretária Daniella. Nunca fornecer orçamento de cirurgia; informar que a secretária Daniella cuida disso e oferecer avisá-la. O prédio possui estacionamento Estapar, sem desconto ou credenciamento com a clínica; só informar esses detalhes se o paciente perguntar especificamente. Para consulta presencial, primeiro confirme o agendamento e depois pergunte como o paciente pretende chegar. Envie os links de carro ou aplicativo somente após a resposta. Para consulta online, não envie endereço e informe que o link de acesso será enviado próximo ao horário marcado.$cfg$,
  'service_safety_rules', $cfg$Nunca forneça telefone ou dado pessoal de outro paciente ou de um profissional. Nunca exponha CPF, RG ou telefone na conversa; quando precisar confirmar, peça ao próprio paciente e compare com o cadastro. Oriente situações de emergência ao Pronto-Socorro. Não forneça diagnóstico, prescrição, opinião clínica ou palpite médico. Preserve a privacidade e encaminhe decisões clínicas ao profissional responsável.$cfg$,
  'professionals', jsonb_build_array(
    jsonb_build_object('name','Dr. João Jorge','specialty','Cirurgia Bariátrica e Metabólica; Cirurgia do Aparelho Digestivo; Cirurgia Geral; Gastroenterologia','details',''),
    jsonb_build_object('name','Dr. Giovanni Capozzielli','specialty','Cirurgia Bariátrica e Metabólica; Cirurgia do Aparelho Digestivo; Cirurgia Geral; Gastroenterologia','details',''),
    jsonb_build_object('name','Dr. Marcello Trivino','specialty','Proctologia; Cirurgia Bariátrica e Metabólica; Cirurgia do Aparelho Digestivo; Cirurgia Geral; Gastroenterologia','details',''),
    jsonb_build_object('name','Dra. Mariana Marasca','specialty','Nutrologia; Modulação Intestinal; Medicina Intensiva','details',''),
    jsonb_build_object('name','Priscilla','specialty','Nutricionista','details',''),
    jsonb_build_object('name','Alessandra','specialty','Psicóloga','details','')
  ),
  'service_hours', 'Segunda a sexta, das 09h às 18h. Sábado, das 09h às 12h.',
  'address', 'Rua Alvorada, 1289, Conj. 1706 — Vila Olímpia, São Paulo/SP',
  'phone', '(11) 2361-4796 | (11) 94598-4912',
  'email', 'clinica@obesityhealth.com.br',
  'site_url', 'https://obesityhealth.com.br',
  'google_maps_url', 'https://bit.ly/googlemaps_obesityhealth',
  'waze_url', 'https://bit.ly/waze_obesityhealth',
  'uber_url', 'https://bit.ly/3TxRaOm',
  'google_review_url', coalesce(sofia_config->>'google_review_url', ''),
  'google_review_enabled', false,
  'updated_at', now()
);
