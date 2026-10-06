'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { Loader2, X } from 'lucide-react'
import { datasDaSituacao, campoDeData } from '@/lib/situacaoData'

// Trocar a situação sem abrir o cadastro inteiro.
//
// Mudar de situação é o que mais acontece no dia a dia — várias vezes por
// cirurgia, enquanto o resto do cadastro fica igual. Obrigar a abrir o
// formulário completo para isso é o caminho para a situação ficar
// desatualizada, que é o pior estado possível para esta lista.

type Status = { id: string; nome: string; categoria: string; cor: string }
type Motivo = { id: string; nome: string }

const ROTULO_CATEGORIA: Record<string, string> = {
  aberta: 'Em andamento',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
}

export default function TrocarSituacao({ cirurgia, onFechar, onTrocou }: {
  cirurgia: {
    id: string; status: string; paciente_nome: string
    data_pre_operatorio?: string | null
    data_solicitado_hospital?: string | null
    data_autorizacao?: string | null
  }
  onFechar: () => void
  onTrocou: () => void
}) {
  const { agent } = useAuth()
  const [status, setStatus] = useState<Status[]>([])
  const [motivos, setMotivos] = useState<Motivo[]>([])
  const [salvando, setSalvando] = useState<string | null>(null)
  const [motivoId, setMotivoId] = useState('')
  const [detalhe, setDetalhe] = useState('')
  const [pedindoMotivo, setPedindoMotivo] = useState<Status | null>(null)

  useEffect(() => {
    supabase.from('cirurgia_status').select('id, nome, categoria, cor').eq('ativo', true).order('ordem')
      .then(({ data }) => setStatus((data ?? []) as Status[]))
    // v48.112 — Mesma lista fixa do cadastro completo (CirurgiaModal): esta
    // troca rápida é o caminho mais usado no dia a dia para cancelar, então
    // se ela continuasse com texto livre a estatística do Dashboard de
    // Cirurgias ficaria furada na maioria dos casos.
    supabase.from('cirurgia_motivos_cancelamento').select('id, nome').eq('ativo', true).order('ordem')
      .then(({ data }) => setMotivos((data ?? []) as Motivo[]))
  }, [])

  async function aplicar(s: Status, motivoTexto?: string) {
    setSalvando(s.id)
    const dados: any = {
      status_id: s.id,
      status: s.nome,
      categoria: s.categoria,
      criado_por: agent?.id ?? null,
      criado_por_nome: agent?.name ?? null,
      updated_at: new Date().toISOString(),
      // A data do passo é carimbada aqui, só se ainda estiver vazia.
      ...datasDaSituacao(s.nome, cirurgia),
    }
    if (s.categoria === 'cancelada') {
      dados.motivo_cancelamento = (motivoTexto || '').trim()
      dados.motivo_cancelamento_id = motivoId || null
    }

    const { error } = await supabase.from('cirurgias').update(dados).eq('id', cirurgia.id)
    setSalvando(null)
    if (error) { alert('Não foi possível trocar a situação: ' + error.message); return }
    onTrocou()
  }

  function escolher(s: Status) {
    // Cancelamento continua exigindo motivo, aqui também. Perguntar depois é
    // receber "não lembro".
    if (s.categoria === 'cancelada') { setPedindoMotivo(s); return }
    aplicar(s)
  }

  const porCategoria = ['aberta', 'realizada', 'cancelada']

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{cirurgia.paciente_nome}</p>
            <p className="text-[11px] text-slate-400">agora em {cirurgia.status}</p>
          </div>
          <button onClick={onFechar} className="p-1 text-slate-400 shrink-0"><X size={18}/></button>
        </div>

        {pedindoMotivo ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs font-semibold text-red-800">
              Motivo do cancelamento <span className="font-normal">(obrigatório)</span>
            </p>
            <select autoFocus value={motivoId} onChange={e => setMotivoId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300">
              <option value="">Escolha um motivo...</option>
              {motivos.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
            {motivos.length === 0 && (
              <p className="text-[11px] text-red-700/70">
                Nenhum motivo cadastrado ainda. Cadastre em Configurações → Cirurgias → Motivos de
                cancelamento.
              </p>
            )}
            <textarea value={detalhe} onChange={e => setDetalhe(e.target.value)} rows={3}
              placeholder="Detalhe (opcional): o que mais ajuda a entender, além da categoria acima."
              className="w-full px-3 py-2 text-sm bg-white border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300"/>
            <div className="flex gap-2">
              <button onClick={() => { setPedindoMotivo(null); setMotivoId(''); setDetalhe('') }}
                className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600">Voltar</button>
              <button
                onClick={() => {
                  const nome = motivos.find(m => m.id === motivoId)?.nome || ''
                  aplicar(pedindoMotivo, [nome, detalhe.trim()].filter(Boolean).join(' — '))
                }}
                disabled={!motivoId || !!salvando}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50">
                {salvando ? 'Salvando...' : `Marcar como ${pedindoMotivo.nome}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-3">
            {porCategoria.map(cat => {
              const lista = status.filter(s => s.categoria === cat)
              if (lista.length === 0) return null
              return (
                <div key={cat} className="mb-3">
                  <p className="px-2 mb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    {ROTULO_CATEGORIA[cat] || cat}
                  </p>
                  <div className="space-y-0.5">
                    {lista.map(s => {
                      const atual = s.nome === cirurgia.status
                      const campo = campoDeData(s.nome)
                      return (
                        <button key={s.id} onClick={() => escolher(s)} disabled={!!salvando || atual}
                          className={'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left disabled:opacity-60 ' +
                            (atual ? 'bg-slate-100' : 'hover:bg-slate-50')}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.cor }}/>
                          <span className="flex-1 text-sm text-slate-700">{s.nome}</span>
                          {salvando === s.id && <Loader2 size={13} className="animate-spin text-slate-400"/>}
                          {atual && <span className="text-[11px] text-slate-400">atual</span>}
                          {!atual && campo && <span className="text-[11px] text-slate-400">carimba a data</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
