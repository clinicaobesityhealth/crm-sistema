'use client'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, HelpCircle } from 'lucide-react'
import clsx from 'clsx'

// O estado da conexão com o Instagram, dito na tela.
//
// v48.35 — Em 16/09 o token venceu às 11:19. As mensagens continuaram
// entrando, a Sofia continuou respondendo dentro do CRM, e nada saía: a Meta
// recusava cada envio, e o fluxo do n8n marcava "sucesso" porque o nó está
// configurado para não falhar. Uma paciente ficou um dia sem resposta.
//
// v48.37 — A primeira versão lia o resultado do banco, e por isso dizia
// "funcionando · nenhuma conta ativa" quando a gravação falhava — duas frases
// que se contradizem na mesma caixa. Agora a tela mostra o que a conferência
// ACABOU de responder; o banco serve para o aviso das outras telas.
//
// v48.39 — A conferência da v48.38 batia numa porta que não existe e pintava
// de vermelho até conta que estava funcionando. Corrigida. E a tela agora
// separa os dois problemas, porque a solução de cada um é outra: token VENCIDO
// pede um token novo; token do TIPO ERRADO pede um token de outro tipo — gerar
// outro igual não adianta.

type Conta = {
  conta: string
  ok: boolean
  via?: string | null
  comeco?: string | null
  mensagem: string | null
  expirado_em: string | null
}
type Resposta = { ok: boolean; cadastradas?: number; conferidas?: number; verificado_em?: string; contas?: Conta[]; erro?: string }

const dataHora = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

export default function SaudeInstagram() {
  const [r, setR] = useState<Resposta | null>(null)
  const [conferindo, setConferindo] = useState(false)
  const [erro, setErro] = useState('')

  const conferir = useCallback(async () => {
    setConferindo(true); setErro('')
    try {
      const resp = await fetch('/api/instagram/saude', { cache: 'no-store' })
      const j: Resposta = await resp.json()
      if (!resp.ok) setErro(j?.erro || 'Não foi possível conferir agora.')
      else setR(j)
    } catch (e: any) {
      setErro('Não foi possível conferir agora: ' + (e?.message || String(e)))
    }
    setConferindo(false)
  }, [])

  // Ao abrir a tela, confere de novo. É a tela de quem veio justamente
  // desconfiar da conexão — mostrar o estado de ontem seria inútil.
  useEffect(() => { conferir() }, [conferir])

  const contas = r?.contas ?? []
  const fora = contas.filter(c => !c.ok)
  const semContas = !!r && contas.length === 0

  // Três estados, e não dois: funcionando, com problema, e "não há o que
  // conferir". O terceiro existia e estava sendo pintado de verde.
  const cor = fora.length > 0 ? 'vermelho' : semContas ? 'cinza' : 'verde'

  return (
    <div className={clsx('mb-6 rounded-xl border p-4',
      cor === 'vermelho' ? 'border-red-200 bg-red-50'
        : cor === 'cinza' ? 'border-slate-200 bg-slate-50'
        : 'border-emerald-200 bg-emerald-50')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {cor === 'vermelho' ? <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5"/>
            : cor === 'cinza' ? <HelpCircle size={18} className="text-slate-400 shrink-0 mt-0.5"/>
            : <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5"/>}
          <div>
            <p className={clsx('text-sm font-semibold',
              cor === 'vermelho' ? 'text-red-800' : cor === 'cinza' ? 'text-slate-700' : 'text-emerald-800')}>
              {conferindo ? 'Conferindo a conexão com a Meta...'
                : cor === 'vermelho' ? 'O Instagram não está enviando mensagens'
                : cor === 'cinza' ? 'Nada foi conferido'
                : 'Conexão do Instagram funcionando'}
            </p>
            {!conferindo && cor === 'verde' && (
              <p className="text-xs text-emerald-700 mt-0.5">
                {contas.length} conta{contas.length > 1 ? 's' : ''} conferida{contas.length > 1 ? 's' : ''} agora,
                {' '}{dataHora(r?.verificado_em)}
              </p>
            )}
            {!conferindo && cor === 'cinza' && (
              <p className="text-xs text-slate-500 mt-0.5">
                {r?.cadastradas
                  ? `Há ${r.cadastradas} conta(s) no cadastro, mas nenhuma marcada como ativa com token — nada a conferir.`
                  : 'Não consegui ler as contas cadastradas.'}
              </p>
            )}
          </div>
        </div>
        <button onClick={conferir} disabled={conferindo}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 shrink-0">
          {conferindo ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Conferir
        </button>
      </div>

      {erro && <p className="mt-2 text-xs text-red-700">{erro}</p>}

      {contas.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {contas.map(c => (
            <div key={c.conta} className="rounded-lg bg-white/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-700">
                  {c.conta}
                  {/* O começo do token diz de qual mundo ele veio. É a
                      informação que faltava quando a dúvida era "mas eu sempre
                      usei token de usuário". */}
                  {/* Por onde o envio está passando. Depois de 17/09 essa é a
                      informação que decide tudo: a Meta fechou o caminho da
                      conta do Instagram e só aceita o da página. */}
                  {c.ok && c.via && (
                    <span className="ml-1.5 text-[11px] font-normal text-slate-400">envia pela {c.via}</span>
                  )}
                </span>
                <span className={clsx('text-xs font-semibold', c.ok ? 'text-emerald-700' : 'text-red-700')}>
                  {c.ok ? 'enviando' : 'sem enviar'}
                </span>
              </div>
              {!c.ok && (
                <div className="mt-1 space-y-0.5">
                  {/* A data importa mais do que a mensagem: é ela que diz
                      quantos pacientes ficaram sem resposta. */}
                  {c.expirado_em && (
                    <p className="text-xs text-red-700 font-semibold">Token venceu em {dataHora(c.expirado_em)}</p>
                  )}
                  <p className="text-xs text-red-700">
                    As mensagens continuam chegando, mas nenhuma resposta sai — nem a sua, nem a da assistente.
                  </p>
                  {c.mensagem && (
                    <p className="text-[11px] text-slate-600 leading-snug">{c.mensagem.slice(0, 400)}</p>
                  )}
                  {/* Cada problema tem a sua saída. Dizer "gere um token novo"
                      para quem está com o TIPO errado faz a pessoa gerar o
                      mesmo token de novo — foi o que aconteceu em 17/09. */}
                  {/* Nem todo problema aqui se resolve com token novo — em
                      17/09 a Meta mudou o caminho do envio, e trocar o token
                      não adiantava nada. A instrução acompanha o diagnóstico. */}
                  <p className="text-xs text-red-800 pt-0.5">
                    {c.expirado_em
                      ? 'Gere um token novo no Meta for Developers e cole no cadastro desta conta, abaixo. Token vencido não volta atrás: tem que ser um novo.'
                      : 'Leia a mensagem acima antes de gerar outro token: quando a Meta muda o caminho do envio, token novo não resolve.'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
