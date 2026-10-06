'use client'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'

// v48.76 — O link que os cirurgiões recebem.
//
// Um link só para todos: cada um escolhe o próprio nome ao abrir, e o aparelho
// lembra da escolha. Foi a decisão da clínica — um endereço por médico seria
// mais preciso e bem mais chato de distribuir e repor.
//
// Trocar a chave invalida o link antigo na hora. É o que fazer quando um link
// vaza ou quando um cirurgião sai da equipe.

type Cfg = {
  ativa?: boolean; token?: string
  status_preop?: string; status_agendar?: string; status_cancelada?: string
}
type Situacao = { id: string; nome: string }

export default function LinkCirurgiaoAba() {
  const [id, setId] = useState<string | null>(null)
  const [cfg, setCfg] = useState<Cfg>({})
  const [situacoes, setSituacoes] = useState<Situacao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState('')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [cs, st] = await Promise.all([
      supabase.from('clinic_settings').select('id, agenda_cirurgiao').limit(1),
      supabase.from('cirurgia_status').select('id, nome').eq('ativo', true).order('ordem'),
    ])
    const linha: any = cs.data?.[0]
    if (linha) { setId(linha.id); setCfg(linha.agenda_cirurgiao || {}) }
    setSituacoes((st.data ?? []) as Situacao[])
    setCarregando(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  async function gravar(novo: Cfg) {
    if (!id) return
    setSalvando(true); setMsg('')
    const { error } = await supabase.from('clinic_settings').update({ agenda_cirurgiao: { ...cfg, ...novo } }).eq('id', id)
    setSalvando(false)
    if (error) {
      setMsg('Não foi possível salvar: ' + error.message + (/agenda_cirurgiao/.test(error.message) ? ' — falta rodar a migração 20260924_agenda_cirurgiao_v48_76.sql.' : ''))
      return
    }
    setCfg(c => ({ ...c, ...novo }))
    setMsg('Salvo.')
    setTimeout(() => setMsg(''), 2500)
  }

  function novaChave() {
    if (!window.confirm('Trocar a chave invalida o link atual na hora. Os cirurgiões precisarão do endereço novo. Continuar?')) return
    // 10 caracteres em letras e números: curto de ler numa mensagem e com
    // combinações demais para alguém tentar adivinhar.
    const alfabeto = 'abcdefghijkmnpqrstuvwxyz23456789'   // sem l, o, 0 e 1
    const curto = Array.from(crypto.getRandomValues(new Uint8Array(10)))
      .map(b => alfabeto[b % alfabeto.length]).join('')
    gravar({ token: curto })
  }

  const endereco = cfg.token
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://crm.obesityhealth.com.br'}/agendar-cirurgia/${cfg.token}`
    : ''

  if (carregando) return <div className="flex items-center gap-2 text-slate-400 py-10"><Loader2 size={16} className="animate-spin"/> Carregando...</div>

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-700">Agendamento pelo cirurgião</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Uma página curta onde o cirurgião lança a cirurgia direto, sem login. Ele escolhe entre
          pré-operatório, agendar e cancelada — o resto continua com a secretaria.
        </p>
      </div>

      <label className="flex items-start gap-2.5 bg-white border border-slate-100 rounded-xl px-4 py-3">
        <input type="checkbox" checked={!!cfg.ativa} onChange={e => gravar({ ativa: e.target.checked })} className="mt-0.5 rounded"/>
        <span>
          <span className="block text-sm font-medium text-slate-700">Link ligado</span>
          <span className="block text-xs text-slate-400">Desligado, o endereço para de funcionar para todo mundo.</span>
        </span>
      </label>

      <div className="bg-white border border-slate-100 rounded-xl px-4 py-3 space-y-2">
        <p className="text-xs font-semibold text-slate-600">Endereço para enviar aos cirurgiões</p>
        <div className="flex items-center gap-2">
          <input readOnly value={endereco} onFocus={e => e.currentTarget.select()}
            className="flex-1 min-w-0 px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg"/>
          <button onClick={() => { navigator.clipboard.writeText(endereco); setMsg('Link copiado.'); setTimeout(() => setMsg(''), 2500) }}
            className="px-3 py-2 rounded-lg border border-slate-200 text-slate-500 shrink-0"><Copy size={14}/></button>
        </div>
        <button onClick={novaChave} disabled={salvando}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-red-600 disabled:opacity-50">
          <RefreshCw size={11}/> trocar a chave (invalida o link atual)
        </button>
      </div>

      <div className="bg-white border border-slate-100 rounded-xl px-4 py-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-600">Para qual situação cada botão do cirurgião joga</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Os nomes vêm do cadastro de Situações. Renomear uma situação lá (ex.: trocar
            "solicitado" por "solicitar", para deixar claro que a secretaria ainda precisa agir)
            não quebra este mapeamento — continua apontando para a mesma situação.
          </p>
        </div>
        {([
          ['status_preop', 'Pré-operatório'],
          ['status_agendar', 'Agendar'],
          ['status_cancelada', 'Cancelada'],
        ] as const).map(([campo, rotulo]) => (
          <label key={campo} className="flex items-center gap-2.5">
            <span className="text-xs text-slate-500 w-28 shrink-0">Botão "{rotulo}"</span>
            <select value={cfg[campo] || ''} onChange={e => gravar({ [campo]: e.target.value } as Partial<Cfg>)}
              disabled={salvando}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">— nenhuma —</option>
              {situacoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
        ))}
      </div>

      {msg && <p className="text-xs text-slate-500 flex items-center gap-1"><Check size={12}/>{msg}</p>}
    </div>
  )
}
