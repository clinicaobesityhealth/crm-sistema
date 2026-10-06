'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CreditCard, QrCode, FileText, Loader2, ExternalLink, AlertTriangle, RefreshCw, Trash2, CheckSquare, Square } from 'lucide-react'
import clsx from 'clsx'

// v48.127 — Registrar pagamento manualmente: a Sofia dá baixa sozinha no PIX
// (lendo o comprovante) e o cartão dá baixa sozinho pelo webhook da
// InfinitePay/Safra — mas se a Sofia estava desligada na hora (relato real:
// paciente pagou por PIX, ninguém leu o comprovante, ficou "Aguardando
// pagamento" para sempre), não existia jeito de corrigir isso na tela, só
// excluir e perder o registro. Clicar na etiqueta "Aguardando pagamento"
// (só nela — não em "Pago"/"Cancelado"/etc, que não têm o que confirmar)
// pede confirmação e registra o pagamento na hora.

// v48.57 — Aba "Recibos" do paciente: tudo o que envolve pagamento, num lugar
// só, do mais recente para o mais antigo.
//   - cobranças no cartão (InfinitePay / Safra), com o comprovante do cartão
//   - cobranças PIX, com o comprovante que o paciente mandou (quando houver)
//   - comprovantes que o paciente enviou na conversa (classificados pela Sofia)

type Item = {
  id: string
  registroId: string
  pago: boolean
  quando: string
  tipo: 'cartao' | 'pix' | 'comprovante'
  titulo: string
  valor: number | null
  status: { texto: string; cor: 'verde' | 'amarelo' | 'cinza' | 'vermelho' }
  detalhe: string
  link: string | null
  alerta: string | null
}

const brl = (v: number | null) => v == null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataHora = (iso: string) => {
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function statusCartao(s: string) {
  if (s === 'paga') return { texto: 'Pago', cor: 'verde' as const }
  if (s === 'erro') return { texto: 'Erro no link', cor: 'vermelho' as const }
  if (s === 'cancelada' || s === 'expirada' || s === 'negada') return { texto: s.charAt(0).toUpperCase() + s.slice(1), cor: 'cinza' as const }
  return { texto: 'Aguardando pagamento', cor: 'amarelo' as const }
}

export default function RecibosTab({ contactId }: { contactId: string }) {
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  // v48.58 — Excluir cobranças de teste / links gerados por engano.
  const [selecionando, setSelecionando] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState('')
  const [marcandoPago, setMarcandoPago] = useState<string | null>(null)

  async function marcarPago(i: Item) {
    if (i.tipo === 'comprovante' || marcandoPago) return
    if (!window.confirm(`Confirmar que "${i.titulo}"${i.valor ? ' de ' + brl(i.valor) : ''} foi pago?\n\nUse isto quando o pagamento aconteceu de verdade (ex.: PIX confirmado fora do CRM, Sofia desligada na hora) e não foi registrado sozinho.`)) return
    setMarcandoPago(i.id); setErro('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/cobrancas/marcar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ tipo: i.tipo, id: i.registroId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErro(j.erro || 'Não foi possível registrar o pagamento.')
      else await carregar()
    } catch (e: any) {
      setErro(e?.message || 'Falha de conexão.')
    }
    setMarcandoPago(null)
  }

  async function excluir(lista: Item[]) {
    if (!lista.length) return
    const pagos = lista.filter(i => i.pago).length
    const txt = lista.length === 1
      ? `Excluir "${lista[0].titulo}"${lista[0].valor ? ' de ' + brl(lista[0].valor) : ''}?`
      : `Excluir ${lista.length} registros?`
    const aviso = pagos ? `\n\nAtenção: ${pagos === 1 ? 'um deles já está PAGO' : pagos + ' já estão PAGOS'} (só administrador pode excluir).` : ''
    if (!window.confirm(txt + aviso + '\n\nIsto não tem volta. O link que o paciente já recebeu deixa de ser acompanhado pelo CRM.')) return
    setExcluindo(true); setErro('')
    const { data: { session } } = await supabase.auth.getSession()
    const falhas: string[] = []
    for (const i of lista) {
      try {
        const r = await fetch('/api/cobrancas/excluir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ tipo: i.tipo, id: i.registroId }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) falhas.push(j.erro || 'erro ' + r.status)
      } catch (e: any) { falhas.push(e?.message || 'falha de conexão') }
    }
    setExcluindo(false)
    setMarcados(new Set()); setSelecionando(false)
    if (falhas.length) setErro(`${falhas.length} não excluído(s): ${Array.from(new Set(falhas)).join('; ')}`)
    carregar()
  }

  function alternar(id: string) {
    setMarcados(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function carregar() {
    setCarregando(true)
    const [cartao, pix, msgs] = await Promise.all([
      supabase.from('cobrancas_cartao').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }).limit(100),
      supabase.from('cobrancas_pix').select('*').eq('contact_id', contactId).order('created_at', { ascending: false }).limit(100),
      supabase.from('messages').select('id, created_at, content, media_url')
        .eq('contact_id', contactId).eq('direction', 'inbound').ilike('content', '[ARQUIVO: comprovante_pagamento]%')
        .order('created_at', { ascending: false }).limit(100),
    ])
    const lista: Item[] = []

    for (const c of (cartao.data ?? []) as any[]) {
      const parcelas = Number(c.parcelas_pagas || c.parcelas) || 1
      const forma = c.status === 'paga'
        ? (c.forma_pagamento === 'pix' ? 'PIX' : parcelas > 1 ? `cartão em ${parcelas}x` : 'cartão à vista')
        : (Number(c.max_parcelas) > 1 ? `até ${c.max_parcelas}x` : '')
      lista.push({
        id: 'c-' + c.id, registroId: c.id, pago: c.status === 'paga',
        quando: c.pago_em || c.confirmado_em || c.created_at,
        tipo: 'cartao',
        titulo: 'Cartão' + (c.provedor === 'infinitepay' ? ' · InfinitePay' : c.provedor === 'safra' ? ' · Safra' : '') + (c.descricao ? ' — ' + c.descricao : ''),
        valor: Number(c.valor_pago ?? c.valor_total) || null,
        status: statusCartao(c.status),
        detalhe: [forma, c.criado_por_nome ? 'enviado por ' + c.criado_por_nome : ''].filter(Boolean).join(' · '),
        link: c.receipt_url || null,
        alerta: c.divergencia || null,
      })
    }

    for (const p of (pix.data ?? []) as any[]) {
      const paga = p.status === 'paga'
      lista.push({
        id: 'p-' + p.id, registroId: p.id, pago: paga,
        quando: p.pago_em || p.created_at,
        tipo: 'pix',
        titulo: 'PIX' + (p.descricao ? ' — ' + p.descricao : ''),
        valor: Number(p.valor) || null,
        status: paga ? { texto: 'Pago', cor: 'verde' } : p.status === 'cancelada' ? { texto: 'Cancelado', cor: 'cinza' } : { texto: 'Aguardando pagamento', cor: 'amarelo' },
        detalhe: [
          paga && p.confirmado_por === 'comprovante' ? 'confirmado pelo comprovante' : paga && p.baixa_por_nome ? 'baixa por ' + p.baixa_por_nome : '',
          p.criado_por_nome ? 'enviado por ' + p.criado_por_nome : '',
        ].filter(Boolean).join(' · '),
        link: p.comprovante?.media_url || null,
        alerta: paga && p.confirmado_por === 'comprovante' ? 'Conferir no extrato do banco' : null,
      })
    }

    // Comprovantes que o paciente mandou e que não viraram baixa de nenhuma
    // cobrança (os que viraram já aparecem no PIX acima, com o link).
    const usados = new Set(lista.map(i => i.link).filter(Boolean))
    for (const m of (msgs.data ?? []) as any[]) {
      if (m.media_url && usados.has(m.media_url)) continue
      const valorTxt = String(m.content || '').match(/valor=([0-9.,]+)/)?.[1] || ''
      const v = valorTxt ? Number(valorTxt.includes(',') ? valorTxt.replace(/\./g, '').replace(',', '.') : valorTxt) : null
      lista.push({
        id: 'm-' + m.id, registroId: m.id, pago: false,
        quando: m.created_at,
        tipo: 'comprovante',
        titulo: 'Comprovante enviado pelo paciente',
        valor: Number.isFinite(v as number) ? v : null,
        status: { texto: 'Recebido', cor: 'cinza' },
        detalhe: '',
        link: m.media_url || null,
        alerta: null,
      })
    }

    lista.sort((a, b) => String(b.quando).localeCompare(String(a.quando)))
    setItens(lista)
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [contactId])

  if (carregando) {
    return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin"/> Carregando...</div>
  }

  return (
    <div className="px-5 py-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{itens.length ? `${itens.length} registro${itens.length > 1 ? 's' : ''}, do mais recente ao mais antigo` : ''}</p>
        <div className="flex items-center gap-3">
          {itens.length > 0 && (
            <button onClick={() => { setSelecionando(v => !v); setMarcados(new Set()) }}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700">
              <CheckSquare size={11}/> {selecionando ? 'Cancelar' : 'Selecionar'}
            </button>
          )}
          <button onClick={carregar} className="flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700">
            <RefreshCw size={11}/> Atualizar
          </button>
        </div>
      </div>

      {selecionando && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
          <button onClick={() => setMarcados(new Set(itens.filter(i => !i.pago).map(i => i.id)))}
            className="text-[11px] font-medium text-brand-600">Marcar todos em aberto</button>
          <button disabled={!marcados.size || excluindo} onClick={() => excluir(itens.filter(i => marcados.has(i.id)))}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 text-white text-[11px] font-semibold disabled:opacity-40">
            {excluindo ? <Loader2 size={11} className="animate-spin"/> : <Trash2 size={11}/>} Excluir {marcados.size || ''}
          </button>
        </div>
      )}
      {erro && <p className="text-[11px] text-red-600">{erro}</p>}

      {itens.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mb-3"><FileText size={20} className="text-slate-400"/></div>
          <p className="text-sm text-slate-500">Nenhuma cobrança ou comprovante deste paciente</p>
        </div>
      )}

      {itens.map(i => (
        <div key={i.id} className={clsx('border rounded-xl p-3', marcados.has(i.id) ? 'border-red-300 bg-red-50/40' : 'border-slate-200')}>
          <div className="flex items-start gap-3">
            {selecionando && (
              <button onClick={() => alternar(i.id)} className="mt-1.5 text-slate-500 flex-shrink-0">
                {marcados.has(i.id) ? <CheckSquare size={15} className="text-red-600"/> : <Square size={15}/>}
              </button>
            )}
            <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
              i.tipo === 'cartao' ? 'bg-brand-50 text-brand-600' : i.tipo === 'pix' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
              {i.tipo === 'cartao' ? <CreditCard size={15}/> : i.tipo === 'pix' ? <QrCode size={15}/> : <FileText size={15}/>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-slate-800 truncate">{i.titulo}</p>
                <p className="text-sm font-semibold text-slate-800 flex-shrink-0">{brl(i.valor)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {i.tipo !== 'comprovante' && i.status.cor === 'amarelo' ? (
                  <button onClick={() => marcarPago(i)} disabled={marcandoPago === i.id}
                    title="Clique para registrar este pagamento como confirmado"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50">
                    {marcandoPago === i.id ? <Loader2 size={10} className="animate-spin"/> : null} {i.status.texto}
                  </button>
                ) : (
                  <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-semibold',
                    i.status.cor === 'verde' && 'bg-emerald-100 text-emerald-700',
                    i.status.cor === 'amarelo' && 'bg-amber-100 text-amber-700',
                    i.status.cor === 'vermelho' && 'bg-red-100 text-red-700',
                    i.status.cor === 'cinza' && 'bg-slate-100 text-slate-600')}>{i.status.texto}</span>
                )}
                <span className="text-[11px] text-slate-400">{dataHora(i.quando)}</span>
              </div>
              {i.detalhe && <p className="text-[11px] text-slate-500 mt-1">{i.detalhe}</p>}
              {i.alerta && <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1"><AlertTriangle size={11} className="mt-0.5 flex-shrink-0"/>{i.alerta}</p>}
              <div className="flex items-center gap-3 mt-1.5">
                {i.link && (
                  <a href={i.link} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 hover:text-brand-700">
                    <ExternalLink size={11}/> Ver comprovante
                  </a>
                )}
                {!selecionando && (
                  <button onClick={() => excluir([i])} disabled={excluindo}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-red-600 ml-auto">
                    <Trash2 size={11}/> Excluir
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
