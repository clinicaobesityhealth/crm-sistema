'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Copy, FileText, Loader2, Send, Trash2, Upload, CalendarDays, AlertCircle, CheckCircle2 } from 'lucide-react'

// v48.59 — Descrição cirúrgica (RGO) dentro do cartão da cirurgia.
//   - o link que vai no evento do Google Agenda (o cirurgião manda a foto por ele)
//   - os arquivos que já chegaram
//   - anexar à mão (quando chegou por WhatsApp/e-mail)
//   - enviar ao paciente para ele pedir o reembolso
// Anexar ou enviar marca a cirurgia como REALIZADA (regra da clínica).

type Arquivo = { url: string; nome?: string; tipo?: string; categoria?: string; enviado_em?: string; por?: string }

export default function DescricaoCirurgica({ cirurgiaId, onRealizada }: {
  cirurgiaId: string
  onRealizada?: (s: { status: string; status_id: string | null; categoria: string }) => void
}) {
  const [c, setC] = useState<any>(null)
  const [ocupado, setOcupado] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function carregar() {
    const { data } = await supabase.from('cirurgias')
      .select('id, status, status_id, categoria, rgo_token, rgo_arquivos, rgo_recebida_em, rgo_enviada_paciente_em, rgo_concluida_em, rgo_observacoes, agenda_eventos, agenda_erro, agenda_sync_em, contact_id')
      .eq('id', cirurgiaId).maybeSingle()
    setC(data)
    return data
  }
  useEffect(() => { carregar() }, [cirurgiaId])

  async function depois() {
    const d = await carregar()
    if (d && onRealizada) onRealizada({ status: d.status, status_id: d.status_id, categoria: d.categoria })
  }

  async function chamar(corpo: BodyInit, json: boolean) {
    const { data: { session } } = await supabase.auth.getSession()
    const r = await fetch(`/api/cirurgias/${cirurgiaId}/rgo`, {
      method: 'POST', body: corpo,
      headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
    return j
  }

  async function anexar(files: FileList | null) {
    if (!files?.length) return
    setOcupado('anexar'); setMsg(null)
    const fd = new FormData(); Array.from(files).forEach(f => fd.append('arquivos', f))
    try { await chamar(fd, false); setMsg({ ok: true, texto: 'Anexado. A cirurgia foi marcada como realizada.' }); await depois() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
    setOcupado('')
    if (input.current) input.current.value = ''
  }

  async function enviar() {
    if (!window.confirm('Enviar a descrição cirúrgica ao paciente pelo WhatsApp?')) return
    setOcupado('enviar'); setMsg(null)
    try { await chamar(JSON.stringify({ acao: 'enviar' }), true); setMsg({ ok: true, texto: 'Enviada ao paciente.' }); await depois() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
    setOcupado('')
  }

  async function remover(a: Arquivo) {
    if (!window.confirm('Remover este arquivo da cirurgia?')) return
    setOcupado('remover')
    try { await chamar(JSON.stringify({ acao: 'remover', url: a.url }), true); await carregar() }
    catch (e: any) { setMsg({ ok: false, texto: e.message }) }
    setOcupado('')
  }

  if (!c) return null
  if (c.rgo_token === undefined) return null  // migração ainda não rodada

  const arquivos: Arquivo[] = Array.isArray(c.rgo_arquivos) ? c.rgo_arquivos : []
  const link = c.rgo_token ? `${typeof window !== 'undefined' ? window.location.origin : 'https://crm.obesityhealth.com.br'}/rgo/${c.rgo_token}` : ''
  const naAgenda = Object.keys(c.agenda_eventos || {}).length

  return (
    <div className="bg-slate-50 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><FileText size={13}/> Descrição cirúrgica (RGO)</p>
        {c.rgo_enviada_paciente_em
          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">enviada ao paciente {new Date(c.rgo_enviada_paciente_em).toLocaleDateString('pt-BR')}</span>
          : arquivos.length
            ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {c.rgo_concluida_em ? 'concluída pelo cirurgião — falta enviar ao paciente' : 'em andamento — o cirurgião ainda pode trocar as fotos'}
              </span>
            : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">aguardando</span>}
      </div>

      {arquivos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {arquivos.map(a => (
            <div key={a.url} className="relative group border border-slate-200 rounded-lg overflow-hidden bg-white">
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="block aspect-[3/4]">
                {String(a.tipo || '').startsWith('image/')
                  ? <img src={a.url} alt={a.nome || 'descrição'} className="w-full h-full object-cover"/>
                  : <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 text-[10px] p-1 text-center"><FileText size={20}/>{a.nome || 'PDF'}</div>}
              </a>
              <span className={'absolute bottom-1 left-1 text-[9px] font-semibold px-1 rounded ' + (a.categoria === 'documento' ? 'bg-slate-700/80 text-white' : 'bg-emerald-600/90 text-white')}>
                {a.categoria === 'documento' ? 'DOC' : 'RGO'}
              </span>
              <button onClick={() => remover(a)} title="Remover"
                className="absolute top-1 right-1 p-1 rounded bg-white/90 text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100"><Trash2 size={11}/></button>
            </div>
          ))}
        </div>
      )}

      {c.rgo_observacoes && (
        <div className="bg-white border border-slate-200 rounded-lg px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">Observações do cirurgião</p>
          <p className="text-[11px] text-slate-700 whitespace-pre-wrap">{c.rgo_observacoes}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => anexar(e.target.files)}/>
        <button onClick={() => input.current?.click()} disabled={!!ocupado}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 disabled:opacity-50">
          {ocupado === 'anexar' ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>} Anexar
        </button>
        <button onClick={enviar} disabled={!!ocupado || !arquivos.some(a => a.categoria !== 'documento') || !c.contact_id}
          title={!c.contact_id ? 'Cirurgia sem paciente vinculado ao CRM' : ''}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white disabled:opacity-40">
          {ocupado === 'enviar' ? <Loader2 size={12} className="animate-spin"/> : <Send size={12}/>} Enviar ao paciente
        </button>
        {link && (
          <button onClick={() => { navigator.clipboard.writeText(link); setMsg({ ok: true, texto: 'Link copiado — é o mesmo que vai no evento da agenda.' }) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600">
            <Copy size={12}/> Link do cirurgião
          </button>
        )}
      </div>

      {!c.rgo_enviada_paciente_em && (!c.contact_id || !arquivos.some(a => a.categoria !== 'documento')) && (
        <p className="text-[11px] text-amber-700 flex items-start gap-1">
          <AlertCircle size={12} className="mt-0.5 flex-shrink-0"/>
          {!c.contact_id
            ? 'Para enviar ao paciente, esta cirurgia precisa estar ligada a um contato do CRM — abra a cirurgia e escolha o paciente.'
            : 'Ainda não há descrição cirúrgica: os "outros documentos" ficam só na clínica e não habilitam o envio.'}
        </p>
      )}

      {msg && (
        <p className={'text-[11px] flex items-start gap-1 ' + (msg.ok ? 'text-emerald-700' : 'text-red-600')}>
          {msg.ok ? <CheckCircle2 size={12} className="mt-0.5"/> : <AlertCircle size={12} className="mt-0.5"/>}{msg.texto}
        </p>
      )}

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <CalendarDays size={12}/>
        {c.agenda_erro
          ? <span className="text-red-600">Agenda: {c.agenda_erro}</span>
          : naAgenda
            ? `No Google Agenda (${naAgenda} agenda${naAgenda > 1 ? 's' : ''})`
            : 'Ainda não está no Google Agenda'}
      </p>
    </div>
  )
}
