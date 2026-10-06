'use client'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Sparkles, ExternalLink, AlertTriangle, Pill, Stethoscope, FlaskConical, ClipboardList, History } from 'lucide-react'
import { buscarAgendamentosMedxCached } from '@/lib/medxAgendamentos'

// v48.163 — Prontuário completo do paciente, puxado ao vivo do MedX, com um resumo
// clínico gerado por IA (datas, exames em ordem, alergias, medicamentos, conduta da
// última consulta, antecedentes e cirurgias) — pedido do Jorge para não precisar
// abrir o MedX e ler consulta por consulta toda vez.
//
// Usado tanto no menu do paciente (aba "Prontuário") quanto na Agenda Médica (botão
// no card/modal da consulta) — por isso recebe só nome/telefone (ou, se já souber,
// o medxId direto) em vez de depender de um "contact" do CRM.

const MEDX_LOGIN_URL = 'https://care-app65.medx.med.br/Login_Unificado/loginUnificado.html'

type HistoricoItem = {
  Id_do_Historico?: number | string
  Historico?: string
  Data?: string
  Usuario?: string
  TipoDoc?: string
  Classe?: string
}

type ResumoClinico = {
  diagnostico?: string
  hpp?: string
  medicamentos?: string
  alergias?: string
  livre?: string
}

type ResumoIA = {
  primeira_consulta?: string | null
  ultima_consulta?: string | null
  alergias?: string
  exames?: { nome?: string; data?: string; resultado?: string }[]
  medicamentos_em_uso?: string
  conduta_ultima_consulta?: string
  antecedentes?: string
  cirurgias_realizadas?: string
}

function limparHtml(s?: string) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fmtDataHora(s?: string) {
  if (!s) return ''
  try {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

export default function ProntuarioPanel({ nome, telefone, medxIdConhecido }: {
  nome: string; telefone?: string | null; medxIdConhecido?: string | null
}) {
  const [pacId, setPacId] = useState<string | null>(medxIdConhecido || null)
  const [resolvendoPacId, setResolvendoPacId] = useState(!medxIdConhecido)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historico, setHistorico] = useState<HistoricoItem[]>([])
  const [resumoClinico, setResumoClinico] = useState<ResumoClinico | null>(null)
  const [resumoIA, setResumoIA] = useState<ResumoIA | null>(null)
  const [gerandoResumo, setGerandoResumo] = useState(false)
  const [erroResumo, setErroResumo] = useState('')
  const [verTudo, setVerTudo] = useState(false)

  useEffect(() => {
    setPacId(medxIdConhecido || null)
    setResumoIA(null); setErroResumo('')
    buscarTudo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome, telefone, medxIdConhecido])

  async function buscarTudo() {
    setLoading(true); setError(''); setHistorico([]); setResumoClinico(null)
    let id = medxIdConhecido || null
    if (!id) {
      setResolvendoPacId(true)
      try {
        const { paciente } = await buscarAgendamentosMedxCached({ nome, telefone })
        id = paciente?.Id_do_Cliente ? String(paciente.Id_do_Cliente) : null
      } catch {}
      setResolvendoPacId(false)
      setPacId(id)
    }
    if (!id) {
      setError('Não encontramos este paciente no MedX (ainda não sincronizado, ou nome/telefone não batem).')
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/prontuario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pacId: id, page: 1, pageSize: 50 }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); setLoading(false); return }
      setHistorico(Array.isArray(json.historico) ? json.historico : [])
      setResumoClinico(json.resumoClinico || null)
    } catch (e: any) {
      setError('Não foi possível buscar o prontuário: ' + (e?.message || 'falha na conexão'))
    } finally {
      setLoading(false)
    }
  }

  async function gerarResumoIA() {
    setGerandoResumo(true); setErroResumo('')
    try {
      const res = await fetch('/api/prontuario/resumir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historico, resumoClinico }),
      })
      const json = await res.json()
      if (!json.sucesso) { setErroResumo(json.mensagem || 'Não foi possível gerar o resumo.'); return }
      setResumoIA(json.resumo)
    } catch (e: any) {
      setErroResumo('Erro ao gerar resumo: ' + (e?.message || 'falha na conexão'))
    } finally {
      setGerandoResumo(false)
    }
  }

  const itensOrdenados = [...historico]
    .filter(h => h && (h.Historico || h.TipoDoc))
    .sort((a, b) => new Date(b.Data || 0).getTime() - new Date(a.Data || 0).getTime())

  const alergias = resumoIA?.alergias || resumoClinico?.alergias || ''

  return (
    <div className="px-5 py-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => window.open(MEDX_LOGIN_URL, '_blank')}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
          <ExternalLink size={13}/> Abrir no MedX
        </button>
        {!loading && !error && historico.length > 0 && (
          <button type="button" onClick={gerarResumoIA} disabled={gerandoResumo}
            className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-60 px-2.5 py-1.5 rounded-lg transition-colors">
            {gerandoResumo ? <Loader2 size={13} className="animate-spin"/> : <Sparkles size={13}/>}
            {gerandoResumo ? 'Gerando resumo...' : (resumoIA ? 'Gerar de novo' : 'Resumir com IA')}
          </button>
        )}
      </div>

      {(loading || resolvendoPacId) && (
        <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin mr-2"/> Buscando prontuário no MedX...
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* v48.163 — Alergias sempre destacadas no topo, como pedido. */}
          {alergias ? (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm font-semibold">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5"/>
              <span>Alérgico(a) a: {alergias}</span>
            </div>
          ) : resumoIA ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-400 text-xs">
              <AlertTriangle size={13} className="flex-shrink-0"/> Nenhuma alergia registrada no prontuário.
            </div>
          ) : null}

          {erroResumo && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{erroResumo}
            </div>
          )}

          {resumoIA && (
            <div className="space-y-3 bg-violet-50/50 border border-violet-100 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700">
                <Sparkles size={13}/> Resumo gerado por IA
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-600">
                {resumoIA.primeira_consulta && <span><strong>1ª consulta:</strong> {resumoIA.primeira_consulta}</span>}
                {resumoIA.ultima_consulta && <span><strong>Última consulta:</strong> {resumoIA.ultima_consulta}</span>}
              </div>

              {resumoIA.conduta_ultima_consulta && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-0.5 flex items-center gap-1"><ClipboardList size={12}/> Conduta da última consulta</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{resumoIA.conduta_ultima_consulta}</p>
                </div>
              )}

              {!!resumoIA.exames?.length && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1"><FlaskConical size={12}/> Exames</p>
                  <ul className="space-y-1">
                    {resumoIA.exames.map((ex, i) => (
                      <li key={i} className="text-sm text-slate-700">
                        <span className="font-semibold">{ex.nome}</span>{ex.data ? ` ${ex.data}` : ''}{ex.resultado ? ` — ${ex.resultado}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {resumoIA.medicamentos_em_uso && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-0.5 flex items-center gap-1"><Pill size={12}/> Medicamentos em uso</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{resumoIA.medicamentos_em_uso}</p>
                </div>
              )}

              {resumoIA.antecedentes && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-0.5 flex items-center gap-1"><Stethoscope size={12}/> Antecedentes</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{resumoIA.antecedentes}</p>
                </div>
              )}

              {resumoIA.cirurgias_realizadas && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-0.5">Cirurgias realizadas</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap">{resumoIA.cirurgias_realizadas}</p>
                </div>
              )}

              <p className="text-[10px] text-slate-400 italic">
                Resumo gerado por IA a partir das anotações do MedX — pode conter imprecisões; confira no MedX antes de decisões clínicas.
              </p>
            </div>
          )}

          <div>
            <button type="button" onClick={() => setVerTudo(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 mb-2">
              <History size={13}/> {verTudo ? 'Ocultar' : 'Ver'} histórico completo de evolução ({itensOrdenados.length})
            </button>
            {verTudo && (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                {itensOrdenados.length === 0 && (
                  <p className="text-xs text-slate-400">Nenhuma anotação encontrada no MedX.</p>
                )}
                {itensOrdenados.map((h, i) => (
                  <div key={h.Id_do_Historico ?? i} className="border-b border-slate-100 pb-2.5 last:border-0">
                    <p className="text-[11px] text-slate-400">{fmtDataHora(h.Data)} · {h.Usuario || '—'}</p>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">
                      {limparHtml(h.Historico) || (h.TipoDoc ? `[Anexo: ${h.TipoDoc}]` : '')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
