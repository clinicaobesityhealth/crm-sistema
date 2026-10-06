'use client'
import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import InstagramIcon from '@/components/icons/InstagramIcon'
import SaudeInstagram from '@/components/SaudeInstagram'
import { Loader2, RefreshCw, CheckCircle2, XCircle, Plus, Pencil, Save, X, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import { useAiAssistantName } from '@/lib/useAiAssistantName'

const LIST_URL = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/ig-accounts-list'
const SAVE_URL = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/ig-accounts-save'

type IgAccount = {
  numero: number
  nome_conta: string
  instagram_business_account_id: string
  access_token: string
  ativo: string
  observacoes: string
}

const EMPTY_FORM: IgAccount = {
  numero: 0,
  nome_conta: '',
  instagram_business_account_id: '',
  access_token: '',
  ativo: 'sim',
  observacoes: '',
}

export default function InstagramSettingsPage() {
  const assistantName = useAiAssistantName()
  const [accounts, setAccounts] = useState<IgAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<IgAccount | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try {
      const res = await fetch(LIST_URL)
      const data = await res.json()
      setAccounts((data.contas || []).sort((a: IgAccount, b: IgAccount) => a.numero - b.numero))
    } catch (e) {
      setError('Não foi possível carregar as contas do Instagram.')
    }
    setLoading(false)
  }

  function openNew() {
    setSaveError('')
    setEditing({ ...EMPTY_FORM, numero: 0 })
  }

  function openEdit(acc: IgAccount) {
    setSaveError('')
    setEditing({ ...acc })
  }

  async function save() {
    if (!editing) return
    if (!editing.nome_conta.trim()) { setSaveError('Dê um nome para identificar a conta.'); return }
    setSaving(true); setSaveError('')
    try {
      const body: any = {
        nome_conta: editing.nome_conta.trim(),
        instagram_business_account_id: editing.instagram_business_account_id.trim(),
        access_token: editing.access_token.trim(),
        ativo: editing.ativo,
        observacoes: editing.observacoes || '',
      }
      if (editing.numero) body.numero = editing.numero
      const res = await fetch(SAVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.sucesso) throw new Error(data.mensagem || 'Falha ao salvar')

      // v48.49 — Assinar os eventos desta conta na Meta, junto com o salvar.
      //
      // Conectar a conta e gerar o token não faz o Instagram entregar nada: falta
      // assinar os eventos, num passo separado que não avisa quando fica
      // faltando. A conta do Dr. Marcello passou horas em silêncio por causa
      // disso — token válido, cadastro certo, e ninguém escutando.
      //
      // Se a assinatura falhar, o cadastro continua salvo: o aviso aparece na
      // tela em vez de a conta ficar muda sem explicação.
      if (editing.access_token.trim() && editing.instagram_business_account_id.trim()) {
        try {
          const a = await fetch('/api/instagram/assinar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instagram_business_account_id: editing.instagram_business_account_id.trim(),
              access_token: editing.access_token.trim(),
            }),
          })
          const aj = await a.json()
          if (!aj.ok) {
            setSaveError('A conta foi salva, mas a Meta recusou ligar o recebimento de mensagens: '
              + (aj.erro || 'motivo não informado') + '. Sem isso, as mensagens desta conta não chegam ao CRM.')
            setSaving(false)
            return
          }
        } catch {
          setSaveError('A conta foi salva, mas não consegui ligar o recebimento de mensagens na Meta. '
            + 'Salve de novo em instantes — sem esse passo, as mensagens desta conta não chegam ao CRM.')
          setSaving(false)
          return
        }
      }

      setEditing(null)
      await load()
    } catch (e) {
      setSaveError('Erro ao salvar. Tente novamente.')
    }
    setSaving(false)
  }

  function maskToken(token: string) {
    if (!token) return '—'
    if (token.length <= 8) return '••••••••'
    return token.slice(0, 6) + '••••••••' + token.slice(-4)
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}>
              <InstagramIcon size={17} color="white"/>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Contas do Instagram</h1>
              <p className="text-xs text-slate-400 mt-0.5">Gerencie as contas do Instagram conectadas a {assistantName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> Atualizar
            </button>
            <button onClick={openNew}
              className="flex items-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg">
              <Plus size={15}/> Nova conta
            </button>
          </div>
        </div>

        <div className="max-w-3xl px-6 py-8">
          {/* v48.35 — O estado da conexão vem antes de tudo: é a primeira coisa
              que alguém quer saber ao abrir esta tela. */}
          <SaudeInstagram/>

          <div className="mb-6 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-xs leading-relaxed">
            Para conectar uma conta, você vai precisar do <strong>ID da conta comercial do Instagram</strong> e de um{' '}
            <strong>access token</strong> de longa duração gerado no Meta for Developers (Graph API Explorer) para essa
            conta. O nome é só um apelido para você identificar a conta aqui no CRM.{' '}
            Não existe um limite fixo de contas — você pode conectar quantas precisar, use o botão{' '}
            <strong>Nova conta</strong> ou um dos espaços em branco abaixo.
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {loading && accounts.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-slate-400 text-sm">
              <Loader2 size={16} className="animate-spin mr-2"/>Carregando...
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map(acc => {
                const configured = !!acc.instagram_business_account_id && !!acc.access_token
                const active = acc.ativo === 'sim'
                return (
                  <div key={acc.numero}
                    className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                    {active && configured
                      ? <CheckCircle2 size={20} className="text-emerald-600 flex-shrink-0"/>
                      : <XCircle size={20} className="text-slate-300 flex-shrink-0"/>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{acc.nome_conta || `Conta ${acc.numero}`}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {configured
                          ? `ID: ${acc.instagram_business_account_id} · Token: ${maskToken(acc.access_token)}`
                          : 'Ainda não configurada'}
                      </p>
                      {acc.observacoes && <p className="text-xs text-slate-400 mt-0.5 truncate">{acc.observacoes}</p>}
                    </div>
                    <span className={clsx('text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0',
                      active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                      {active ? 'Ativa' : 'Inativa'}
                    </span>
                    <button onClick={() => openEdit(acc)}
                      className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-brand-600 flex-shrink-0">
                      <Pencil size={15}/>
                    </button>
                  </div>
                )
              })}
              {Array.from({ length: Math.max(4 - accounts.length, 2) }).map((_, i) => (
                <button key={`slot-${i}`} onClick={openNew}
                  className="w-full bg-white border border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50/40 rounded-xl p-4 flex items-center gap-3 text-left transition-colors">
                  <XCircle size={20} className="text-slate-200 flex-shrink-0"/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-400">Conta não conectada</p>
                    <p className="text-xs text-slate-300">Clique para conectar uma nova conta do Instagram</p>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full flex-shrink-0 bg-brand-50 text-brand-600">
                    <Plus size={12}/> Conectar
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal de edição/criação */}
      {editing && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
              <h2 className="text-base font-semibold text-slate-800">
                {editing.numero ? 'Editar conta' : 'Nova conta do Instagram'}
              </h2>
              <button onClick={() => setEditing(null)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
                <X size={18}/>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Nome da conta (apelido)</label>
                <input value={editing.nome_conta} onChange={e => setEditing(f => f && ({ ...f, nome_conta: e.target.value }))}
                  placeholder="ex: Obesity Health"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">ID da conta comercial do Instagram</label>
                <input value={editing.instagram_business_account_id}
                  onChange={e => setEditing(f => f && ({ ...f, instagram_business_account_id: e.target.value }))}
                  placeholder="ex: 17841400459870559"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Access token</label>
                <textarea value={editing.access_token}
                  onChange={e => setEditing(f => f && ({ ...f, access_token: e.target.value }))}
                  placeholder="Cole aqui o token gerado no Meta for Developers"
                  rows={3}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono resize-none"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Observações (opcional)</label>
                <input value={editing.observacoes} onChange={e => setEditing(f => f && ({ ...f, observacoes: e.target.value }))}
                  placeholder="ex: token gerado em jul/2026, renovar em 60 dias"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={editing.ativo === 'sim'}
                  onChange={e => setEditing(f => f && ({ ...f, ativo: e.target.checked ? 'sim' : 'nao' }))}
                  className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"/>
                <span className="text-sm text-slate-700">Conta ativa ({assistantName} responde por essa conta)</span>
              </label>

              {saveError && (
                <div className="px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{saveError}</div>
              )}

              <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:underline w-fit">
                <ExternalLink size={12}/> Abrir Graph API Explorer para gerar um token
              </a>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0">
              <button onClick={save} disabled={saving}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
