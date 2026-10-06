import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { marcarRealizada } from '@/lib/rgo'
import { capitalizarNome, primeiroNome, saudacaoFormal } from '@/lib/tratamento'

// v48.59 — Descrição cirúrgica pela tela da secretária.
//   multipart (arquivos)  — anexar a descrição que chegou por outro caminho
//                           (WhatsApp, e-mail) → marca a cirurgia como realizada
//   JSON {acao:'enviar'}  — manda a descrição ao paciente pelo WhatsApp, para ele
//                           pedir o reembolso → também marca como realizada

export const runtime = 'nodejs'
export const maxDuration = 60

async function quemEsta(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  })
  const { data: { user } } = await pub.auth.getUser(token)
  return user
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await quemEsta(req)
  if (!user) return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  const { data: agente } = await admin.from('agents').select('id, name').eq('id', user.id).maybeSingle()
  const nomeAgente = agente?.name || 'Equipe'

  const id = String(params.id || '')
  const { data: c } = await admin.from('cirurgias')
    .select('id, contact_id, paciente_nome, paciente_telefone, status, categoria, rgo_arquivos, procedimento_nome, data_cirurgia')
    .eq('id', id).maybeSingle()
  if (!c) return NextResponse.json({ erro: 'Cirurgia não encontrada' }, { status: 404 })
  const arquivos: any[] = Array.isArray(c.rgo_arquivos) ? c.rgo_arquivos : []

  const tipoConteudo = req.headers.get('content-type') || ''

  // --- anexar ---------------------------------------------------------------
  if (tipoConteudo.includes('multipart/form-data')) {
    const form = await req.formData()
    const files = form.getAll('arquivos').filter(f => typeof f !== 'string') as File[]
    if (!files.length) return NextResponse.json({ erro: 'Nenhum arquivo.' }, { status: 400 })
    const novos: any[] = []
    for (let i = 0; i < files.length; i++) { const f = files[i]
      const tipo = f.type || 'application/octet-stream'
      if (!/^image\/|^application\/pdf$/.test(tipo)) return NextResponse.json({ erro: `"${f.name}" não é foto nem PDF.` }, { status: 400 })
      if (f.size > 15 * 1024 * 1024) return NextResponse.json({ erro: `"${f.name}" passa de 15 MB.` }, { status: 400 })
      const ext = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
      const caminho = `${c.id}/${Date.now()}-${i}.${ext}`
      const { error } = await admin.storage.from('rgo').upload(caminho, Buffer.from(await f.arrayBuffer()), { contentType: tipo })
      if (error) return NextResponse.json({ erro: 'Não consegui guardar: ' + error.message }, { status: 500 })
      novos.push({ url: admin.storage.from('rgo').getPublicUrl(caminho).data.publicUrl, nome: f.name, tipo, categoria: 'rgo', enviado_em: new Date().toISOString(), por: nomeAgente })
    }
    await admin.from('cirurgias').update({ rgo_arquivos: [...arquivos, ...novos], rgo_recebida_em: new Date().toISOString() }).eq('id', c.id)
    await marcarRealizada(admin, c, nomeAgente)
    return NextResponse.json({ ok: true, total: arquivos.length + novos.length })
  }

  // --- remover um arquivo -------------------------------------------------------
  let b: any = {}
  try { b = await req.json() } catch {}
  if (b.acao === 'remover') {
    const resto = arquivos.filter(a => a.url !== b.url)
    await admin.from('cirurgias').update({ rgo_arquivos: resto }).eq('id', c.id)
    return NextResponse.json({ ok: true, total: resto.length })
  }

  // --- enviar ao paciente ------------------------------------------------------
  if (b.acao === 'enviar') {
    // Ao paciente vai a descrição cirúrgica (os "outros documentos" ficam só na clínica).
    const paraEnviar = arquivos.filter(a => a.categoria !== 'documento')
    if (!paraEnviar.length) return NextResponse.json({ erro: 'Ainda não há descrição cirúrgica anexada.' }, { status: 400 })
    let contactId = c.contact_id
    if (!contactId) return NextResponse.json({ erro: 'Esta cirurgia não está ligada a um contato do CRM. Vincule o paciente na cirurgia antes de enviar.' }, { status: 400 })
    const { data: contato } = await admin.from('contacts').select('full_name').eq('id', contactId).maybeSingle()

    // v48.64 — O texto vem das Configurações (Cirurgias → Mensagens). Mudar o
    // tom de uma mensagem não pode depender de subir versão nova do sistema.
    const { data: cfg } = await admin.from('clinic_settings').select('rgo_mensagem').limit(1).maybeSingle()
    const nome = contato?.full_name || c.paciente_nome
    const modelo = String((cfg as any)?.rgo_mensagem || '').trim() ||
      '{saudacao}\n\nSegue a descrição cirúrgica ({cirurgia}) para a solicitação de reembolso junto ao seu convênio.\n\nQualquer dúvida, estamos à disposição.'
    const texto = modelo
      .replace(/\{saudacao\}/g, saudacaoFormal(nome))
      .replace(/\{primeiro_nome\}/g, primeiroNome(nome))
      .replace(/\{paciente\}/g, capitalizarNome(nome))
      .replace(/\{cirurgia\}/g, c.procedimento_nome || 'descrição cirúrgica')
      .replace(/\{data\}/g, c.data_cirurgia ? String(c.data_cirurgia).slice(0, 10).split('-').reverse().join('/') : '')
      // Um campo vazio deixaria "(  )" ou espaços duplos no meio da frase.
      .replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').trim()
    const msgs: any[] = [{ contact_id: contactId, channel: 'whatsapp', direction: 'outbound', content: texto, status: 'queued', sender_id: agente?.id ?? null }]
    paraEnviar.forEach((a, i) => msgs.push({
      contact_id: contactId, channel: 'whatsapp', direction: 'outbound', status: 'queued', sender_id: agente?.id ?? null,
      media_url: a.url, media_type: String(a.tipo || '').startsWith('image/') ? 'image' : 'document',
      content: String(a.tipo || '').startsWith('image/') ? '' : (a.nome || `descricao-cirurgica-${i + 1}.pdf`),
    }))
    for (const m of msgs) {
      const { error } = await admin.from('messages').insert(m)
      if (error) return NextResponse.json({ erro: 'Não consegui enfileirar a mensagem: ' + error.message }, { status: 500 })
      await new Promise(r => setTimeout(r, 900))
    }
    await admin.from('cirurgias').update({ rgo_enviada_paciente_em: new Date().toISOString() }).eq('id', c.id)
    await marcarRealizada(admin, c, nomeAgente)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ erro: 'Ação inválida' }, { status: 400 })
}
