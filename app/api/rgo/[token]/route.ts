import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { marcarRealizada } from '@/lib/rgo'

// v48.59 — Link da descrição cirúrgica que vai dentro do evento do Google
// Agenda. Público (o cirurgião abre no celular, sem login no CRM); protegido
// pela chave longa e única de cada cirurgia.
//   GET  — dados mínimos para ele conferir que é o paciente certo
//   POST — recebe as fotos/PDF, guarda e marca a cirurgia como realizada

export const runtime = 'nodejs'
export const maxDuration = 60

const LIMITE = 15 * 1024 * 1024

async function acharCirurgia(token: string) {
  const admin = getSupabaseAdmin()
  if (!admin || !/^[a-f0-9]{24,64}$/i.test(token)) return { admin, c: null as any }
  const { data } = await admin.from('cirurgias')
    .select(`id, contact_id, paciente_nome, data_cirurgia, hora, procedimento_id, procedimento_sigla, procedimento_nome,
      hospital, cirurgiao, cirurgiao_id, composicao_equipe, convenio, modalidade, status, categoria,
      rgo_arquivos, rgo_enviada_paciente_em, rgo_concluida_em, rgo_observacoes,
      rgo_cirurgiao_id, rgo_auxiliar1_id, rgo_auxiliar2_id, rgo_instrumentador1_id, rgo_instrumentador2_id, rgo_anestesista_id,
      rgo_equipe_avulsa`)
    .eq('rgo_token', token).maybeSingle()
  return { admin, c: data }
}

// Os procedimentos como o convênio pede: código TUSS e nome, um por linha.
// Uma cirurgia pode ter mais de um procedimento (conjugadas), e cada
// procedimento pode ter mais de um código.
export async function procedimentosSolicitados(admin: any, cirurgiaId: string, fallback: { sigla?: string | null; nome?: string | null; procedimento_id?: string | null }) {
  const { data: itens } = await admin.from('cirurgia_itens')
    .select('procedimento_id, sigla, nome, ordem').eq('cirurgia_id', cirurgiaId).order('ordem')
  const lista = (itens && itens.length ? itens : [{ procedimento_id: fallback.procedimento_id, sigla: fallback.sigla, nome: fallback.nome }]) as any[]
  const saida: { tuss: string; nome: string }[] = []
  for (const it of lista) {
    const nome = it.nome || it.sigla || ''
    if (!nome && !it.procedimento_id) continue
    let codigos: string[] = []
    if (it.procedimento_id) {
      const { data: tuss } = await admin.from('cirurgia_proc_tuss')
        .select('codigo, ordem').eq('procedimento_id', it.procedimento_id).order('ordem')
      codigos = (tuss || []).map((t: any) => String(t.codigo || '').trim()).filter(Boolean)
    }
    if (codigos.length) codigos.forEach(cod => saida.push({ tuss: cod, nome }))
    else saida.push({ tuss: '', nome })
  }
  return saida
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { admin, c } = await acharCirurgia(String(params.token || ''))
  if (!c) return NextResponse.json({ erro: 'Link inválido ou expirado.' }, { status: 404 })
  const procedimentos = await procedimentosSolicitados(admin, c.id, { sigla: c.procedimento_sigla, nome: c.procedimento_nome, procedimento_id: (c as any).procedimento_id })

  // v48.92 — A equipe do cadastro, para escolher quem esteve nesta cirurgia.
  // Os nomes precisam bater exatamente com a descrição cirúrgica — daí vir do
  // mesmo cadastro que já serve o orçamento, em vez de texto livre.
  const { data: equipeCadastro } = await admin.from('cirurgia_equipe')
    .select('id, nome_curto, nome_completo, funcao').eq('ativo', true).order('ordem')

  return NextResponse.json({
    paciente: c.paciente_nome,
    data: c.data_cirurgia, hora: c.hora ? String(c.hora).slice(0, 5) : '',
    procedimento: c.procedimento_nome || c.procedimento_sigla || '',
    hospital: c.hospital || '', cirurgiao: c.cirurgiao || '',
    procedimentos,
    equipe: c.composicao_equipe || '', convenio: c.convenio || '', modalidade: c.modalidade || '',
    situacao: c.status || '',
    realizada: c.categoria === 'realizada',
    enviada_ao_paciente: !!c.rgo_enviada_paciente_em,
    concluida: !!c.rgo_concluida_em,
    observacoes: c.rgo_observacoes || '',
    equipeCadastro: (equipeCadastro || []) as any[],
    equipeRgo: {
      cirurgiao_id: c.rgo_cirurgiao_id || c.cirurgiao_id || null,
      auxiliar1_id: c.rgo_auxiliar1_id || null,
      auxiliar2_id: c.rgo_auxiliar2_id || null,
      instrumentador1_id: c.rgo_instrumentador1_id || null,
      instrumentador2_id: c.rgo_instrumentador2_id || null,
      anestesista_id: c.rgo_anestesista_id || null,
    },
    // v48.120 — Quem foi preenchido à mão (avulso), por papel — nome e
    // documento, sem entrar no cadastro. Só existe para papéis sem rgo_*_id.
    equipeAvulsa: (c.rgo_equipe_avulsa && typeof c.rgo_equipe_avulsa === 'object') ? c.rgo_equipe_avulsa : {},
    arquivos: (Array.isArray(c.rgo_arquivos) ? c.rgo_arquivos : []).map((a: any) => ({
      url: a.url || '', nome: a.nome || '', tipo: a.tipo || '', categoria: a.categoria || 'rgo',
      enviado_em: a.enviado_em || null, por: a.por || '',
      // Só o que o próprio cirurgião mandou por este link, e enquanto nada foi
      // ao paciente, pode ser apagado daqui. O que a secretária anexou no CRM
      // não se apaga por uma página pública.
      pode_apagar: a.por === 'link do cirurgião' && !c.rgo_concluida_em && !c.rgo_enviada_paciente_em,
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const { admin, c } = await acharCirurgia(String(params.token || ''))
  if (!admin || !c) return NextResponse.json({ erro: 'Link inválido ou expirado.' }, { status: 404 })

  // v48.64 — Conferir e apagar antes de concluir.
  //
  // O cirurgião fotografa, vê a miniatura e apaga a que saiu tremida. Quando
  // dá por encerrado, 'concluir' tranca: o link vira só leitura e dali em
  // diante quem remove é a clínica, pelo CRM. Ações vêm em JSON; o envio de
  // arquivo continua multipart.
  if ((req.headers.get('content-type') || '').includes('application/json')) {
    let b: any = {}
    try { b = await req.json() } catch {}
    const todosAgora: any[] = Array.isArray(c.rgo_arquivos) ? c.rgo_arquivos : []

    if (b.acao === 'observacoes') {
      if (c.rgo_concluida_em) return NextResponse.json({ erro: 'O envio já foi concluído.' }, { status: 400 })
      await admin.from('cirurgias').update({ rgo_observacoes: String(b.texto || '').slice(0, 4000) || null }).eq('id', c.id)
      return NextResponse.json({ ok: true })
    }

    // v48.92 — Quem esteve na cirurgia, por papel. Só quem for escolhido entra
    // na divisão de honorários e na carta de reembolso — o resto fica em
    // branco, sem forçar preencher todos os seis.
    //
    // v48.120 — Além de escolher do cadastro (rgo_*_id), agora dá para digitar
    // um avulso: "<papel>_avulso": {nome, documento} + "<papel>_incluir"
    // (marcado = também vira integrante reutilizável em cirurgia_equipe;
    // desmarcado = fica só como texto desta cirurgia, em rgo_equipe_avulsa).
    // A página sempre manda os seis papéis por completo, então cada chamada
    // reconstrói o rgo_equipe_avulsa inteiro — não precisa mesclar com o
    // que já estava salvo. Reaproveita um cadastro existente com o mesmo
    // nome em vez de duplicar.
    if (b.acao === 'equipe_rgo') {
      if (c.rgo_concluida_em) return NextResponse.json({ erro: 'O envio já foi concluído.' }, { status: 400 })
      const limpo = (v: any) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) ? v : null
      const FUNCAO_POR_PAPEL: Record<string, string> = {
        cirurgiao: 'CIRURGIÃO', auxiliar1: 'AUXILIAR', auxiliar2: 'AUXILIAR',
        instrumentador1: 'INSTRUMENTADOR', instrumentador2: 'INSTRUMENTADOR', anestesista: 'ANESTESISTA',
      }
      const patch: any = {}
      const novaAvulsa: any = {}
      for (const papel of Object.keys(FUNCAO_POR_PAPEL)) {
        const idCampo = `rgo_${papel}_id`
        const idEscolhido = limpo(b[`${papel}_id`])
        if (idEscolhido) { patch[idCampo] = idEscolhido; continue }
        const avulso = b[`${papel}_avulso`]
        const nomeAvulso = String(avulso?.nome || '').trim().slice(0, 120)
        if (!nomeAvulso) { patch[idCampo] = null; continue }
        const documentoAvulso = String(avulso?.documento || '').trim().slice(0, 60) || null
        if (b[`${papel}_incluir`]) {
          // Mesmo nome já cadastrado (ativo ou não)? Reaproveita em vez de duplicar
          // — a mesma regra do índice único de cirurgia_equipe (nome_curto).
          const { data: existente } = await admin.from('cirurgia_equipe')
            .select('id').ilike('nome_curto', nomeAvulso).maybeSingle()
          let membroId = existente?.id || null
          if (!membroId) {
            const { data: criado } = await admin.from('cirurgia_equipe').insert({
              nome_curto: nomeAvulso, nome_completo: nomeAvulso, documento: documentoAvulso,
              funcao: FUNCAO_POR_PAPEL[papel], ativo: true, ordem: 999,
            }).select('id').maybeSingle()
            membroId = criado?.id || null
          }
          patch[idCampo] = membroId
        } else {
          patch[idCampo] = null
          novaAvulsa[papel] = { nome: nomeAvulso, documento: documentoAvulso }
        }
      }
      patch.rgo_equipe_avulsa = novaAvulsa
      await admin.from('cirurgias').update(patch).eq('id', c.id)
      return NextResponse.json({ ok: true })
    }

    if (b.acao === 'concluir') {
      if (!todosAgora.some(a => a.categoria !== 'documento')) {
        return NextResponse.json({ erro: 'Adicione a descrição cirúrgica antes de concluir.' }, { status: 400 })
      }
      if (!c.rgo_concluida_em) {
        await admin.from('cirurgias').update({ rgo_concluida_em: new Date().toISOString() }).eq('id', c.id)
        if (c.contact_id) {
          await admin.from('messages').insert({
            contact_id: c.contact_id, channel: 'whatsapp', direction: 'outbound', status: 'sent',
            content: `[INTERNO] 📄 Descrição cirúrgica concluída${c.cirurgiao ? ' por ' + c.cirurgiao : ''} (${todosAgora.length} arquivo${todosAgora.length > 1 ? 's' : ''}). Cirurgia marcada como realizada. Envie ao paciente pela tela de Cirurgias para ele pedir o reembolso.`,
          })
        }
      }
      return NextResponse.json({ ok: true, concluida: true })
    }

    if (b.acao !== 'remover' || !b.url) return NextResponse.json({ erro: 'Ação inválida.' }, { status: 400 })
    if (c.rgo_concluida_em) return NextResponse.json({ erro: 'O envio já foi concluído. Peça à clínica para remover.' }, { status: 400 })
    if (c.rgo_enviada_paciente_em) return NextResponse.json({ erro: 'Isto já foi enviado ao paciente. Peça à clínica para remover.' }, { status: 400 })
    const alvo = todosAgora.find(a => a.url === b.url)
    if (!alvo) return NextResponse.json({ erro: 'Arquivo não encontrado.' }, { status: 404 })
    if (alvo.por !== 'link do cirurgião') return NextResponse.json({ erro: 'Este arquivo foi anexado pela clínica e só pode ser removido por lá.' }, { status: 403 })
    const resto = todosAgora.filter(a => a.url !== b.url)
    await admin.from('cirurgias').update({ rgo_arquivos: resto }).eq('id', c.id)
    // Tira também do armazenamento: arquivo órfão ocupa espaço e continuaria
    // acessível por quem tivesse guardado o endereço.
    const caminho = String(b.url).split('/object/public/rgo/')[1]
    if (caminho) { try { await admin.storage.from('rgo').remove([decodeURIComponent(caminho)]) } catch {} }
    return NextResponse.json({ ok: true, total: resto.length })
  }

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ erro: 'Envio inválido.' }, { status: 400 }) }
  const arquivos = form.getAll('arquivos').filter(f => typeof f !== 'string') as File[]
  // 'rgo' = a descrição cirúrgica (marca a cirurgia como realizada);
  // 'documento' = outro papel da cirurgia (etiquetas, relatório...), só anexa.
  const categoria = String(form.get('categoria') || 'rgo') === 'documento' ? 'documento' : 'rgo'
  // O que é este documento ("etiqueta de material", "relatório"). Sem isso a
  // lista vira IMG_0423.jpg e ninguém sabe o que é depois.
  const descricao = String(form.get('descricao') || '').trim().slice(0, 80)
  if (!arquivos.length) return NextResponse.json({ erro: 'Nenhum arquivo.' }, { status: 400 })
  if (c.rgo_concluida_em) return NextResponse.json({ erro: 'O envio já foi concluído. Fale com a clínica para incluir mais alguma coisa.' }, { status: 400 })

  const novos: any[] = []
  for (let i = 0; i < arquivos.length; i++) { const f = arquivos[i]
    if (f.size > LIMITE) return NextResponse.json({ erro: `"${f.name}" passa de 15 MB.` }, { status: 400 })
    const tipo = f.type || 'application/octet-stream'
    if (!/^image\/|^application\/pdf$/.test(tipo)) return NextResponse.json({ erro: `"${f.name}" não é foto nem PDF.` }, { status: 400 })
    const ext = tipo === 'application/pdf' ? 'pdf' : (tipo.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '')
    const caminho = `${c.id}/${Date.now()}-${i}.${ext}`
    const bytes = Buffer.from(await f.arrayBuffer())
    const { error } = await admin.storage.from('rgo').upload(caminho, bytes, { contentType: tipo, upsert: false })
    if (error) return NextResponse.json({ erro: 'Não consegui guardar o arquivo: ' + error.message }, { status: 500 })
    const url = admin.storage.from('rgo').getPublicUrl(caminho).data.publicUrl
    const nome = descricao
      ? (arquivos.length > 1 ? `${descricao} (${i + 1})` : descricao)
      : (f.name || `${categoria}-${i + 1}.${ext}`)
    novos.push({ url, nome, tipo, categoria, enviado_em: new Date().toISOString(), por: 'link do cirurgião' })
  }

  const lista = [...(Array.isArray(c.rgo_arquivos) ? c.rgo_arquivos : []), ...novos]
  await admin.from('cirurgias').update({ rgo_arquivos: lista, ...(categoria === 'rgo' ? { rgo_recebida_em: new Date().toISOString() } : {}) }).eq('id', c.id)
  if (categoria === 'rgo') await marcarRealizada(admin, c, c.cirurgiao ? `${c.cirurgiao} (descrição cirúrgica)` : 'Descrição cirúrgica')

  // O aviso à equipe sai quando o cirurgião conclui, não a cada foto: ele ainda
  // pode apagar uma que saiu ruim e mandar outra. Enquanto não concluir, a
  // cirurgia já aparece com o selo "RGO a enviar" na lista.
  return NextResponse.json({ ok: true, total: lista.length })
}
