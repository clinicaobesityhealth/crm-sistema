'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CheckCircle2, XCircle, Loader2, CalendarClock } from 'lucide-react'

// v46.86 — Página pública (sem login) do link de confirmação de consulta
// enviado por WhatsApp. Só conversa com app/api/confirmacao/[id] (que usa o
// cliente service_role) — esta página em si só usa o cliente anônimo pra
// buscar cor/logo da clínica (dado público, mesma consulta que a tela de
// login já faz).

type Dados = {
  paciente_nome: string
  profissional_nome: string
  data_br: string
  hora_br: string
  cancelada: boolean
  ja_confirmou: boolean
  ja_recusou: boolean
}

export default function ConfirmarConsultaPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  const [clinicName, setClinicName] = useState('Obesity Health')

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState<Dados | null>(null)
  const [enviando, setEnviando] = useState<'confirm' | 'decline' | null>(null)
  const [resultado, setResultado] = useState<'confirm' | 'decline' | null>(null)

  useEffect(() => {
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').single()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url)
        if (data?.primary_color) setPrimaryColor(data.primary_color)
        if (data?.clinic_name) setClinicName(data.clinic_name)
      })
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true); setErro('')
    fetch(`/api/confirmacao/${id}`)
      .then(async r => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error || 'Não foi possível carregar os dados da consulta.')
        return body
      })
      .then((body: Dados) => {
        setDados(body)
        if (body.ja_confirmou) setResultado('confirm')
        else if (body.ja_recusou) setResultado('decline')
      })
      .catch(e => setErro(e?.message || 'Não foi possível carregar os dados da consulta.'))
      .finally(() => setLoading(false))
  }, [id])

  async function enviar(action: 'confirm' | 'decline') {
    if (!id || enviando) return
    setEnviando(action); setErro('')
    try {
      const r = await fetch(`/api/confirmacao/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error || 'Não foi possível registrar sua resposta.')
      setResultado(action)
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível registrar sua resposta. Tente novamente ou fale com a secretária.')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-y-auto flex items-center justify-center px-3 py-8" style={{ background: `linear-gradient(135deg, ${primaryColor}dd, ${primaryColor}88)` }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          {logoUrl ? <img src={logoUrl} alt="Logo" className="h-16 max-w-[230px] w-auto object-contain drop-shadow-lg mx-auto mb-2"/> :
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-3 border border-white/20"><span className="text-white text-2xl font-bold">O</span></div>}
          <h1 className="text-xl font-bold text-white">{clinicName}</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-5 sm:p-6">
          {loading && (
            <div className="flex flex-col items-center py-10 text-slate-400">
              <Loader2 size={28} className="animate-spin mb-3"/>
              <p className="text-sm">Carregando...</p>
            </div>
          )}

          {!loading && erro && !dados && (
            <div className="text-center py-6">
              <XCircle size={36} className="text-red-400 mx-auto mb-3"/>
              <p className="text-sm text-slate-600">{erro}</p>
            </div>
          )}

          {!loading && dados && (
            <>
              <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5">
                <CalendarClock size={18} className="text-slate-500 mt-0.5 flex-shrink-0"/>
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {dados.data_br}{dados.hora_br ? ` às ${dados.hora_br}` : ''}
                  </p>
                  {dados.profissional_nome && <p className="text-xs text-slate-500 mt-0.5">Com {dados.profissional_nome}</p>}
                  {dados.cancelada && (
                    <p className="text-xs text-amber-600 font-medium mt-1.5">Atenção: esta consulta consta como cancelada no nosso sistema. Se isso for um engano, fale com a secretária.</p>
                  )}
                </div>
              </div>

              {resultado === 'confirm' ? (
                <div className="text-center py-4">
                  <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3"/>
                  <p className="text-sm font-semibold text-slate-800">Presença confirmada!</p>
                  <p className="text-xs text-slate-500 mt-1">Te esperamos na data e horário acima. Até lá!</p>
                </div>
              ) : resultado === 'decline' ? (
                <div className="text-center py-4">
                  <CheckCircle2 size={40} className="text-amber-500 mx-auto mb-3"/>
                  <p className="text-sm font-semibold text-slate-800">Recebemos seu aviso.</p>
                  <p className="text-xs text-slate-500 mt-1">Sem problemas — nossa equipe já foi avisada e vai te ajudar a remarcar por aqui mesmo no WhatsApp.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-4">Você poderá comparecer a esta consulta?</p>
                  <div className="flex flex-col gap-2">
                    <button onClick={() => enviar('confirm')} disabled={!!enviando}
                      className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold rounded-xl px-4 py-3 transition-colors">
                      {enviando === 'confirm' ? <Loader2 size={16} className="animate-spin"/> : <CheckCircle2 size={16}/>}
                      Sim, vou comparecer
                    </button>
                    <button onClick={() => enviar('decline')} disabled={!!enviando}
                      className="flex items-center justify-center gap-2 bg-white hover:bg-amber-50 disabled:opacity-60 text-amber-700 text-sm font-semibold rounded-xl px-4 py-3 border border-amber-300 transition-colors">
                      {enviando === 'decline' ? <Loader2 size={16} className="animate-spin"/> : <XCircle size={16}/>}
                      Não vou poder, quero remarcar
                    </button>
                  </div>
                  {erro && <p className="text-xs text-red-600 mt-3 text-center">{erro}</p>}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
