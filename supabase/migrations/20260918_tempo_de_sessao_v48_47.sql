-- v48.47 — O tempo de sessão no celular deixa de ser um número escondido no código.
--
-- Rode quando quiser. Pode rodar mais de uma vez.
--
-- No celular, o CRM encerra a sessão depois de um tempo sem ninguém tocar na
-- tela. Isso existe por segurança: celular fica em cima do balcão, é emprestado,
-- é esquecido destravado. O problema é que esse tempo estava escrito no código —
-- trinta minutos, decididos uma vez, sem ninguém para discordar.
--
-- Agora é uma configuração da clínica. Zero desliga o encerramento automático.

alter table public.clinic_settings
  add column if not exists mobile_logout_minutes integer;

comment on column public.clinic_settings.mobile_logout_minutes is
  'Minutos sem interação até encerrar a sessão no celular. 0 desliga. Vazio usa o padrão de 30.';

-- Quem já usava o sistema continua com o comportamento de sempre, agora
-- explícito em vez de implícito.
update public.clinic_settings
   set mobile_logout_minutes = 30
 where mobile_logout_minutes is null;

notify pgrst, 'reload schema';

select id, mobile_logout_minutes from public.clinic_settings;
