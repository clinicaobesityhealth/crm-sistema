'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Check, ChevronDown, Loader2, MessageSquare, Send, Trash2, X, CalendarClock, AlertCircle } from 'lucide-react'

// v48.161 — "Mensagens ao paciente" e "Mensagens de pré e pós-operatório"
// eram dois cartões separados (MensagensEnviadas.tsx e MensagensDaCirurgia.tsx),
// um em cima e outro mais embaixo na tela de Editar cirurgia, com a descrição
// cirúrgica no meio dos dois. Pedido do Jorge: um campo só, "Mensagem ao
// paciente", com tudo. Este componente substitui os dois.
//
// Continua vindo de dois lugares — as cartas avulsas (cirurgia_avisos: pedido
// ao hospital, autorização...) e a agenda automática (scheduled_messages:
// pré-op, pós-op, retorno, suspensão de remédio) — porque são sistemas
// diferentes por baixo, mas a pessoa que olha a tela não precisa saber disso:
// tudo aparece junto, do mais recente para o mais antigo.
//
// O que mudou de verdade em relação aos dois componentes antigos: antes, uma
// mensagem agendada (pré-op, pós-op...) aparecia só para LER — cancelar exigia
// rolar até o outro cartão, mais embaixo. Agora o mesmo clique que abre uma
// carta pendente para editar também abre uma mensagem agendada para cancelar.
// Já enviada continua só para ver (verdinho), sem editar — não faz sentido
// mexer no que já saiu.

type LinhaAviso = {
  chave: string; titulo: string; quando: string | null; tipo: 'aviso'
  estadoReal: 'pendente' | 'descartado' | 'enviado'
  estado: 'enviada' | 'pendente'; avisoId: string; texto: string
}
type LinhaAgenda = {
  chave: string; titulo: string; quando: string | null; tipo: 'agendada'
  estado: 'enviada' | 'agendada'; msgId: string
}
type Linha = LinhaAviso | LinhaAgenda

const ROTULOS: Record<string, string> = {
  cirurgia_agendada: 'Cirurgia solicitada ao hospital',
  cirurgia_autorizada: 'Cirurgia autorizada pelo convênio',
  cirurgia_pre: 'Pré-operatório',
  cirurgia_pos: 'Pós-operatório',
  cirurgia_retorno: 'Retorno pós-operatório',
  cirurgia_preop_parado: 'Pré-operatório parado',
  // Sem o prefixo "cirurgia_": vem de agendar_lembrete_medicamento(), não de
  // um modelo em cirurgia_mensagens (ver migração v48.132).
  medicacao_suspender: 'Suspensão de medicamento',
}

const ATIVAS = ['scheduled', 'pending']

export default function MensagemAoPaciente({
  cirurgiaId, contactId, dataCirurgia, status,
}: {
  cirurgiaId: string
  contactId: string | null
  dataCirurgia: string
  status: string
}) {
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [semNenhumaAgendada, setSemNenhumaAgendada] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [aberta, setAberta] = useState<string>('')
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState('')
  const [erro, setErro] = useState('')
  const [programando, setProgramando] = useState(false)
  const [motivoProgramar, setMotivoProgramar] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [av, ag] = await Promise.all([
      supabase.from('cirurgia_avisos').select('id, titulo, tipo, status, texto, decidido_em, criado_em')
        .eq('cirurgia_id', cirurgiaId).order('criado_em', { ascending: false }),
      supabase.from('scheduled_messages').select('id, reminder_type, status, scheduled_for')
        .eq('cirurgia_id', cirurgiaId).order('scheduled_for', { ascending: false }),
    ])
    setSemNenhumaAgendada((ag.data ?? []).length === 0)

    // Só o mais recente de cada tipo de aviso — o histórico de ciclos
    // anteriores (solicitada → autorizada → voltou → autorizada de novo...)
    // não ajuda a decidir o que fazer agora.
    const avisosPorTipo = new Map<string, any>()
    for (const a of (av.data ?? []) as any[]) {
      // Tarefa interna da equipe, não mensagem ao paciente — não entra aqui
      // (ver AvisoCirurgiaNotification.tsx).
      if (a.tipo === 'medicamentos_pendentes') continue
      if (!avisosPorTipo.has(a.tipo)) avisosPorTipo.set(a.tipo, a)
    }
    const saida: Linha[] = []
    for (const a of avisosPorTipo.values()) {
      const enviado = a.status === 'enviado'
      saida.push({
        chave: 'aviso:' + a.tipo, avisoId: a.id, texto: a.texto || '',
        titulo: a.titulo || ROTULOS['cirurgia_' + a.tipo] || a.tipo,
        quando: a.decidido_em || a.criado_em,
        tipo: 'aviso', estadoReal: a.status, estado: enviado ? 'enviada' : 'pendente',
      })
    }

    const agendaPorTipo = new Map<string, any>()
    for (const s of (ag.data ?? []) as any[]) {
      if (!['sent', ...ATIVAS].includes(s.status)) continue
      if (!agendaPorTipo.has(s.reminder_type)) agendaPorTipo.set(s.reminder_type, s)
    }
    for (const s of agendaPorTipo.values()) {
      saida.push({
        chave: 'agenda:' + s.reminder_type, msgId: s.id,
        titulo: ROTULOS[s.reminder_type] || s.reminder_type,
        quando: s.scheduled_for, tipo: 'agendada',
        estado: s.status === 'sent' ? 'enviada' : 'agendada',
      })
    }
    saida.sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')))
    setLinhas(saida)
    setCarregando(false)
  }, [cirurgiaId])

  useEffect(() => { carregar() }, [carregar])

  function abrir(chave: string, textoInicial: string) {
    if (aberta === chave) { setAberta(''); return }
    setAberta(chave); setTexto(textoInicial); setErro('')
  }

  async function chamarApi(avisoId: string, acao: 'enviar' | 'reenviar' | 'excluir', textoEnvio?: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch('/api/cirurgias/avisos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ id: avisoId, acao, texto: textoEnvio }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  }

  async function enviarAviso(l: LinhaAviso) {
    const acao = l.estadoReal === 'descartado' ? 'reenviar' : 'enviar'
    setOcupado('enviar' + l.chave); setErro('')
    try {
      await chamarApi(l.avisoId, acao, texto)
      setAberta('')
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setOcupado('')
  }

  async function excluirAviso(l: LinhaAviso) {
    setOcupado('excluir' + l.chave); setErro('')
    try {
      await chamarApi(l.avisoId, 'excluir')
      setAberta('')
      await carregar()
    } catch (e: any) { setErro(e?.message || 'Não foi possível.') }
    setOcupado('')
  }

  // Cancelar uma mensagem agendada (pré-op, pós-op, retorno, suspensão de
  // remédio) é direto no banco, sem passar pela API de avisos — mesma lógica
  // que já existia em MensagensDaCirurgia.tsx.
  async function cancelarAgendada(l: LinhaAgenda) {
    setOcupado('cancelar' + l.chave); setErro('')
    const { error } = await supabase.from('scheduled_messages')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', l.msgId)
    setOcupado('')
    if (error) { setErro('Não foi possível cancelar: ' + error.message); return }
    setAberta('')
    await carregar()
  }

  // Programar é só tocar na cirurgia: o gatilho do banco faz o resto. A regra
  // de quando e o que enviar mora num lugar só — repeti-la aqui faria as duas
  // cópias discordarem um dia.
  async function programar() {
    setProgramando(true); setMotivoProgramar('')
    const { error } = await supabase.from('cirurgias')
      .update({ updated_at: new Date().toISOString() }).eq('id', cirurgiaId)
    if (error) { setProgramando(false); setMotivoProgramar('Não foi possível programar: ' + error.message); return }
    await carregar()
    setProgramando(false)
    const { data } = await supabase.from('scheduled_messages').select('status').eq('cirurgia_id', cirurgiaId)
    const novas = (data ?? []) as { status: string }[]
    if (novas.filter(m => ATIVAS.includes(m.status)).length === 0) {
      setMotivoProgramar(await descobrirMotivo(contactId, dataCirurgia, status))
    }
  }

  if (carregando) {
    return (
      <div className="bg-slate-50 rounded-xl p-3">
        <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-2"><MessageSquare size={13}/> Mensagem ao paciente</p>
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin"/> Carregando...</div>
      </div>
    )
  }

  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><MessageSquare size={13}/> Mensagem ao paciente</p>

      {linhas.length > 0 && (
        <ul className="space-y-1">
          {linhas.map(l => {
            const clicavel = (l.tipo === 'aviso' && l.estado === 'pendente') || (l.tipo === 'agendada' && l.estado === 'agendada')
            const expandida = clicavel && aberta === l.chave
            return (
              <li key={l.chave} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div
                  className={'flex items-center gap-2 px-2.5 py-1.5' + (clicavel ? ' cursor-pointer' : '')}
                  onClick={() => clicavel && abrir(l.chave, l.tipo === 'aviso' ? l.texto : '')}>
                  {l.estado === 'enviada'
                    ? <Check size={12} className="text-emerald-600 shrink-0"/>
                    : l.estado === 'agendada'
                      ? <CalendarClock size={12} className="text-brand-500 shrink-0"/>
                      : <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"/>}
                  <span className="text-[11px] text-slate-700 flex-1 min-w-0 truncate">{l.titulo}</span>
                  <span className={'text-[10px] shrink-0 ' + (l.estado === 'enviada' ? 'text-emerald-600 font-semibold' : l.estado === 'pendente' ? 'text-amber-600 font-semibold' : 'text-slate-400')}>
                    {l.estado === 'enviada' ? 'enviada' : l.estado === 'agendada' ? 'programada' : l.estado}
                    {l.quando ? ' · ' + new Date(l.quando).toLocaleDateString('pt-BR') : ''}
                  </span>
                  {clicavel && <ChevronDown size={12} className={'text-slate-300 shrink-0 transition-transform' + (expandida ? ' rotate-180' : '')}/>}
                </div>

                {expandida && l.tipo === 'aviso' && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-slate-100">
                    <p className="text-[10px] text-slate-400">
                      {l.estadoReal === 'pendente'
                        ? 'Esperando decisão — revise e mande, ou apague para começar de novo.'
                        : 'Ainda não enviada — revise e mande, ou apague de vez.'}
                    </p>
                    <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={5}
                      className="w-full px-2.5 py-2 text-[12px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 leading-5 resize-y"/>
                    {erro && <p className="text-[11px] text-red-600">{erro}</p>}
                    <div className="flex gap-1.5">
                      <button onClick={() => enviarAviso(l)} disabled={!!ocupado || !texto.trim()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold disabled:opacity-40">
                        {ocupado === 'enviar' + l.chave ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>} Enviar agora
                      </button>
                      <button onClick={() => excluirAviso(l)} disabled={!!ocupado}
                        title="Apagar esta pendência — a próxima mudança de situação gera uma nova"
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium disabled:opacity-50">
                        {ocupado === 'excluir' + l.chave ? <Loader2 size={12} className="animate-spin"/> : <Trash2 size={12}/>} Apagar
                      </button>
                      <button onClick={() => setAberta('')} disabled={!!ocupado}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[12px] disabled:opacity-50">
                        <X size={12}/>
                      </button>
                    </div>
                  </div>
                )}

                {expandida && l.tipo === 'agendada' && (
                  <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-slate-100">
                    <p className="text-[10px] text-slate-400">
                      Sai sozinha em {l.quando ? new Date(l.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'breve'}.
                      Remarcar a cirurgia refaz esta data sozinho.
                    </p>
                    {erro && <p className="text-[11px] text-red-600">{erro}</p>}
                    <div className="flex gap-1.5">
                      <button onClick={() => cancelarAgendada(l)} disabled={!!ocupado}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-medium disabled:opacity-50">
                        {ocupado === 'cancelar' + l.chave ? <Loader2 size={12} className="animate-spin"/> : <X size={12}/>} Cancelar esta mensagem
                      </button>
                      <button onClick={() => setAberta('')} disabled={!!ocupado}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-[12px] disabled:opacity-50">
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Só faz sentido oferecer "programar" quando não existe NENHUMA
          mensagem agendada ainda — cirurgia antiga, de antes dos modelos
          automáticos estarem ligados. */}
      {semNenhumaAgendada && (
        <div className={linhas.length > 0 ? 'pt-1' : ''}>
          <button type="button" onClick={programar} disabled={programando}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-brand-200 bg-white text-brand-700 text-sm font-semibold disabled:opacity-50">
            {programando
              ? <><Loader2 size={15} className="animate-spin"/> Programando...</>
              : <><Send size={15}/> Programar mensagens de pré e pós</>}
          </button>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Normalmente elas se programam sozinhas quando a cirurgia é autorizada. Este botão serve para
            as cirurgias que já existiam antes de os modelos serem ligados.
          </p>
        </div>
      )}

      {!linhas.length && !semNenhumaAgendada && (
        <p className="text-[11px] text-slate-400">Nenhuma mensagem ainda.</p>
      )}

      {motivoProgramar && (
        <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5"/>
          <p className="text-[11px] text-amber-800">{motivoProgramar}</p>
        </div>
      )}
    </div>
  )
}

// Por que nada foi programado. Vale consultar o banco para responder: a
// alternativa é a pessoa apertar o botão, não ver nada acontecer, e concluir
// que o sistema está quebrado.
async function descobrirMotivo(contactId: string | null, dataCirurgia: string, status: string): Promise<string> {
  const { data: modelos } = await supabase.from('cirurgia_mensagens').select('id, ativo, dias_offset')
  const ligados = (modelos ?? []).filter((m: any) => m.ativo)
  if (ligados.length === 0) {
    return 'Os modelos de mensagem estão desligados. Ligue em Configurações → Cad. Cirurgias → Mensagens e tente de novo.'
  }

  if (!contactId) {
    return 'Esta cirurgia não está vinculada a um paciente do cadastro. Sem o contato, não há para onde enviar — escolha o paciente no campo acima e salve.'
  }

  if (!dataCirurgia) {
    return 'A cirurgia está sem data. As mensagens são calculadas a partir dela.'
  }

  const { data: st } = await supabase.from('cirurgia_status')
    .select('nome, dispara_mensagens').eq('nome', status).limit(1)
  const disp = st?.[0]?.dispara_mensagens
  if (!disp) {
    const { data: gatilho } = await supabase.from('cirurgia_status')
      .select('nome').eq('dispara_mensagens', true).limit(1)
    const nomeGatilho = gatilho?.[0]?.nome || 'a situação marcada com o sino'
    return `A situação "${status}" não dispara mensagens. Elas são programadas quando a cirurgia chega em "${nomeGatilho}".`
  }

  // Chegou até aqui: modelos ligados, paciente, data e situação certos. Só
  // resta a data já ter passado.
  const base = new Date(dataCirurgia + 'T12:00:00')
  const fora = ligados.every((m: any) => {
    const d = new Date(base); d.setDate(d.getDate() + Number(m.dias_offset))
    return d.getTime() <= Date.now()
  })
  if (fora) {
    return 'As datas de envio já passaram. O sistema não agenda mensagem para o passado — nesse caso o contato precisa ser feito à mão.'
  }

  return 'Nada foi programado e não identifiquei o motivo. Vale me avisar para eu investigar.'
}
