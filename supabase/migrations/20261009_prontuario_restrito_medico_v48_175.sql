-- v48.175 — Prontuário restrito a médicos.
--
-- Pedido do Jorge: "esta área deve ser acessada só pelos médicos.. secretaria
-- não" — o Prontuário mostra histórico clínico, alergias e medicamentos do
-- paciente, dado sensível que não deveria estar aberto pra toda a equipe.
--
-- Mesmo desenho já usado para a agenda cirúrgica e a agenda pessoal
-- (20260915_convenios_v48_22.sql, 20260923_agenda_pessoal_v48_68.sql): fica
-- por CARGO, não por pessoa — administrador sempre vê, e quem entra na
-- equipe já nasce com o acesso certo conforme o cargo que tiver.
alter table public.job_titles add column if not exists ve_prontuario boolean not null default false;

-- Liga automaticamente para cargos que parecem "médico". Se algum cargo da
-- clínica não bater com esse texto (ex: "Clínico Geral"), o Jorge liga na
-- tela Configurações → Cargos.
update public.job_titles
   set ve_prontuario = true
 where lower(name) like '%médic%' or lower(name) like '%medic%';

notify pgrst, 'reload schema';
