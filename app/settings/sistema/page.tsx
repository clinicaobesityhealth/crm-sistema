'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Save, Loader2, Smartphone, AlertCircle, KeyRound } from 'lucide-react'
import { MINUTOS_PADRAO, MINUTOS_MAXIMO, normalizarMinutos } from '@/lib/tempoDeSessao'

// v48.47 — Configurações do sistema.
//
// Começa com uma só: quanto tempo de tela parada até o CRM encerrar a sessão no
// celular. Era um número escrito no código, e quem sabe o tempo certo é quem
// atende no balcão — não quem escreveu o programa.

export default function SistemaSettingsPage() {
  const [minutos, setMinutos] = useState(String(MINUTOS_PADRAO))
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  // v48.112 — Código exigido para completar o "Criar cadastro" da tela de
  // login. Sem isso, qualquer pessoa que caia no domínio do CRM (paciente
  // incluso — é o mesmo domínio dos links de confirmação) consegue abrir um
  // pedido de aprovação como se fosse atendente nova. Vazio = sem exigência
  // (como sempre foi). Este campo nunca mostra o código salvo de volta —
  // só se está definido ou não — e cada "Salvar" troca o código.
  const [codigoDefinido, setCodigoDefinido] = useState(false)
  const [novoCodigo, setNovoCodigo] = useState('')
  const [salvandoCodigo, setSalvandoCodigo] = useState(false)
  const [salvoCodigo, setSalvoCodigo] = useState(false)
  const [erroCodigo, setErroCodigo] = useState('')

  async function salvarCodigo() {
    setSalvandoCodigo(true); setErroCodigo(''); setSalvoCodigo(false)
    const { error } = await supabase.rpc('definir_codigo_convite_equipe', { novo_codigo: novoCodigo.trim() })
    setSalvandoCodigo(false)
    if (error) { setErroCodigo('Não foi possível salvar: ' + error.message); return }
    setCodigoDefinido(!!novoCodigo.trim())
    setNovoCodigo('')
    setSalvoCodigo(true)
    setTimeout(() => setSalvoCodigo(false), 2500)
  }

  useEffect(() => {
    supabase.rpc('codigo_convite_equipe_exigido').then(({ data }) => setCodigoDefinido(!!data))
  }, [])

  useEffect(() => {
    supabase.from('clinic_settings').select('id, mobile_logout_minutes').limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error) setErro('Não consegui ler as configurações: ' + error.message)
        if (data) {
          setSettingsId((data as any).id)
          const v = (data as any).mobile_logout_minutes
          if (v !== null && v !== undefined) setMinutos(String(v))
        }
        setCarregando(false)
      })
  }, [])

  async function salvar() {
    setSalvando(true); setErro(''); setSalvo(false)
    const valor = normalizarMinutos(minutos === '' ? MINUTOS_PADRAO : Number(minutos))
    const { error } = settingsId
      ? await supabase.from('clinic_settings').update({ mobile_logout_minutes: valor }).eq('id', settingsId)
      : await supabase.from('clinic_settings').insert({ mobile_logout_minutes: valor })
    setSalvando(false)
    if (error) { setErro('Não foi possível salvar: ' + error.message); return }
    setMinutos(String(valor))
    setSalvo(true)
    setTimeout(() => setSalvo(false), 2500)
  }

  const valorAtual = normalizarMinutos(minutos === '' ? MINUTOS_PADRAO : Number(minutos))

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4">
          <h1 className="text-lg font-semibold text-slate-800">Sistema</h1>
          <p className="text-xs text-slate-400 mt-0.5">Ajustes gerais do CRM</p>
        </div>

        <div className="max-w-3xl px-6 py-8 space-y-5">
          <div className="bg-white border border-slate-100 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-slate-100 p-2 text-slate-500 shrink-0"><Smartphone size={18}/></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-800">Encerrar sessão no celular</h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Tempo sem ninguém tocar na tela até o CRM pedir o login de novo. Vale só no celular —
                  no computador nada muda. Celular fica em cima do balcão, é emprestado, é esquecido
                  destravado: por isso este limite existe.
                </p>

                <div className="mt-4 flex items-end gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">Minutos</label>
                    <input
                      value={minutos}
                      onChange={e => setMinutos(e.target.value.replace(/[^0-9]/g, ''))}
                      inputMode="numeric"
                      disabled={carregando}
                      className="w-28 px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-50"/>
                  </div>
                  <button onClick={salvar} disabled={salvando || carregando}
                    className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {salvando ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} {salvo ? 'Salvo!' : 'Salvar'}
                  </button>
                </div>

                {/* O que o número escolhido significa, dito em português. Um
                    campo numérico sozinho não avisa quando alguém digita 0. */}
                <p className="mt-3 text-xs text-slate-500">
                  {valorAtual === 0
                    ? 'Com 0, a sessão no celular nunca é encerrada por inatividade. Quem abrir o aparelho entra direto no CRM.'
                    : `A sessão será encerrada depois de ${valorAtual} minuto${valorAtual > 1 ? 's' : ''} sem uso.`}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Entre 0 e {MINUTOS_MAXIMO} minutos. Deixe em branco para voltar ao padrão de {MINUTOS_PADRAO}.
                  A mudança vale no próximo carregamento do CRM em cada aparelho.
                </p>

                {erro && (
                  <p className="mt-3 text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle size={13}/>{erro}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-100 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-slate-100 p-2 text-slate-500 shrink-0"><KeyRound size={18}/></div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-slate-800">Código para novo cadastro</h2>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  A tela de login tem um "Criar cadastro" aberto para qualquer pessoa — é assim que uma
                  atendente nova pede acesso. Mas é o mesmo domínio dos links que o paciente recebe, e de vez
                  em quando alguém cai lá por engano e "se cadastra" achando que precisa. Defina um código
                  aqui e avise a equipe por fora (WhatsApp, verbal) — sem o código, o cadastro não completa.
                </p>

                <p className="mt-2 text-xs font-medium text-slate-600">
                  {codigoDefinido ? 'Um código está definido agora.' : 'Nenhum código definido — o cadastro continua livre, como sempre foi.'}
                </p>

                <div className="mt-3 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      {codigoDefinido ? 'Trocar o código' : 'Definir um código'}
                    </label>
                    <input
                      value={novoCodigo}
                      onChange={e => setNovoCodigo(e.target.value)}
                      placeholder="Deixe em branco para remover a exigência"
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg"/>
                  </div>
                  <button onClick={salvarCodigo} disabled={salvandoCodigo}
                    className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    {salvandoCodigo ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} {salvoCodigo ? 'Salvo!' : 'Salvar'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  Por segurança, o código salvo não aparece mais aqui — só se está definido ou não. Salvar em
                  branco remove a exigência e volta ao cadastro livre.
                </p>

                {erroCodigo && (
                  <p className="mt-3 text-xs text-red-600 flex items-center gap-1.5">
                    <AlertCircle size={13}/>{erroCodigo}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
