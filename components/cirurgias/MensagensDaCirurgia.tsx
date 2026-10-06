'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, CalendarClock, Check, AlertCircle, Send, X } from 'lucide-react'

// v48.09 — Estado das mensagens de pré e pós desta cirurgia.
//
// Antes, programar as mensagens de uma cirurgia que já existia exigia um
// comando no banco. Agora é um botão — e, o que importa mais, o estado fica
// visível: ou as mensagens aparecem com data e hora, ou o botão está ali
// esperando. Nunca "não se sabe".
//
// Quando o botão não consegue programar, a tela diz POR QUÊ. Um botão que
// parece não fazer nada é pior do que não ter botão.

type Msg = {
  id: string
  reminder_type: string | null
  scheduled_for: string
  status: string
  content: string
}

const NOME_TIPO: Record<string, string> = {
  cirurgia_pre: 'Pré-operatório',
  cirurgia_pos: 'Pós-operatório',
}

const ATIVAS = ['scheduled', 'pending']

export default function MensagensDaCirurgia({
  cirurgiaId, contactId, dataCirurgia, status,
}: {
  cirurgiaId: string
  contactId: string | null
  dataCirurgia: string
  status: string
}) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [carregando, setCarregando] = useState(true)
  const [programando, setProgramando] = useState(false)
  const [motivo, setMotivo] = useState('')

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('scheduled_messages')
      .select('id, reminder_type, scheduled_for, status, content')
      .eq('cirurgia_id', cirurgiaId)
      .order('scheduled_for')
    setMsgs((data ?? []) as Msg[])
    setCarregando(false)
  }, [cirurgiaId])

  useEffect(() => { carregar() }, [carregar])

  // Programar é só tocar na cirurgia: o gatilho do banco faz o resto. A regra
  // de quando e o que enviar mora num lugar só — se estivesse repetida aqui,
  // um dia as duas cópias discordariam.
  async function programar() {
    setProgramando(true); setMotivo('')
    const { error } = await supabase.from('cirurgias')
      .update({ updated_at: new Date().toISOString() }).eq('id', cirurgiaId)
    if (error) { setProgramando(false); setMotivo('Não foi possível programar: ' + error.message); return }

    const { data } = await supabase.from('scheduled_messages')
      .select('id, reminder_type, scheduled_for, status, content')
      .eq('cirurgia_id', cirurgiaId).order('scheduled_for')
    const novas = (data ?? []) as Msg[]
    setMsgs(novas)
    setProgramando(false)

    if (novas.filter(m => ATIVAS.includes(m.status)).length === 0) {
      setMotivo(await descobrirMotivo(contactId, dataCirurgia, status))
    }
  }

  async function cancelar(id: string) {
    if (!confirm('Cancelar esta mensagem? Ela não será enviada.')) return
    await supabase.from('scheduled_messages')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', id)
    carregar()
  }

  const ativas = msgs.filter(m => ATIVAS.includes(m.status))
  const enviadas = msgs.filter(m => m.status === 'sent')

  const quando = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">Mensagens de pré e pós-operatório</p>

      {carregando ? (
        <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin"/> Carregando...</div>
      ) : ativas.length > 0 || enviadas.length > 0 ? (
        <div className="space-y-1.5">
          {[...enviadas, ...ativas].map(m => {
            const foi = m.status === 'sent'
            return (
              <div key={m.id} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2">
                {foi
                  ? <Check size={14} className="text-emerald-500 shrink-0"/>
                  : <CalendarClock size={14} className="text-brand-500 shrink-0"/>}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700">
                    {NOME_TIPO[m.reminder_type ?? ''] || 'Mensagem'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {foi ? 'enviada em ' : 'programada para '}{quando(m.scheduled_for)}
                  </p>
                </div>
                {!foi && (
                  <button onClick={() => cancelar(m.id)} title="Cancelar esta mensagem"
                    className="p-1 text-slate-300 hover:text-red-500 shrink-0"><X size={14}/></button>
                )}
              </div>
            )
          })}
          <p className="text-[11px] text-slate-400">
            Remarcar a cirurgia refaz estas datas sozinho. Cancelar a cirurgia derruba as pendentes.
          </p>
        </div>
      ) : (
        <>
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
        </>
      )}

      {motivo && (
        <div className="mt-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle size={14} className="text-amber-600 shrink-0 mt-0.5"/>
          <p className="text-[11px] text-amber-800">{motivo}</p>
        </div>
      )}
    </div>
  )
}

// Por que nada foi programado. Vale a pena consultar o banco para responder:
// a alternativa é o usuário apertar o botão, não ver nada acontecer, e concluir
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
