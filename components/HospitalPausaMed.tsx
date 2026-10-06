'use client'
import { useEffect, useRef, useState } from 'react'
import { Search, X, MapPin, Loader2, Clock } from 'lucide-react'

// v48.110 — Seletor de hospital usando a base nacional do PausaMed
// (hospital_directory, dados do CNES) em vez da lista própria do CRM. Grava
// o nome exatamente como o PausaMed usa — é isso que garante bater 100% na
// hora de resolver o remédio (ver lib/pausamed.ts, resolverMedicamento).
// Filtra por estado → cidade, tem atalho pros 3 últimos hospitais usados
// (guardado no navegador) e já abre com o último escolhido como padrão.
// Usado tanto no CRM (CirurgiaModal) quanto no link público do cirurgião —
// por isso fala com a API pública /api/pausamed/hospitais, sem depender de
// login.

export type HospitalValor = {
  nome: string
  cidade: string | null
  estado: string | null
  pausamedId: string | null
}

export const HOSPITAL_VAZIO: HospitalValor = { nome: '', cidade: null, estado: null, pausamedId: null }

const CHAVE_RECENTES = 'crm_hospitais_recentes_v1'

function lerRecentes(): HospitalValor[] {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]')
    return Array.isArray(j) ? j : []
  } catch { return [] }
}

export function lembrarHospitalUsado(h: HospitalValor) {
  if (!h?.nome) return
  try {
    const atuais = lerRecentes().filter(x => x.nome !== h.nome)
    atuais.unshift(h)
    localStorage.setItem(CHAVE_RECENTES, JSON.stringify(atuais.slice(0, 3)))
  } catch {}
}

export function ultimoHospitalUsado(): HospitalValor | null {
  const r = lerRecentes()
  return r[0] || null
}

async function buscarJson(url: string) {
  const r = await fetch(url, { cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`)
  return j
}

export default function HospitalPausaMed({ valor, onEscolher, className, placeholder }: {
  valor: HospitalValor
  onEscolher: (h: HospitalValor) => void
  className?: string
  placeholder?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [estados, setEstados] = useState<string[]>([])
  const [estado, setEstado] = useState('')
  const [cidades, setCidades] = useState<string[]>([])
  const [cidade, setCidade] = useState('')
  const [busca, setBusca] = useState('')
  const [hospitais, setHospitais] = useState<{ id: string; nome: string; cidade: string; estado: string }[]>([])
  const [carregandoCidades, setCarregandoCidades] = useState(false)
  const [carregandoHospitais, setCarregandoHospitais] = useState(false)
  const [erro, setErro] = useState('')
  const recentes = useState(() => lerRecentes())[0]
  const caixa = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  useEffect(() => {
    buscarJson('/api/pausamed/hospitais?modo=estados').then(j => setEstados(j.estados || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!estado) { setCidades([]); setCidade(''); return }
    setCarregandoCidades(true); setCidade('')
    buscarJson(`/api/pausamed/hospitais?modo=cidades&estado=${encodeURIComponent(estado)}`)
      .then(j => setCidades(j.cidades || []))
      .catch(e => setErro(e.message))
      .finally(() => setCarregandoCidades(false))
  }, [estado])

  useEffect(() => {
    if (!aberto) return
    if (!estado && busca.trim().length < 3) { setHospitais([]); return }
    const t = setTimeout(() => {
      setCarregandoHospitais(true); setErro('')
      const p = new URLSearchParams({ modo: 'hospitais' })
      if (estado) p.set('estado', estado)
      if (cidade) p.set('cidade', cidade)
      if (busca.trim()) p.set('busca', busca.trim())
      buscarJson(`/api/pausamed/hospitais?${p.toString()}`)
        .then(j => setHospitais(j.hospitais || []))
        .catch(e => setErro(e.message))
        .finally(() => setCarregandoHospitais(false))
    }, 300)
    return () => clearTimeout(t)
  }, [estado, cidade, busca, aberto])

  function escolher(h: HospitalValor) {
    lembrarHospitalUsado(h)
    onEscolher(h)
    setAberto(false); setBusca('')
  }

  const input = className || 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  if (valor?.nome && !aberto) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
        <MapPin size={14} className="text-slate-400 shrink-0"/>
        <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
          {valor.nome}
          {(valor.cidade || valor.estado) && (
            <span className="text-slate-400"> · {[valor.cidade, valor.estado].filter(Boolean).join(' - ')}</span>
          )}
        </span>
        <button type="button" onClick={() => setAberto(true)}
          className="p-1 text-slate-400 hover:text-slate-700 shrink-0"><X size={15}/></button>
      </div>
    )
  }

  return (
    <div ref={caixa} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300"/>
        <input value={busca} onChange={e => setBusca(e.target.value)} onFocus={() => setAberto(true)}
          placeholder={placeholder || 'Digite o nome do hospital...'} className={input + ' pl-9'}/>
      </div>

      {aberto && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg p-2 space-y-2">
          {recentes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {recentes.map((r, i) => (
                <button key={i} type="button" onClick={() => escolher(r)}
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-brand-50 text-brand-700 text-[11px] font-semibold hover:bg-brand-100">
                  <Clock size={10}/> {r.nome}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <select value={estado} onChange={e => setEstado(e.target.value)}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg">
              <option value="">Estado...</option>
              {estados.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
            <select value={cidade} onChange={e => setCidade(e.target.value)} disabled={!estado || carregandoCidades}
              className="px-2 py-1.5 text-xs border border-slate-200 rounded-lg disabled:opacity-50">
              <option value="">{carregandoCidades ? 'Carregando...' : 'Cidade...'}</option>
              {cidades.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="max-h-52 overflow-y-auto border-t border-slate-100 -mx-2 px-2 pt-1">
            {carregandoHospitais && (
              <p className="flex items-center gap-1.5 text-xs text-slate-400 py-2"><Loader2 size={12} className="animate-spin"/> Buscando...</p>
            )}
            {!carregandoHospitais && !estado && busca.trim().length < 3 && (
              <p className="text-[11px] text-slate-400 py-2">Escolha um estado, ou digite ao menos 3 letras do nome do hospital.</p>
            )}
            {!carregandoHospitais && erro && <p className="text-[11px] text-red-600 py-2">{erro}</p>}
            {!carregandoHospitais && !erro && (estado || busca.trim().length >= 3) && hospitais.length === 0 && (
              <p className="text-[11px] text-slate-400 py-2">Nenhum hospital encontrado.</p>
            )}
            {hospitais.map(h => (
              <div key={h.id} onClick={() => escolher({ nome: h.nome, cidade: h.cidade, estado: h.estado, pausamedId: h.id })}
                className="px-1.5 py-2 hover:bg-slate-50 border-b border-slate-50 cursor-pointer">
                <p className="text-sm text-slate-700 truncate">{h.nome}</p>
                <p className="text-[11px] text-slate-400">{[h.cidade, h.estado].filter(Boolean).join(' - ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
