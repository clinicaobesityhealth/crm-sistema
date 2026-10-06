'use client'
import { useState } from 'react'
import { Contact } from '@/lib/supabase'
import InstagramIcon from '@/components/icons/InstagramIcon'
import { Ban, Loader2, ShieldCheck, X, Phone } from 'lucide-react'
import clsx from 'clsx'
import {
  canaisDoContato, canaisBloqueados, NOME_DO_CANAL, type CanalBloqueio,
} from '@/lib/bloqueio'

// A janela que pergunta QUAIS canais bloquear.
//
// v48.34 — Antes era um confirm() e pronto: bloqueava o contato inteiro. Para
// quem tem WhatsApp e Instagram no mesmo cadastro isso é grosso demais — o
// paciente que incomoda no Instagram costuma ser o mesmo que marca consulta
// pelo WhatsApp.
//
// Quem tem um canal só continua com uma pergunta só: a janela mostra o que vai
// acontecer e o botão faz. Nada de caixinha para escolher entre uma opção.

export default function EscolherCanaisBloqueio({ contato, onFechar, onConfirmar }: {
  contato: Contact
  onFechar: () => void
  onConfirmar: (canais: CanalBloqueio[], acao: 'bloquear' | 'desbloquear') => Promise<void>
}) {
  const disponiveis = canaisDoContato(contato)
  const bloqueados = canaisBloqueados(contato)
  const [salvando, setSalvando] = useState(false)

  // O que a janela oferece depende de onde o contato está: se há canal livre,
  // ela bloqueia; se está tudo bloqueado, ela libera.
  const livres = disponiveis.filter(c => !bloqueados.includes(c))
  const acao: 'bloquear' | 'desbloquear' = livres.length > 0 ? 'bloquear' : 'desbloquear'
  const opcoes = acao === 'bloquear' ? livres : bloqueados

  const [escolhidos, setEscolhidos] = useState<CanalBloqueio[]>(opcoes)

  function alternar(c: CanalBloqueio) {
    setEscolhidos(e => e.includes(c) ? e.filter(x => x !== c) : [...e, c])
  }

  async function confirmar() {
    if (escolhidos.length === 0) return
    setSalvando(true)
    await onConfirmar(escolhidos, acao)
    setSalvando(false)
  }

  const icone = (c: CanalBloqueio) =>
    c === 'instagram' ? <InstagramIcon size={14}/> : <Phone size={14}/>

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onFechar}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            {acao === 'bloquear' ? 'Bloquear' : 'Desbloquear'} {contato.full_name || 'contato'}
          </h2>
          <button onClick={onFechar} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"><X size={18}/></button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Com dois canais, a escolha é real e precisa ser feita. Com um só,
              a janela apenas confirma — perguntar "qual?" para uma opção é
              cerimônia vazia. */}
          {opcoes.length > 1 ? (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2">
                {acao === 'bloquear' ? 'Quais canais bloquear' : 'Quais canais liberar'}
              </p>
              <div className="space-y-1.5">
                {opcoes.map(c => (
                  <label key={c}
                    className={clsx('flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer text-sm',
                      escolhidos.includes(c) ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="checkbox" checked={escolhidos.includes(c)} onChange={() => alternar(c)} className="rounded"/>
                    {icone(c)}
                    <span className="text-slate-700">{NOME_DO_CANAL[c]}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              {acao === 'bloquear'
                ? <>O contato vai ser bloqueado no <strong>{NOME_DO_CANAL[opcoes[0]]}</strong>.</>
                : <>O contato volta a ser atendido pelo <strong>{NOME_DO_CANAL[opcoes[0]]}</strong>.</>}
            </p>
          )}

          {bloqueados.length > 0 && acao === 'bloquear' && (
            <p className="text-[11px] text-amber-700">
              Já bloqueado em {bloqueados.map(c => NOME_DO_CANAL[c]).join(' e ')} — isso continua como está.
            </p>
          )}

          {acao === 'bloquear' && (
            <div className="text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2.5 space-y-1">
              <p>Mensagens novas pelo canal bloqueado deixam de abrir atendimento, e o envio por ele é recusado.</p>
              {/* A verdade sobre a assistente, dita antes e não depois. */}
              <p>
                A assistente de IA só é calada quando <strong>todos</strong> os canais do contato estão
                bloqueados. Bloqueando um canal só, ela continua respondendo — inclusive nele — até o
                fluxo do Instagram ser ajustado.
              </p>
              <p>Dá para desbloquear aqui mesmo depois.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
          <button onClick={onFechar} disabled={salvando}
            className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
          <button onClick={confirmar} disabled={salvando || escolhidos.length === 0}
            className={clsx('px-5 py-2.5 text-white text-sm font-medium rounded-lg flex items-center gap-2 disabled:opacity-50',
              acao === 'bloquear' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700')}>
            {salvando ? <Loader2 size={14} className="animate-spin"/> : acao === 'bloquear' ? <Ban size={14}/> : <ShieldCheck size={14}/>}
            {acao === 'bloquear' ? 'Bloquear' : 'Desbloquear'}
          </button>
        </div>
      </div>
    </div>
  )
}
