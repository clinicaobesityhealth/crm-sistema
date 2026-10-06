import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// v46.86 — Rota pública (sem login) usada pelo link de confirmação de consulta
// enviado por WhatsApp (ver sync_consulta_confirmation_reminder() no banco).
// O paciente abre /confirmar/[id] (página) que chama esta API.
//
// GET  -> dados mínimos e seguros da consulta, pra montar a página.
// POST -> { action: 'confirm' | 'decline' }
//   - 'confirm': só marca patient_confirmed_at. NUNCA mexe na coluna `status`
//     (essa continua 100% controlada pelo sync automático com o MedX).
//   - 'decline': marca patient_declined_at, transfere a conversa pro setor
//     Atenção e avisa a secretária. Se a Sofia estiver ativa pra este contato
//     (contacts.sofia_paused falsy), também dispara uma mensagem dela
//     oferecendo remarcar; se não, só o aviso interno mesmo.
//
// Importante: em nenhum dos dois casos este endpoint mexe em `sofia_paused`
// — se a Sofia já estava ativa, continua ativa depois da transferência de
// setor (diferente do fluxo manual de "Assumir/Transferir" no Inbox, que
// sempre pausa a Sofia).

export const runtime = 'nodejs'

// Setor "ATENÇÃO" — id fixo confirmado no banco de produção (tabela sectors).
const SETOR_ATENCAO_ID = '9a6789c0-b582-47d0-873f-7577ccfab461'

function formatDataBR(iso: string | null | undefined) {
  if (!iso) return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  if (!ano || !mes || !dia) return iso
  return `${dia}/${mes}/${ano}`
}

function formatHoraBR(hora: string | null | undefined) {
  if (!hora) return ''
  return hora.slice(0, 5)
}

function primeiroNome(nomeCompleto: string | null | undefined) {
  const nome = (nomeCompleto || '').trim().split(/\s+/)[0] || ''
  if (!nome) return 'tudo bem'
  return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase()
}

async function carregarAgendamento(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>, id: string) {
  const { data, error } = await admin
    .from('agendamentos')
    .select('id, contact_id, paciente_nome, profissional_nome, data, hora, status, medx_agendamento_id, patient_confirmed_at, patient_declined_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ error: 'Confirmação indisponível no momento. Tente novamente mais tarde ou fale com a secretária.' }, { status: 503 })

  try {
    const ag = await carregarAgendamento(admin, params.id)
    if (!ag) return NextResponse.json({ error: 'Link de confirmação inválido ou expirado.' }, { status: 404 })

    return NextResponse.json({
      paciente_nome: ag.paciente_nome,
      profissional_nome: ag.profissional_nome,
      data: ag.data,
      hora: ag.hora,
      data_br: formatDataBR(ag.data),
      hora_br: formatHoraBR(ag.hora),
      cancelada: ag.status === 'Cancelada',
      ja_confirmou: !!ag.patient_confirmed_at,
      ja_recusou: !!ag.patient_declined_at,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Não foi possível carregar os dados da consulta.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ error: 'Confirmação indisponível no momento. Tente novamente mais tarde ou fale com a secretária.' }, { status: 503 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }
  const action = body?.action
  if (action !== 'confirm' && action !== 'decline') {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }

  try {
    const ag = await carregarAgendamento(admin, params.id)
    if (!ag) return NextResponse.json({ error: 'Link de confirmação inválido ou expirado.' }, { status: 404 })

    if (action === 'confirm') {
      if (ag.patient_confirmed_at) {
        return NextResponse.json({ ok: true, already: true, patient_confirmed_at: ag.patient_confirmed_at })
      }
      const nowIso = new Date().toISOString()
      const { error: updErr } = await admin
        .from('agendamentos')
        .update({ patient_confirmed_at: nowIso })
        .eq('id', ag.id)
      if (updErr) throw new Error(updErr.message)
      return NextResponse.json({ ok: true, patient_confirmed_at: nowIso })
    }

    // action === 'decline'
    if (ag.patient_declined_at) {
      return NextResponse.json({ ok: true, already: true, patient_declined_at: ag.patient_declined_at })
    }

    const nowIso = new Date().toISOString()
    const { error: updAgErr } = await admin
      .from('agendamentos')
      .update({ patient_declined_at: nowIso })
      .eq('id', ag.id)
    if (updAgErr) throw new Error(updAgErr.message)

    if (!ag.contact_id) {
      // Consulta sem contato vinculado (não deveria acontecer no fluxo normal) —
      // já gravamos a recusa acima; sem contato não dá pra notificar/transferir.
      return NextResponse.json({ ok: true, patient_declined_at: nowIso, aviso: 'sem_contato' })
    }

    const { data: contact, error: contactErr } = await admin
      .from('contacts')
      .select('id, full_name, sofia_paused, sector_id')
      .eq('id', ag.contact_id)
      .maybeSingle()
    if (contactErr) throw new Error(contactErr.message)

    const dataBR = formatDataBR(ag.data)
    const horaBR = formatHoraBR(ag.hora)
    const profissional = ag.profissional_nome || ''
    const sofiaAtiva = !!contact && !contact.sofia_paused

    if (contact && contact.sector_id !== SETOR_ATENCAO_ID) {
      const { error: sectorErr } = await admin
        .from('contacts')
        .update({ sector_id: SETOR_ATENCAO_ID, updated_at: nowIso })
        .eq('id', contact.id)
      if (sectorErr) throw new Error(sectorErr.message)
    }

    const avisoInterno = `[INTERNO] ⚠️ Paciente avisou (pelo link de confirmação) que NÃO poderá comparecer à consulta de ${dataBR}${horaBR ? ` às ${horaBR}` : ''}${profissional ? ` com ${profissional}` : ''}. Conversa movida para o setor Atenção.${sofiaAtiva ? ' Sofia foi avisada para tentar remarcar.' : ' Sofia está pausada para este contato — remarcação manual.'}`
    const { error: msgInternoErr } = await admin.from('messages').insert({
      contact_id: ag.contact_id,
      channel: 'whatsapp',
      direction: 'outbound',
      content: avisoInterno,
      status: 'sent',
      sender_id: null,
    })
    if (msgInternoErr) throw new Error(msgInternoErr.message)

    if (sofiaAtiva) {
      const nome = primeiroNome(contact?.full_name)
      const conteudoSofia = `Oi, ${nome}! Vi aqui que você não vai conseguir vir na consulta do dia ${dataBR}${horaBR ? ` às ${horaBR}` : ''}${profissional ? ` com ${profissional}` : ''}. Sem problemas! Posso já ir vendo novos horários pra remarcar — me diz qual período costuma ficar melhor pra você (manhã ou tarde) que eu busco as opções mais próximas. 😊`
      const { error: msgSofiaErr } = await admin.from('messages').insert({
        contact_id: ag.contact_id,
        channel: 'whatsapp',
        direction: 'outbound',
        content: conteudoSofia,
        status: 'queued',
        sender_id: null,
      })
      if (msgSofiaErr) throw new Error(msgSofiaErr.message)
    }

    return NextResponse.json({ ok: true, patient_declined_at: nowIso })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Não foi possível registrar sua resposta. Tente novamente ou fale com a secretária.' }, { status: 500 })
  }
}
