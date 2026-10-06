'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AlertCircle, CalendarDays, Check, Loader2, RefreshCw, Save } from 'lucide-react'

// v48.59 — Cirurgias no Google Agenda, direto pelo CRM (substitui o gatilho
// "onEditAgenda" da planilha). Aqui fica a chave que liga tudo, a agenda geral
// da Obesity e a conferência de qual cirurgião já tem agenda cadastrada.

type Membro = { id: string; nome_curto: string; funcao: string | null; agenda_externa: string | null; ativo: boolean }

export default function GoogleAgendaAba() {
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [ativa, setAtiva] = useState(false)
  const [geral, setGeral] = useState('')
  const [equipe, setEquipe] = useState<Membro[]>([])
  const [erros, setErros] = useState<{ id: string; paciente_nome: string; data_cirurgia: string; agenda_erro: string }[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')
  const [sinc, setSinc] = useState(false)
  const [agendas, setAgendas] = useState<Record<string, string>>({})

  async function salvarAgenda(m: Membro) {
    const v = (agendas[m.id] ?? '').trim()
    const { error } = await supabase.from('cirurgia_equipe').update({ agenda_externa: v || null }).eq('id', m.id)
    if (error) { setMsg('Não foi possível salvar a agenda de ' + m.nome_curto + ': ' + error.message); return }
    setEquipe(eq => eq.map(x => x.id === m.id ? { ...x, agenda_externa: v || null } : x))
    setAgendas(a => { const n = { ...a }; delete n[m.id]; return n })
    setMsg('Agenda de ' + m.nome_curto + ' salva.')
  }

  async function carregar() {
    setCarregando(true)
    const [s, e, er] = await Promise.all([
      supabase.from('clinic_settings').select('*').limit(1),
      supabase.from('cirurgia_equipe').select('id, nome_curto, funcao, agenda_externa, ativo').eq('ativo', true).order('ordem'),
      supabase.from('cirurgias').select('id, paciente_nome, data_cirurgia, agenda_erro').not('agenda_erro', 'is', null)
        .gte('data_cirurgia', new Date().toISOString().slice(0, 10)).limit(20),
    ])
    const linha: any = s.data?.[0]
    if (linha) {
      setSettingsId(linha.id)
      const cfg = linha.agenda_cirurgica || {}
      setAtiva(!!cfg.ativa); setGeral(cfg.calendario_geral || '')
    }
    setEquipe((e.data ?? []) as any)
    setErros((er.data ?? []) as any)
    setCarregando(false)
  }
  useEffect(() => { carregar() }, [])

  async function salvar() {
    if (!settingsId) return
    setSalvando(true); setMsg('')
    const { error } = await supabase.from('clinic_settings')
      .update({ agenda_cirurgica: { ativa, calendario_geral: geral.trim() } }).eq('id', settingsId)
    setSalvando(false)
    setMsg(error ? 'Não foi possível salvar: ' + error.message + (/agenda_cirurgica/.test(error.message) ? ' — falta rodar a migração 20260922_agenda_google_e_rgo_v48_59.sql.' : '') : 'Salvo.')
  }

  async function sincronizarTodas() {
    setSinc(true); setMsg('')
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const r = await fetch('/api/cirurgias/agenda', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } })
      const j = await r.json().catch(() => ({}))
      setMsg(r.ok ? `Enviadas ${j.enviadas} cirurgia(s) para a agenda${j.falhas ? `, ${j.falhas} com falha` : ''}. Em alguns segundos os eventos aparecem.` : (j.erro || 'Falhou.'))
    } catch (e: any) { setMsg('Falhou: ' + (e?.message || e)) }
    setSinc(false)
    setTimeout(carregar, 8000)
  }

  if (carregando) return <div className="flex items-center gap-2 text-slate-400 py-10"><Loader2 size={16} className="animate-spin"/> Carregando...</div>

  const cirurgioes = equipe.filter(m => /CIRURG/i.test(m.funcao || ''))
  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400'

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><CalendarDays size={15} className="text-brand-600"/> Cirurgias no Google Agenda</p>
        <p className="text-xs text-slate-500 -mt-2">
          O CRM cria, altera e apaga o evento na agenda do cirurgião e na agenda geral da Obesity, na hora em que a
          cirurgia muda. Título "⏰ PACIENTE - CIRURGIA - CIRURGIÃO" (✅ autorizada, 🆗 realizada), 1 hora, local = hospital,
          e na descrição o WhatsApp do paciente e o link da descrição cirúrgica.
        </p>

        <label className="flex items-start gap-3 px-3.5 py-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer">
          <input type="checkbox" checked={ativa} onChange={e => setAtiva(e.target.checked)} className="mt-0.5 h-4 w-4 rounded"/>
          <span>
            <span className="block text-sm font-medium text-amber-900">Ligar a agenda pelo CRM</span>
            <span className="block text-xs text-amber-700 mt-0.5">
              Antes de ligar, desligue o gatilho <strong>onEditAgenda</strong> da planilha (Apps Script → Acionadores).
              Com os dois ligados, a mesma cirurgia vira dois eventos.
            </span>
          </span>
        </label>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Agenda geral da Obesity (ID da agenda)</label>
          <input value={geral} onChange={e => setGeral(e.target.value)} className={inputClass} placeholder="xxxxxxxx@group.calendar.google.com"/>
          <p className="mt-1 text-xs text-slate-400">
            Google Agenda → Configurações da agenda → "Integrar agenda" → ID da agenda. Recebe todas as cirurgias. Em branco = não usa.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={salvar} disabled={salvando}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
            {salvando ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Salvar
          </button>
          <button onClick={sincronizarTodas} disabled={sinc || !ativa}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-lg disabled:opacity-40">
            {sinc ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>} Mandar as cirurgias futuras para a agenda
          </button>
        </div>
        {msg && <p className="text-xs text-slate-600">{msg}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Agenda de cada cirurgião</p>
        <p className="text-xs text-slate-500 -mt-1">Cole o ID da agenda de cada cirurgião e clique em Salvar (também fica na aba Equipe). Sem agenda, a cirurgia vai só para a agenda geral.</p>
        <div className="divide-y divide-slate-100">
          {cirurgioes.length === 0 && <p className="text-xs text-slate-400 py-2">Nenhum cirurgião ativo na equipe.</p>}
          {cirurgioes.map(m => (
            <div key={m.id} className="py-2 space-y-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-700">{m.nome_curto}</span>
                {m.agenda_externa
                  ? <span className="flex items-center gap-1 text-[11px] text-emerald-700"><Check size={12}/> agenda cadastrada</span>
                  : <span className="text-[11px] text-amber-600">sem agenda</span>}
              </div>
              <div className="flex gap-2">
                <input value={agendas[m.id] ?? m.agenda_externa ?? ''} onChange={e => setAgendas(a => ({ ...a, [m.id]: e.target.value }))}
                  placeholder="ID da agenda do Google" className={inputClass + ' text-xs'}/>
                {(agendas[m.id] ?? m.agenda_externa ?? '') !== (m.agenda_externa ?? '') && (
                  <button onClick={() => salvarAgenda(m)} className="px-3 py-1.5 rounded-lg bg-brand-600 text-white text-xs font-semibold flex-shrink-0">Salvar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {erros.length > 0 && (
        <div className="bg-white border border-red-200 rounded-2xl p-5 space-y-2">
          <p className="text-sm font-semibold text-red-700 flex items-center gap-2"><AlertCircle size={15}/> Cirurgias que não foram para a agenda</p>
          {erros.map(e => (
            <p key={e.id} className="text-xs text-slate-600"><strong>{e.paciente_nome}</strong> ({e.data_cirurgia?.split('-').reverse().join('/')}): {e.agenda_erro}</p>
          ))}
        </div>
      )}
    </div>
  )
}
