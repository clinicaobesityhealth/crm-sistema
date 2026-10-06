'use client'
import { useEffect, useState } from 'react'
import { supabase, Contact } from '@/lib/supabase'
import { Loader2, Link2, AlertCircle, Users } from 'lucide-react'
import { contasInstagramDoContato, unidoPara } from '@/lib/instagram'

// v48.45 — Unir dois cadastros que são a mesma pessoa.
//
// A clínica tem duas contas de Instagram. Quando a mesma paciente escreve para
// as duas, o Instagram dá a ela um identificador diferente em cada conta — para
// a Meta, são dois números para a mesma pessoa. O CRM abre dois cadastros, e
// não tem como saber sozinho que pertencem a alguém só.
//
// Esta tela é onde uma pessoa afirma isso. O banco faz o resto: move mensagens,
// agendamentos e tudo o mais para o cadastro que fica, junta os identificadores
// numa lista e marca o duplicado como unido — sem apagar nada, para que um
// engano possa ser desfeito.

export default function UnirCadastros({ contato, aoUnir }: { contato: Contact; aoUnir?: () => void }) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [achados, setAchados] = useState<Contact[]>([])
  const [unindo, setUnindo] = useState('')
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState('')

  useEffect(() => {
    const q = busca.trim()
    if (q.length < 3) { setAchados([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('contacts')
        .select('*')
        .ilike('full_name', `%${q.replace(/[,()*%]/g, ' ')}%`)
        .limit(10)
      // Fora da lista: ele mesmo e quem já foi unido a outro cadastro.
      setAchados(((data ?? []) as Contact[]).filter(c => c.id !== contato.id && !unidoPara(c)))
    }, 250)
    return () => clearTimeout(t)
  }, [busca, contato.id])

  async function unir(alvo: Contact) {
    const contas = contasInstagramDoContato(contato).length
    const aviso = `Unir "${contato.full_name || 'este cadastro'}" dentro de "${alvo.full_name || 'o cadastro escolhido'}"?\n\n`
      + `As mensagens, agendamentos e o histórico deste cadastro passam para o outro`
      + (contas ? `, junto com ${contas === 1 ? 'o Instagram vinculado' : `os ${contas} Instagram vinculados`}` : '')
      + `.\n\nNada é apagado: este cadastro fica guardado, marcado como unido.`
    if (!window.confirm(aviso)) return

    setUnindo(alvo.id); setErro(''); setFeito('')
    const { data, error } = await supabase.rpc('crm_unir_contatos', {
      p_origem: contato.id,
      p_destino: alvo.id,
    })
    setUnindo('')
    if (error) { setErro(error.message); return }

    const movidos = (data as any)?.movidos || {}
    const partes = Object.keys(movidos).map(k => `${movidos[k]} em ${k}`)
    setFeito(partes.length
      ? `Unido. Passaram para o outro cadastro: ${partes.join(', ')}.`
      : 'Unido. Não havia nada pendurado neste cadastro.')
    setBusca(''); setAchados([])
    aoUnir?.()
  }

  const jaUnido = unidoPara(contato)
  if (jaUnido) {
    return (
      <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
        <p className="text-xs text-slate-500">
          Este cadastro foi unido a outro e não recebe mais mensagens novas. Ele fica guardado apenas como histórico.
        </p>
      </div>
    )
  }

  if (feito) {
    return (
      <div className="px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg">
        <p className="text-xs text-emerald-800">{feito}</p>
      </div>
    )
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-xs font-semibold rounded-lg hover:bg-slate-50">
        <Users size={13}/> É a mesma pessoa de outro cadastro
      </button>
    )
  }

  return (
    <div className="space-y-2 px-3 py-3 bg-slate-50 border border-slate-200 rounded-lg">
      <p className="text-xs text-slate-500">
        Procure o outro cadastro desta mesma pessoa. Tudo o que está aqui passa para lá — inclusive os Instagram
        vinculados, para que as duas contas da clínica caiam na mesma conversa.
      </p>
      <input value={busca} onChange={e => setBusca(e.target.value)}
        placeholder="Nome do paciente..." className="field-input"/>

      {busca.trim().length >= 3 && (
        achados.length === 0 ? (
          <p className="text-[11px] text-slate-400">Nenhum outro cadastro encontrado com esse nome.</p>
        ) : (
          <div className="space-y-1">
            {achados.map(a => {
              const igs = contasInstagramDoContato(a)
              return (
                <button key={a.id} type="button" disabled={!!unindo}
                  onClick={() => unir(a)}
                  className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg hover:border-brand-300 disabled:opacity-50">
                  <p className="text-sm text-slate-700 flex items-center gap-1.5">
                    {a.full_name || 'Sem nome'}
                    {unindo === a.id && <Loader2 size={12} className="animate-spin text-slate-400"/>}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {a.phone && !a.phone.startsWith('ig:') ? a.phone : 'sem telefone'}
                    {igs.length > 0 && ` · ${igs.length} Instagram vinculado${igs.length > 1 ? 's' : ''}`}
                  </p>
                </button>
              )
            })}
          </div>
        )
      )}

      {erro && <p className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={12}/>{erro}</p>}

      <div className="flex justify-end">
        <button type="button" onClick={() => { setAberto(false); setErro(''); setBusca('') }} disabled={!!unindo}
          className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">
          Cancelar
        </button>
      </div>
    </div>
  )
}

// A lista de Instagram vinculados, para a tela do contato mostrar as duas
// contas quando existirem. Fica aqui perto da união porque é ela que produz a
// lista.
export function InstagramVinculados({ contato }: { contato: Contact }) {
  const contas = contasInstagramDoContato(contato)
  if (contas.length === 0) return null
  return (
    <div className="space-y-1">
      {contas.map(c => (
        <div key={c.psid} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg">
          <Link2 size={12} className="text-slate-400 shrink-0"/>
          <span className="text-xs text-slate-600 flex-1 min-w-0 truncate">
            {c.conta || 'conta não identificada'}
          </span>
          <span className="font-mono text-[10px] text-slate-400 shrink-0">…{c.psid.slice(-6)}</span>
        </div>
      ))}
    </div>
  )
}
