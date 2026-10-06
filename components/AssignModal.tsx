'use client'
import { useState, useEffect } from 'react'
import { supabase, Sector, Agent } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import { X, Save, Loader2, AlertCircle, Briefcase, User } from 'lucide-react'
import clsx from 'clsx'

type Props = {
  contactId: string
  contactName: string
  currentSectorId?: string | null
  title?: string
  autoAssign?: boolean        // true = atribui ao agente logado, sem mostrar lista de agentes
  transferMessage?: boolean   // true = envia msg automática ao paciente
  onClose: () => void
  onSaved: (sectorId: string, agentId: string | null, agentName: string | null) => void
}

export default function AssignModal({
  contactId, contactName, currentSectorId,
  title = 'Iniciar atendimento',
  autoAssign = false,
  transferMessage = false,
  onClose, onSaved
}: Props) {
  const { agent } = useAuth()
  const [sectors, setSectors] = useState<Sector[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedSector, setSelectedSector] = useState<string>(currentSectorId || '')
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const currentSector = sectors.find(s => s.id === currentSectorId)
  const targetSector = sectors.find(s => s.id === selectedSector)
  const privacyModeChanges = currentSectorId !== selectedSector && (!!currentSector?.is_exclusive !== !!targetSector?.is_exclusive || !!targetSector?.is_exclusive)

  useEffect(() => {
    if (!agent) return
    if (agent.role === 'admin' || agent.sees_all_sectors) {
      // Admin vê todos os setores
      supabase.from('sectors').select('*').order('name')
        .then(({ data }) => setSectors(data ?? []))
    } else {
      // Usuário vê só os setores que tem acesso
      supabase.from('agent_sectors').select('sector_id').eq('agent_id', agent.id)
        .then(async ({ data: agentSectors }) => {
          const ids = (agentSectors ?? []).map((s: any) => s.sector_id)
          if (ids.length === 0) { setSectors([]); return }
          const { data } = await supabase.from('sectors').select('*').in('id', ids).order('name')
          setSectors(data ?? [])
        })
    }
  }, [agent])

  // Só busca agentes quando é transferência (não autoAssign)
  useEffect(() => {
    if (autoAssign || !selectedSector) { setAgents([]); return }
    const sector = sectors.find(s => s.id === selectedSector)
    if (sector?.is_exclusive) {
      // Setor exclusivo/privado: "Ver todos os setores" NÃO vale aqui por
      // definição (é só para setores não-exclusivos) — só aparece quem tem
      // acesso explícito a ESTE setor, senão a pessoa recebe a conversa sem
      // poder ler o histórico privado dela.
      supabase.from('agents').select('*, agent_sectors!inner(sector_id)').eq('agent_sectors.sector_id', selectedSector)
        .then(({ data }) => setAgents(data ?? []))
    } else {
      Promise.all([
        supabase.from('agents').select('*, agent_sectors!inner(sector_id)').eq('agent_sectors.sector_id', selectedSector),
        supabase.from('agents').select('*').eq('sees_all_sectors', true)
      ]).then(([{ data: sa }, { data: all }]) => {
        const combined = [...(sa ?? []), ...(all ?? [])]
        const unique = combined.filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i)
        setAgents(unique)
      })
    }
  }, [selectedSector, autoAssign, sectors])

  async function handleSave() {
    if (!selectedSector) { setError('Selecione um setor.'); return }
    setSaving(true)

    const assignTo = autoAssign ? (agent?.id ?? null) : (selectedAgent || null)
    const newStatus = autoAssign ? 'active' : 'pending'

    // Na transferência: primeiro limpa o assigned_to antigo para garantir que some da lista
    if (!autoAssign) {
      await supabase.from('contacts').update({ assigned_to: null }).eq('id', contactId)
    }

    let query = supabase.from('contacts').update({
      conversation_status: newStatus,
      sector_id: selectedSector,
      assigned_to: assignTo,
      sofia_paused: true,  // Sofia desativada até próximo atendente ativar manualmente
      updated_at: new Date().toISOString(),
    }).eq('id', contactId)
    // Ao assumir para si mesmo (autoAssign), só efetiva se ninguém pegou antes
    // (mesma corrida do botão "Assumir" do Inbox — aqui protege quem inicia
    // atendimento por uma conversa fechada/inativa na tela de Contatos).
    if (autoAssign) query = query.is('assigned_to', null)
    const { data: saved, error: err } = await query.select('id')

    if (err) { setError('Erro: ' + err.message); setSaving(false); return }
    if (autoAssign && (!saved || saved.length === 0)) {
      setError('Este atendimento já foi assumido por outro atendente. Feche e tente novamente.')
      setSaving(false)
      return
    }

    // Msg interna de registro
    const actionText = autoAssign
      ? `🔄 Atendimento iniciado por ${agent?.name ?? 'Atendente'}`
      : `🔄 Transferido por ${agent?.name ?? 'Atendente'}${selectedAgent ? '' : ' (sem atendente)'}`

    await supabase.from('messages').insert({
      contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
      content: '[INTERNO] ' + actionText, status: 'sent', sender_id: agent?.id ?? null,
    })

    // Msg automática ao paciente na transferência — só se mudar de atendente
    if (transferMessage && !autoAssign) {
      const agentTarget = agents.find(a => a.id === selectedAgent)
      const isSameAgent = selectedAgent === agent?.id

      if (!isSameAgent) {
        // Transferência para outro atendente
        const destinatario = agentTarget ? `*${agentTarget.name}*` : null
        if (destinatario) {
          await supabase.from('messages').insert({
            contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
            content: `Olá! A partir de agora você será atendido(a) por ${destinatario}. Qualquer dúvida, estamos à disposição. 😊`,
            status: 'queued', sender_id: agent?.id ?? null,
          })
        }
        // Se não selecionou atendente específico, não envia msg (vai para fila do setor)
      }
      // Se é o mesmo agente mudando de setor → sem msg ao paciente
    }

    setSaving(false)
    onSaved(selectedSector, assignTo, agent?.name ?? null)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{contactName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={16}/></button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>{error}
            </div>
          )}

          {/* Setor */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
              <Briefcase size={11}/> Setor
            </label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {sectors.map(s => (
                <button key={s.id} onClick={() => { setSelectedSector(s.id); setSelectedAgent('') }}
                  className={clsx('w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors text-sm',
                    selectedSector === s.id
                      ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }}/>
                  <span className="flex-1">{s.name}</span>
                  {s.is_exclusive && <span className="text-xs text-amber-600">Exclusivo</span>}
                  {selectedSector === s.id && <span className="text-brand-500 text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Atendente — só na transferência */}
          {!autoAssign && selectedSector && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
                <User size={11}/> Atendente <span className="text-slate-400 font-normal ml-1">(opcional)</span>
              </label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                <button onClick={() => setSelectedAgent('')}
                  className={clsx('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors',
                    selectedAgent === '' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  Sem atendente específico
                </button>
                {agents.map(a => (
                  <button key={a.id} onClick={() => setSelectedAgent(a.id)}
                    className={clsx('w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-sm transition-colors',
                      selectedAgent === a.id ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')}>
                    {a.photo_url
                      ? <img src={a.photo_url} className="w-6 h-6 rounded-full object-cover flex-shrink-0"/>
                      : <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                          {a.name.split(' ').map((n: string) => n[0]).join('').substring(0,2).toUpperCase()}
                        </div>}
                    <div className="min-w-0">
                      <span className="font-medium block truncate">{a.name}</span>
                      {a.job_title && <span className="text-xs text-slate-400">{a.job_title}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {autoAssign && agent && (
            <p className="text-xs text-slate-400 bg-slate-50 px-3 py-2 rounded-lg">
              ✓ Atribuído automaticamente a <strong>{agent.name}</strong>
            </p>
          )}
          {transferMessage && !autoAssign && (
            <p className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200">
              📨 O paciente receberá uma mensagem automática sobre a transferência
            </p>
          )}
          {privacyModeChanges && (
            <p className={clsx('text-xs px-3 py-2 rounded-lg border', targetSector?.is_exclusive ? 'text-violet-700 bg-violet-50 border-violet-200' : 'text-blue-700 bg-blue-50 border-blue-200')}>
              {targetSector?.is_exclusive
                ? '🔒 O paciente será avisado de que o atendimento entrou no modo privado.'
                : '🔓 O paciente será avisado de que as novas mensagens não estarão mais no modo privado.'}
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !selectedSector}
            className="flex-1 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
            {saving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}
