// v48.50 — Dar baixa numa cobrança da InfinitePay. Só no servidor.
//
// Chamado de dois lugares, de propósito:
//   - do webhook, quando a InfinitePay avisa que o pagamento foi aprovado;
//   - da página de "pagamento enviado", para onde o paciente volta depois de
//     pagar, com os mesmos identificadores no endereço.
// Se um dos dois falhar, o outro dá a baixa. Os dois passam pela mesma
// conferência — o aviso não é assinado, então quem diz "pago" é sempre a
// resposta do /payment_check, nunca o que chegou no pedido.

import type { getSupabaseAdmin } from './supabaseAdmin'
import { conferirPagamentoInfinitePay, normalizarInfinitePay } from './infinitepay'

type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export type ResultadoBaixa =
  | { ok: true; ja_estava_paga: boolean; divergencia: string | null }
  | { ok: false; motivo: string; tentar_de_novo: boolean }

export async function baixarInfinitePay(admin: Admin, e: {
  order_nsu?: string | null
  transaction_nsu?: string | null
  slug?: string | null
  receipt_url?: string | null
}): Promise<ResultadoBaixa> {
  const orderNsu = String(e.order_nsu || '').trim()
  const transactionNsu = String(e.transaction_nsu || '').trim()
  const slug = String(e.slug || '').trim()

  if (!/^[0-9a-f-]{36}$/i.test(orderNsu)) return { ok: false, motivo: 'order_nsu não é de uma cobrança do CRM', tentar_de_novo: false }
  if (!transactionNsu || !slug) return { ok: false, motivo: 'faltam transaction_nsu ou slug', tentar_de_novo: false }

  const { data: cob } = await admin.from('cobrancas_cartao')
    .select('id, status, parcelas, valor_total, valor_liquido, provedor, taxa_aplicada')
    .eq('id', orderNsu).maybeSingle()
  if (!cob) return { ok: false, motivo: 'cobrança não encontrada', tentar_de_novo: false }
  if (cob.status === 'paga') return { ok: true, ja_estava_paga: true, divergencia: null }

  const { data: settings } = await admin.from('clinic_settings').select('infinitepay_config').limit(1).maybeSingle()
  const cfg = normalizarInfinitePay((settings as any)?.infinitepay_config)
  if (!cfg.handle) return { ok: false, motivo: 'InfiniteTag não configurada', tentar_de_novo: false }

  let conf
  try {
    conf = await conferirPagamentoInfinitePay(cfg, { order_nsu: orderNsu, transaction_nsu: transactionNsu, slug })
  } catch (err: any) {
    // Falha de rede ou da InfinitePay: pede para ela reenviar o aviso depois.
    return { ok: false, motivo: 'conferência falhou: ' + (err?.message || err), tentar_de_novo: true }
  }
  if (!conf.success || !conf.paid) return { ok: false, motivo: 'a InfinitePay não confirma o pagamento', tentar_de_novo: false }

  // O parcelamento é escolhido pelo paciente na página da InfinitePay. Se ele
  // escolheu diferente do que foi precificado, a clínica pode receber menos que
  // o combinado — isso tem que aparecer para a secretária, não sumir.
  const pagoCentavos = conf.paid_amount ?? conf.amount
  const partes: string[] = []
  // Só importa quando o CRM embutiu a taxa de um parcelamento no valor. Quando a
  // própria InfinitePay acrescenta os juros (taxa_aplicada = 0), qualquer
  // parcelamento é válido e a clínica recebe o mesmo valor.
  const crmEmbutiuTaxa = Number((cob as any).taxa_aplicada) > 0
  if (crmEmbutiuTaxa && conf.capture_method === 'credit_card' && conf.installments && cob.parcelas && conf.installments !== cob.parcelas) {
    partes.push(`Precificado para ${cob.parcelas}x, pago em ${conf.installments}x`)
  }
  const totalCent = Math.round(Number(cob.valor_total) * 100)
  if (conf.amount !== null && Math.abs(conf.amount - totalCent) > 1) {
    partes.push(`valor do link ${(conf.amount / 100).toFixed(2)} diferente do registrado ${(totalCent / 100).toFixed(2)}`)
  }
  const divergencia = partes.length ? partes.join('; ') : null

  const agora = new Date().toISOString()
  const { error } = await admin.from('cobrancas_cartao').update({
    status: 'paga',
    confirmado_em: agora,
    pago_em: agora,
    transaction_nsu: transactionNsu,
    infinitepay_slug: slug,
    receipt_url: e.receipt_url || null,
    valor_pago: pagoCentavos !== null ? pagoCentavos / 100 : null,
    parcelas_pagas: conf.installments,
    forma_pagamento: conf.capture_method,
    divergencia,
  }).eq('id', cob.id)
  if (error) return { ok: false, motivo: 'não consegui gravar a baixa: ' + error.message, tentar_de_novo: true }

  // v48.55 — Registro na conversa do paciente, visível só para a equipe
  // ([INTERNO] com status "sent": nada é enviado ao WhatsApp).
  try {
    const { data: c2 } = await admin.from('cobrancas_cartao').select('contact_id, descricao').eq('id', cob.id).maybeSingle()
    if (c2?.contact_id) {
      const valor = pagoCentavos !== null ? (pagoCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
      const forma = conf.capture_method === 'pix' ? 'PIX' : ((conf.installments || 1) > 1 ? `cartão em ${conf.installments}x` : 'cartão à vista')
      await admin.from('messages').insert({
        contact_id: c2.contact_id, channel: 'whatsapp', direction: 'outbound', status: 'sent',
        content: `[INTERNO] 💳 Pagamento recebido: ${valor} (${forma})${c2.descricao ? ' — ' + c2.descricao : ''}${divergencia ? '. Atenção: ' + divergencia : ''}${e.receipt_url ? '\nComprovante: ' + e.receipt_url : ''}`,
      })
    }
  } catch {}

  return { ok: true, ja_estava_paga: false, divergencia }
}
