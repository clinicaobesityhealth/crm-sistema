import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v48.48 — Trazer a foto de perfil do Instagram e GUARDAR.
//
// O endereço que o Instagram entrega para a foto é assinado e vence. Guardá-lo
// no cadastro é guardar um bilhete com prazo: passa o prazo, a foto some, e
// tentar de novo não adianta porque o pedido é para o mesmo endereço morto.
//
// Esta rota faz o que deveria ter sido feito desde o começo: pergunta à Meta
// qual é a foto de agora, BAIXA a imagem e guarda no armazenamento da própria
// clínica. O endereço que vai para o cadastro é nosso, e não vence.
//
// Roda no servidor porque precisa do token das contas — que não deve passar
// pelo navegador de ninguém.

export const runtime = 'nodejs'
export const maxDuration = 30

const LISTA_CONTAS = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/ig-accounts-list'
const BUCKET = 'avatares'

type Conta = { nome_conta?: string; instagram_business_account_id?: string; access_token?: string; ativo?: string }

const ligada = (v: any) => {
  if (v === true || v === 1) return true
  const t = String(v ?? '').trim().toLowerCase()
  return t === 'sim' || t === 's' || t === 'true' || t === '1' || t === 'ativa' || t === 'ativo'
}

// Os identificadores do Instagram de um contato, nas formas que já existiram.
function psidsDoContato(c: any): string[] {
  const cf = c?.custom_fields || {}
  const achados: string[] = []
  const add = (v: any) => { const s = String(v || '').trim(); if (s && !achados.includes(s)) achados.push(s) }
  if (typeof c?.phone === 'string' && c.phone.startsWith('ig:')) add(c.phone.slice(3))
  add(cf.instagram_psid)
  add(cf.ig_sender_psid)
  if (Array.isArray(cf.instagram_contas)) cf.instagram_contas.forEach((x: any) => add(x?.psid))
  return achados
}

export async function POST(req: Request) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ ok: false, erro: 'Banco indisponível.' }, { status: 500 })

  let body: any = null
  try { body = await req.json() } catch {}
  const contactId = String(body?.contact_id || '').trim()
  if (!contactId) return NextResponse.json({ ok: false, erro: 'Informe o contato.' }, { status: 400 })

  const { data: contato } = await admin.from('contacts')
    .select('id, phone, custom_fields, avatar_url').eq('id', contactId).maybeSingle()
  if (!contato) return NextResponse.json({ ok: false, erro: 'Contato não encontrado.' }, { status: 404 })

  const psids = psidsDoContato(contato)
  if (psids.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Este contato não tem Instagram vinculado.' }, { status: 400 })
  }

  let contas: Conta[] = []
  try {
    const r = await fetch(LISTA_CONTAS, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    const j = await r.json()
    contas = Array.isArray(j) ? j : (j.contas || j.accounts || j.data || [])
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: 'Não consegui ler as contas do Instagram: ' + (e?.message || String(e)) }, { status: 502 })
  }
  const ativas = contas.filter(c => ligada(c.ativo) && String(c.access_token || '').trim())
  if (ativas.length === 0) return NextResponse.json({ ok: false, erro: 'Nenhuma conta do Instagram ativa.' }, { status: 400 })

  // Cada identificador só existe dentro da conta em que a pessoa escreveu, e o
  // cadastro nem sempre diz qual é — por isso tenta todas as combinações até
  // uma responder. São poucas contas; o custo é irrelevante e evita depender de
  // um campo que pode estar em branco.
  let urlDaFoto: string | null = null
  let tentativas: string[] = []
  for (const psid of psids) {
    for (const conta of ativas) {
      const token = String(conta.access_token)
      const base = token.startsWith('IGA') ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0'
      try {
        const r = await fetch(`${base}/${psid}?fields=name,profile_pic&access_token=${encodeURIComponent(token)}`, {
          signal: AbortSignal.timeout(10000),
        })
        const j = await r.json()
        if (r.ok && j?.profile_pic) { urlDaFoto = String(j.profile_pic); break }
        if (j?.error?.message) tentativas.push(`${conta.nome_conta}: ${j.error.message}`)
      } catch (e: any) {
        tentativas.push(`${conta.nome_conta}: ${e?.message || String(e)}`)
      }
    }
    if (urlDaFoto) break
  }

  if (!urlDaFoto) {
    return NextResponse.json({
      ok: false,
      erro: 'A Meta não devolveu foto para este contato. Isso acontece quando a pessoa não tem foto de perfil, '
        + 'ou quando a conversa é antiga demais para a Meta ainda dar acesso ao perfil.',
      detalhes: tentativas.slice(0, 3),
    }, { status: 404 })
  }

  // Baixar agora, enquanto o endereço ainda vale. É este o passo que faltava.
  let bytes: ArrayBuffer
  let tipo = 'image/jpeg'
  try {
    const img = await fetch(urlDaFoto, { signal: AbortSignal.timeout(20000) })
    if (!img.ok) throw new Error('a Meta recusou o download da imagem (' + img.status + ')')
    tipo = img.headers.get('content-type') || tipo
    bytes = await img.arrayBuffer()
  } catch (e: any) {
    return NextResponse.json({ ok: false, erro: 'Não consegui baixar a foto: ' + (e?.message || String(e)) }, { status: 502 })
  }

  const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
  // O nome muda a cada atualização para não esbarrar em cache de navegador: uma
  // foto nova com o mesmo endereço continuaria aparecendo velha.
  const caminho = `instagram/${contactId}-${Date.now()}.${ext}`

  const { error: erroUpload } = await admin.storage.from(BUCKET)
    .upload(caminho, bytes, { contentType: tipo, upsert: true })
  if (erroUpload) {
    return NextResponse.json({
      ok: false,
      erro: 'Não consegui guardar a foto: ' + erroUpload.message
        + '. Se disser que o bucket não existe, falta rodar a migração 20260918_fotos_de_perfil_v48_48.sql.',
    }, { status: 500 })
  }

  const { data: publico } = admin.storage.from(BUCKET).getPublicUrl(caminho)
  const avatar = publico?.publicUrl
  if (!avatar) return NextResponse.json({ ok: false, erro: 'A foto foi guardada mas não consegui o endereço dela.' }, { status: 500 })

  const campos = { ...((contato as any).custom_fields || {}), avatar_origem: 'instagram', avatar_atualizado_em: new Date().toISOString() }
  const { error: erroUpdate } = await admin.from('contacts')
    .update({ avatar_url: avatar, custom_fields: campos, updated_at: new Date().toISOString() })
    .eq('id', contactId)
  if (erroUpdate) return NextResponse.json({ ok: false, erro: 'Foto guardada, mas não consegui salvar no cadastro: ' + erroUpdate.message }, { status: 500 })

  return NextResponse.json({ ok: true, avatar_url: avatar })
}
