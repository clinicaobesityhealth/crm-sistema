-- v43: conteúdo administrativo da Sofia, separado das regras técnicas do n8n.
-- A interface do CRM só lê e grava este documento JSON; ferramentas, credenciais,
-- regras de segurança e automações continuam protegidas dentro dos fluxos.
alter table public.clinic_settings
  add column if not exists sofia_config jsonb not null default '{}'::jsonb;

comment on column public.clinic_settings.sofia_config is
  'Conteúdo administrativo editável da Sofia. Não contém regras, credenciais ou configuração de ferramentas.';

update public.clinic_settings
set sofia_config = jsonb_build_object(
  'assistant_name', 'Sofia',
  'clinic_name', 'Obesity Health',
  'clinic_description', '',
  'general_prompt', '',
  'clinic_rules', '',
  'service_safety_rules', '',
  'professionals', '[]'::jsonb,
  'service_hours', '',
  'address', '',
  'phone', '',
  'email', '',
  'site_url', '',
  'uber_url', '',
  'waze_url', '',
  'google_maps_url', '',
  'google_review_url', '',
  'google_review_enabled', false,
  'updated_at', now()
)
where sofia_config = '{}'::jsonb;
