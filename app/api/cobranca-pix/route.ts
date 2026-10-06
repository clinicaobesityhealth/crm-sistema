import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { gerarBrCode, montarTxid } from '@/lib/pixBrCode'
import QRCode from 'qrcode'
import { saudacaoFormal } from '@/lib/tratamento'

// v47.06 — Cria uma cobrança PIX e dispara as três mensagens para o paciente.
//
// Antes, cobrar por PIX era abrir o site do meuairgo, digitar o valor e mandar o
// link na mão. Aquele site monta o código no navegador a partir de uma chave
// estática — não existe API nem conciliação do lado deles. Como o padrão do BR
// Code é público, o CRM gera o mesmo código sozinho e ainda registra a cobrança.
//
// O paciente recebe, em sequência:
//   1) texto com o link da página de pagamento (hospedada pelo próprio CRM)
//   2) a imagem do QR Code
//   3) o "copia e cola" em texto, para colar no app do banco
//
// O envio em si continua sendo o caminho de sempre: gravamos as mensagens com
// status 'queued' e o fluxo de saída do n8n as envia pelo WAHA.

export const runtime = 'nodejs'

const BUCKET = 'conversation-media'

function reais(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY configurada' }, { status: 503 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const contactId = String(body.contact_id || '')
  const valor = Number(body.valor)
  const descricao = String(body.descricao || '').trim()
  const criadoPor = body.criado_por || null
  const criadoPorNome = String(body.criado_por_nome || '').trim() || null

  if (!contactId) return NextResponse.json({ erro: 'Paciente não informado' }, { status: 400 })
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ erro: 'Valor inválido' }, { status: 400 })
  if (valor > 100000) return NextResponse.json({ erro: 'Valor acima do limite permitido' }, { status: 400 })

  // Configuração do recebedor — preenchida em Configurações -> Cobrança PIX.
  const { data: settings } = await admin.from('clinic_settings').select('id, pix_config').limit(1).single()
  const pix = (settings?.pix_config || {}) as any
  if (!pix.chave) {
    return NextResponse.json({ erro: 'Chave PIX não configurada. Vá em Configurações → Cobrança PIX.' }, { status: 400 })
  }

  const { data: contato } = await admin.from('contacts').select('id, full_name, phone').eq('id', contactId).single()
  if (!contato) return NextResponse.json({ erro: 'Paciente não encontrado' }, { status: 404 })

  // 1) monta o código
  let brcode: string
  try {
    brcode = gerarBrCode({
      chave: pix.chave,
      tipo: pix.tipo,
      nome: pix.nome_recebedor || 'OBESITY HEALTH',
      cidade: pix.cidade || 'SAO PAULO',
      valor,
      descricao: descricao || undefined,
      // v47.12 — vira o "Identificador" no app do banco e no extrato.
      txid: montarTxid(contato.full_name),
    })
  } catch (e: any) {
    return NextResponse.json({ erro: 'Não foi possível gerar o código PIX: ' + (e?.message || 'erro') }, { status: 500 })
  }

  // 2) registra a cobrança (antes de enviar, para nunca existir mensagem sem registro)
  const { data: cobranca, error: erroIns } = await admin.from('cobrancas_pix').insert({
    contact_id: contactId,
    valor,
    descricao: descricao || null,
    brcode,
    status: 'enviada',
    criado_por: criadoPor,
    criado_por_nome: criadoPorNome,
  }).select().single()
  if (erroIns || !cobranca) {
    return NextResponse.json({ erro: 'Não foi possível registrar a cobrança: ' + (erroIns?.message || '') }, { status: 500 })
  }

  // 3) gera o QR e guarda no storage, para poder mandar como imagem no WhatsApp
  let qrUrl: string | null = null
  try {
    const png = await QRCode.toBuffer(brcode, { type: 'png', width: 600, margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' } })
    const caminho = `cobranca-pix/${cobranca.id}.png`
    const { error: erroUp } = await admin.storage.from(BUCKET)
      .upload(caminho, png, { upsert: true, contentType: 'image/png' })
    if (!erroUp) {
      qrUrl = admin.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl
      await admin.from('cobrancas_pix').update({ qr_url: qrUrl }).eq('id', cobranca.id)
    }
  } catch {
    // Sem o QR a cobrança ainda funciona: o paciente tem o link e o copia e cola.
  }

  // 4) as três mensagens, em ordem. 'queued' é o que faz o fluxo de saída enviar.
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br').replace(/\/$/, '')
  const link = `${base}/pagar/${cobranca.id}`
  // v47.19 — tratamento formal, igual ao da cobrança no cartão.
  const textoLink = `${saudacaoFormal(contato.full_name)}\n\n` +
    `Segue o link para o pagamento de ${reais(valor)}${descricao ? ` — ${descricao}` : ''}:\n${link}` +
    // v48.56 — o comprovante é o que permite a Sofia confirmar o pagamento na hora.
    `\n\nApós o pagamento, envie o comprovante aqui nesta conversa para confirmarmos.`
  // v47.08 — o "copia e cola" vai SOZINHO numa mensagem. Junto com texto, o
  // paciente não consegue copiar só o código: o WhatsApp copia o balão inteiro
  // e o app do banco recusa. Por isso a instrução vai numa mensagem e o código
  // em outra, limpa.
  const textoInstrucao = 'Se preferir, copie o código abaixo e cole no aplicativo do seu banco:'

  const mensagens: any[] = [
    { contact_id: contactId, channel: 'whatsapp', direction: 'outbound', content: textoLink, status: 'queued', sender_id: criadoPor },
  ]
  if (qrUrl) {
    mensagens.push({ contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
      content: `QR Code para pagamento de ${reais(valor)}`, media_url: qrUrl, media_type: 'image',
      status: 'queued', sender_id: criadoPor })
  }
  mensagens.push({ contact_id: contactId, channel: 'whatsapp', direction: 'outbound', content: textoInstrucao, status: 'queued', sender_id: criadoPor })
  mensagens.push({ contact_id: contactId, channel: 'whatsapp', direction: 'outbound', content: brcode, status: 'queued', sender_id: criadoPor })

  // Uma a uma e em sequência: o webhook de saída dispara a cada inserção, e
  // inserir tudo de uma vez faria as três saírem embaralhadas no WhatsApp.
  const falhas: string[] = []
  for (const m of mensagens) {
    const { error } = await admin.from('messages').insert(m)
    if (error) falhas.push(error.message)
    await new Promise(r => setTimeout(r, 1200))
  }

  if (falhas.length === mensagens.length) {
    return NextResponse.json({ erro: 'A cobrança foi registrada, mas nenhuma mensagem pôde ser enviada: ' + falhas[0] }, { status: 500 })
  }

  return NextResponse.json({
    sucesso: true,
    cobranca_id: cobranca.id,
    link,
    brcode,
    qr_url: qrUrl,
    parcial: falhas.length > 0 ? 'Algumas mensagens falharam ao enviar' : null,
  })
}
