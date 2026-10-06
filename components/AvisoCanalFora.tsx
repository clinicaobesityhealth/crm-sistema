'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { AlertTriangle, X } from 'lucide-react'

// A faixa vermelha de "um canal parou".
//
// v48.36 — Em 16/09 o token do Instagram venceu às 11:19 e ninguém soube. As
// mensagens entravam, a Sofia respondia dentro do CRM, e a Meta recusava cada
// envio em silêncio. Uma paciente ficou um dia inteiro esperando.
//
// O aviso mora aqui, na tela do Atendimento, e não numa tela de configuração
// que ninguém abre sem motivo: quem precisa saber que o canal caiu é quem está
// respondendo pacientes agora.
//
// v48.39 — Agora dá para fechar. Um aviso que não fecha vira um pedaço de tela
// perdido o dia inteiro, empurrando a lista e o menu para baixo — e quem já
// leu não precisa ler de novo a cada minuto.
//
// Fechar vale para esta sessão do navegador: ao entrar de novo no CRM, o aviso
// volta. E volta antes disso se o problema MUDAR (outra conta, outro horário),
// porque aí é notícia nova. A memória é por problema, não por tela.

const CHAVE_ULTIMA = 'crm_saude_canais_verificado_em'
const CHAVE_FECHADO = 'crm_saude_canais_fechado'
const UMA_HORA = 60 * 60 * 1000

type Linha = { canal: string; conta: string; ok: boolean; expirado_em: string | null; desde: string | null }

// A "assinatura" do problema: quais canais, quais contas, desde quando. Se
// qualquer uma dessas coisas mudar, o aviso reaparece mesmo já tendo sido
// fechado.
const assinatura = (fora: Linha[]) =>
  fora.map(f => `${f.canal}:${f.conta}:${f.expirado_em || f.desde || ''}`).sort().join('|')

export default function AvisoCanalFora() {
  const [fora, setFora] = useState<Linha[]>([])
  const [fechada, setFechada] = useState('')

  useEffect(() => {
    let vivo = true

    try { setFechada(sessionStorage.getItem(CHAVE_FECHADO) || '') } catch {}

    async function ler() {
      const { data } = await supabase.from('canal_saude').select('canal, conta, ok, expirado_em, desde').eq('ok', false)
      if (vivo) setFora((data ?? []) as Linha[])
    }

    async function conferirSePreciso() {
      let ultima = 0
      try { ultima = Number(localStorage.getItem(CHAVE_ULTIMA) || 0) } catch {}
      if (Date.now() - ultima < UMA_HORA) return
      try {
        localStorage.setItem(CHAVE_ULTIMA, String(Date.now()))
        await fetch('/api/instagram/saude', { cache: 'no-store' })
      } catch {}
    }

    ler()
    conferirSePreciso().then(ler)
    return () => { vivo = false }
  }, [])

  if (fora.length === 0) return null

  const agora = assinatura(fora)
  if (fechada === agora) return null

  const fechar = () => {
    try { sessionStorage.setItem(CHAVE_FECHADO, agora) } catch {}
    setFechada(agora)
  }

  const desde = fora[0].expirado_em || fora[0].desde
  const quando = desde
    ? new Date(desde).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm shrink-0">
      <AlertTriangle size={16} className="shrink-0"/>
      <p className="flex-1 min-w-0 leading-snug">
        <span className="font-semibold">
          {fora.length === 1
            ? `O ${fora[0].canal === 'instagram' ? 'Instagram' : fora[0].canal} não está enviando mensagens`
            : `${fora.length} canais não estão enviando mensagens`}
        </span>
        <span className="text-red-50 text-xs">
          {quando ? ` · desde ${quando}` : ''} · as mensagens chegam, mas nenhuma resposta sai.{' '}
          <Link href="/settings/instagram" className="underline font-semibold">Ver e renovar a conexão</Link>
        </span>
      </p>
      {/* Fechar não resolve o problema, e por isso o aviso volta no próximo
          acesso — mas quem já leu consegue trabalhar sem ele na frente. */}
      <button onClick={fechar} title="Fechar até o próximo acesso"
        className="shrink-0 p-1 rounded hover:bg-red-700/60" aria-label="Fechar aviso">
        <X size={15}/>
      </button>
    </div>
  )
}
