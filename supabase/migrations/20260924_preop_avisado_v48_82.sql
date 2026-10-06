-- v48.82 — Registrar que o paciente parado já foi cobrado.
--
-- Rode depois da 20260923_avisos_e_retorno_v48_67.sql. Pode rodar de novo.
--
-- A mensagem do pré-operatório parado já passa pela secretária antes de sair —
-- isso a v48.67 resolveu. O que faltava era a outra metade: depois de enviada,
-- ninguém sabia. A cirurgia continuava aparecendo igual às demais, e no mês
-- seguinte o sistema perguntava de novo. Cobrar o mesmo paciente todo mês é o
-- jeito mais rápido de ele parar de responder.

alter table public.cirurgias
  add column if not exists preop_avisado_em timestamptz,
  add column if not exists preop_avisos integer not null default 0;

-- A varredura passa a respeitar o intervalo do próprio modelo: quem foi
-- cobrado há menos tempo do que "dias parado" não entra de novo na fila.
create or replace function public.avisar_cirurgias_paradas()
returns integer
language plpgsql
security definer
set search_path = public
as $par$
declare
  m public.cirurgia_mensagens;
  c public.cirurgias;
  v_desde timestamptz;
  v_dias integer;
  v_criados integer := 0;
begin
  for m in select * from public.cirurgia_mensagens where ativo and quando = 'parado' loop
    continue when coalesce(btrim(m.disparo_status), '') = '';
    v_dias := greatest(coalesce(m.dias_offset, 30), 1);

    for c in
      select cir.* from public.cirurgias cir
       where cir.contact_id is not null
         and upper(btrim(coalesce(cir.status, ''))) = upper(btrim(m.disparo_status))
         and coalesce(cir.categoria, '') not in ('cancelada', 'realizada')
         -- Já cobrado há pouco: fica de fora. O intervalo é o mesmo do modelo,
         -- então mexer em "dias parado" muda as duas coisas de uma vez.
         and (cir.preop_avisado_em is null
              or cir.preop_avisado_em <= now() - make_interval(days => v_dias))
    loop
      select coalesce(
               (select max(h.created_at) from public.cirurgia_historico h
                 where h.cirurgia_id = c.id and h.status_novo = c.status),
               c.created_at)
        into v_desde;

      continue when v_desde > now() - make_interval(days => v_dias);

      insert into public.cirurgia_avisos (cirurgia_id, contact_id, tipo, titulo, texto, chave)
      values (
        c.id, c.contact_id, m.tipo, m.titulo,
        public.mensagem_cirurgia_texto(m.texto, c),
        'cirurgia_' || m.tipo || ':' || c.id::text || ':' || to_char(now(), 'YYYY-MM')
      )
      on conflict (chave) do nothing;

      if found then v_criados := v_criados + 1; end if;
    end loop;
  end loop;

  return v_criados;
end
$par$;

notify pgrst, 'reload schema';
