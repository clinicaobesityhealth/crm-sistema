'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, Plus } from 'lucide-react'

// Um seletor que aceita o que ainda não existe.
//
// Na hora de lançar uma cirurgia, aparece um hospital novo ou uma situação que
// ninguém cadastrou. Mandar a pessoa sair da tela, ir em Configurações, criar,
// e voltar para recomeçar o lançamento é o caminho mais curto para ela desistir
// e digitar qualquer coisa que já exista.
//
// Aqui ela cadastra na hora, sem perder o que já preencheu.

type Opcao = { id: string; nome: string }

export default function SelectComCriar({
  valor, opcoes, tabela, rotuloNovo, camposExtras, onEscolher, onCriou, className, vazio,
}: {
  valor: string | null
  opcoes: Opcao[]
  tabela: string
  rotuloNovo: string
  camposExtras?: Record<string, any>
  // Texto da opção em branco. Em "Convênio", não escolher nada quer dizer
  // "particular" — e isso precisa estar escrito, não subentendido.
  vazio?: string
  onEscolher: (id: string | null, nome: string) => void
  onCriou: () => Promise<void> | void
  className?: string
}) {
  const [criando, setCriando] = useState(false)

  async function criar() {
    const nome = window.prompt(rotuloNovo)?.trim()
    if (!nome) return

    // Já existe com outro acento ou caixa? Escolhe o que existe em vez de criar
    // um irmão gêmeo — é assim que uma lista vira "BLANC", "Blanc" e "blanc".
    const igual = opcoes.find(o =>
      o.nome.localeCompare(nome, 'pt-BR', { sensitivity: 'base' }) === 0)
    if (igual) { onEscolher(igual.id, igual.nome); return }

    setCriando(true)
    const { data, error } = await supabase.from(tabela)
      .insert({ nome, ordem: opcoes.length + 1, ...(camposExtras || {}) })
      .select('id, nome').single()
    setCriando(false)

    if (error || !data) { alert('Não foi possível cadastrar: ' + (error?.message || '')); return }
    await onCriou()
    onEscolher(data.id, data.nome)
  }

  return (
    <div className="flex gap-1.5">
      <select
        value={valor ?? ''}
        onChange={e => {
          const o = opcoes.find(x => x.id === e.target.value)
          onEscolher(e.target.value || null, o?.nome ?? '')
        }}
        className={className}>
        <option value="">{vazio || 'Selecione...'}</option>
        {opcoes.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
      </select>
      <button type="button" onClick={criar} disabled={criando} title={rotuloNovo}
        className="px-2.5 rounded-lg border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 disabled:opacity-50 shrink-0">
        {criando ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
      </button>
    </div>
  )
}
