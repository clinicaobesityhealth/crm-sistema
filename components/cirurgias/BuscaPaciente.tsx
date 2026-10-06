'use client'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, UserRound, X, AlertTriangle } from 'lucide-react'

// Busca o paciente no cadastro do CRM.
//
// Na planilha o nome é digitado de novo a cada cirurgia — e "José da Silva" e
// "Jose da Silva" viram duas pessoas, com dois históricos. Aqui a cirurgia
// aponta para o contato que já existe, o mesmo do WhatsApp e das cobranças.
//
// Ainda é possível lançar sem vincular (paciente novo, cadastro depois), mas a
// tela deixa claro quando isso acontece.

type Contato = { id: string; full_name: string; phone: string | null; convenio_id?: string | null; plano_id?: string | null; carteirinha?: string | null; carteirinha_nome?: string | null; carteirinha_validade?: string | null }

export default function BuscaPaciente({
  contactId, nome, telefone, onEscolher, onNome, onTelefone,
}: {
  contactId: string | null
  nome: string
  telefone: string
  onEscolher: (c: Contato | null) => void
  onNome: (v: string) => void
  onTelefone: (v: string) => void
}) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Contato[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  // v48.106 — Alergia do paciente vinculado. Busca direto pelo contact_id,
  // separado da busca de nome: assim o selo aparece tanto quando a
  // secretária acabou de escolher o paciente quanto quando abre uma
  // cirurgia já lançada antes, sem depender do momento da escolha.
  const [alergia, setAlergia] = useState<{ alergico: boolean; alergia_obs: string | null } | null>(null)
  const [verAlergia, setVerAlergia] = useState(false)
  useEffect(() => {
    setVerAlergia(false)
    if (!contactId) { setAlergia(null); return }
    let cancelado = false
    supabase.from('contacts').select('alergico, alergia_obs').eq('id', contactId).maybeSingle()
      .then(({ data }) => { if (!cancelado) setAlergia(data as any) })
    return () => { cancelado = true }
  }, [contactId])

  useEffect(() => {
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [])

  useEffect(() => {
    const q = termo.trim()
    if (q.length < 3) { setResultados([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      // v48.74 — A busca é do banco, não da tela.
      //
      // O ILIKE daqui comparava acento como caractere: "JOAO" não achava
      // "JOÃO", e a secretária concluía que o paciente não tinha cadastro e
      // criava um duplicado. A função no banco reduz os dois lados à mesma
      // chave — sem acento e com os sons que se confundem em português
      // escritos de um jeito só (Thiago/Tiago, Luiz/Luís, Xavier/Chavier).
      const { data, error } = await supabase.rpc('buscar_contatos', { p_termo: q, p_limite: 8 })
      if (error) {
        // Migração ainda não rodada: volta ao jeito antigo em vez de deixar a
        // busca sem resposta nenhuma.
        const limpo = q.replace(/[,()*%]/g, ' ').trim()
        const { data: antigo } = await supabase.from('contacts')
          .select('id, full_name, phone, convenio_id, plano_id, carteirinha, carteirinha_nome, carteirinha_validade')
          .ilike('full_name', `%${limpo}%`).limit(8)
        setResultados((antigo ?? []) as Contato[])
      } else {
        setResultados((data ?? []) as Contato[])
      }
      setBuscando(false)
    }, 250)
    return () => clearTimeout(t)
  }, [termo])

  const input = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500'

  if (contactId) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <UserRound size={15} className="text-emerald-600 shrink-0"/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-slate-700 truncate">{nome}</p>
              {alergia?.alergico && (
                <button type="button" onClick={() => setVerAlergia(v => !v)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold shrink-0">
                  <AlertTriangle size={10}/> ALÉRGICO(A)
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">{telefone || 'sem telefone no cadastro'}</p>
          </div>
          <button onClick={() => { onEscolher(null); setTermo('') }} className="p-1 text-slate-400 hover:text-slate-600"><X size={15}/></button>
        </div>
        {alergia?.alergico && verAlergia && (
          <div className="px-3 py-2 bg-red-50 border-t border-red-100 text-xs text-red-800">
            <span className="font-semibold">Alergia anotada no cadastro do paciente: </span>
            {alergia.alergia_obs?.trim() || 'nada escrito — só marcado como alérgico(a), sem detalhe.'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={caixa} className="relative">
      <input
        value={nome}
        onChange={e => { onNome(e.target.value); setTermo(e.target.value); setAberto(true) }}
        onFocus={() => setAberto(true)}
        placeholder="Digite o nome do paciente..."
        className={input}/>

      {aberto && termo.trim().length >= 3 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {buscando ? (
            <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin"/> Buscando no cadastro...
            </div>
          ) : resultados.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-slate-400">
              Ninguém com esse nome no cadastro. Você pode lançar assim mesmo — a cirurgia fica
              sem vínculo com o contato do WhatsApp até alguém ligar os dois.
            </p>
          ) : (
            resultados.map(c => (
              <button key={c.id} type="button"
                onClick={() => { onEscolher(c); setAberto(false); setTermo('') }}
                className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                <p className="text-sm text-slate-700">{c.full_name}</p>
                <p className="text-xs text-slate-400">{c.phone || 'sem telefone'}</p>
              </button>
            ))
          )}
        </div>
      )}

      {!contactId && nome.trim().length > 0 && (
        <input
          value={telefone}
          onChange={e => onTelefone(e.target.value)}
          placeholder="Telefone (se não estiver no cadastro)"
          className={input + ' mt-2'}/>
      )}
    </div>
  )
}
