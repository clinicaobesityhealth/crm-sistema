import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { criarLinkPagamento, taxaEfetiva, calcularBruto, NOME_BANDEIRA, TEXTO_PARCELAMENTO_PADRAO, type Bandeira, type SafraConfig } from '@/lib/safrapay'
import { saudacaoFormal } from '@/lib/tratamento'
import { criarLinkInfinitePay, normalizarInfinitePay, taxaInfinitePay, telefoneInfinitePay, emailInfinitePay, enderecoInfinitePay, type InfinitePayConfig } from '@/lib/infinitepay'

// v47.14 — Cria uma cobrança no cartão e manda o link para o paciente.
//
// O paciente paga numa página da própria Safrapay. Nenhum dado de cartão passa
// por este servidor: nós só pedimos "cobre R$ X, em até N vezes, com esta
// descrição" e recebemos um endereço para mandar no WhatsApp.
//
// A secretária digita quanto a clínica precisa RECEBER; o valor cobrado já sai
// com a taxa do cartão embutida, conforme a tabela do contrato (Configurações →
// Cobrança PIX e cartão). Ver a explicação da conta em lib/safrapay.ts.

export const runtime = 'nodejs'

function reais(centavos: number) {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (!admin) return NextResponse.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY configurada' }, { status: 503 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const contactId = String(body.contact_id || '')
  const valor = Number(body.valor)                    // em reais, o que a clínica quer receber
  const parcelas = Math.min(Math.max(1, Number(body.parcelas) || 1), 12)
  const bandeira = (['visa_master', 'elo', 'amex'].includes(String(body.bandeira))
    ? String(body.bandeira) : 'visa_master') as Bandeira
  const descricao = String(body.descricao || '').trim()
  const criadoPor = body.criado_por || null
  const criadoPorNome = String(body.criado_por_nome || '').trim() || null

  if (!contactId) return NextResponse.json({ erro: 'Paciente não informado' }, { status: 400 })
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ erro: 'Valor inválido' }, { status: 400 })
  if (valor > 100000) return NextResponse.json({ erro: 'Valor acima do limite permitido' }, { status: 400 })

  const { data: settings } = await admin.from('clinic_settings').select('*').limit(1).single()
  // v48.50 — A chave de Configurações → Cobrança decide por onde o cartão passa.
  // Sem a coluna (migração ainda não rodada), continua tudo pelo Safra.
  const provedor = String((settings as any)?.cartao_provedor || 'safra')
  if (provedor === 'desligado') {
    return NextResponse.json({ erro: 'A cobrança no cartão está desligada em Configurações → Cobrança.' }, { status: 400 })
  }

  const { data: contato } = await admin.from('contacts').select('id, full_name, phone, email, custom_fields').eq('id', contactId).single()
  if (!contato) return NextResponse.json({ erro: 'Paciente não encontrado' }, { status: 404 })

  if (provedor === 'infinitepay') {
    return cobrarInfinitePay(admin, normalizarInfinitePay((settings as any)?.infinitepay_config), {
      contato, contactId, valor, parcelas, descricao, criadoPor, criadoPorNome,
    })
  }

  const cfg = ((settings as any)?.safra_config || {}) as SafraConfig
  if (!cfg.merchant_token) {
    return NextResponse.json({ erro: 'Cartão não configurado. Vá em Configurações → Cobrança e preencha o Merchant Token da Safrapay.' }, { status: 400 })
  }

  // v47.18 — Dois caminhos, conforme a configuração:
  //
  //   (a) a secretária define o parcelamento  → criamos o link da Safrapay já
  //       aqui, com o valor exato daquele parcelamento;
  //   (b) o paciente escolhe                  → NÃO criamos link agora. Mandamos
  //       uma página nossa onde ele vê cada parcelamento pelo preço certo e, ao
  //       escolher, aí sim o link da Safrapay é criado com aquele valor exato.
  //
  // O caminho (b) existe porque o valor do link é fixo e a taxa depende da
  // escolha: sem ele, seria preciso precificar pelo pior caso e cobrar de quem
  // paga à vista o mesmo acréscimo de quem parcela em 12x.
  const pacienteEscolhe = !!cfg.repassar_taxa && !!cfg.paciente_escolhe

  // A conta é refeita aqui, no servidor: a tela mostra a simulação para a
  // secretária decidir, mas o valor que vai para a Safrapay nunca vem do
  // navegador. Taxa efetiva = taxa do cartão + antecipação sobre o prazo médio.
  const liquido = Math.round(valor * 100)
  const taxa = (cfg.repassar_taxa && !pacienteEscolhe) ? taxaEfetiva(cfg, bandeira, parcelas) : 0
  const total = pacienteEscolhe ? liquido : calcularBruto(liquido, taxa)

  // Registra antes de chamar a Safrapay, para nunca existir cobrança enviada sem
  // registro. Se a criação do link falhar, marcamos como 'erro' e devolvemos.
  const { data: cobranca, error: erroIns } = await admin.from('cobrancas_cartao').insert({
    contact_id: contactId,
    valor_liquido: liquido / 100,
    valor_total: total / 100,
    taxa_aplicada: taxa,
    parcelas,
    descricao: descricao || null,
    bandeira,
    max_parcelas: parcelas,
    ambiente: cfg.ambiente || 'homologacao',
    status: pacienteEscolhe ? 'aguardando_escolha' : 'criando',
    criado_por: criadoPor,
    criado_por_nome: criadoPorNome,
  }).select().single()
  if (erroIns || !cobranca) {
    return NextResponse.json({ erro: 'Não foi possível registrar a cobrança: ' + (erroIns?.message || '') }, { status: 500 })
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br').replace(/\/$/, '')
  const saudacao = saudacaoFormal(contato.full_name)
  // A explicação do acréscimo vai na MESMA mensagem, logo antes do link: é ali
  // que a dúvida aparece. Mensagem separada chega desgarrada e parece propaganda.
  // Só entra quando há acréscimo — numa cobrança sem repasse ela seria mentira.
  const explicacao = (cfg.repassar_taxa && parcelas > 1)
    ? '\n\n' + (cfg.texto_parcelamento ?? TEXTO_PARCELAMENTO_PADRAO)
    : ''

  // --- caminho (b): o paciente escolhe o parcelamento na nossa página ---------
  if (pacienteEscolhe) {
    const urlNossa = `${base}/pagar-cartao/${cobranca.id}`
    const texto =
      `${saudacao}\n\n` +
      `Segue o link para pagamento com cartão${descricao ? ` — ${descricao}` : ''}.\n\n` +
      `Cartão: ${NOME_BANDEIRA[bandeira]}\n` +
      (parcelas > 1
        ? `Você escolhe em quantas vezes deseja pagar, em até ${parcelas}x.\n`
        : `Pagamento à vista.\n`) +
      `\n${urlNossa}` +
      explicacao +
      `\n\nO pagamento é concluído em ambiente seguro do Banco Safra.`

    const { error: erroMsg } = await admin.from('messages').insert({
      contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
      content: texto, status: 'queued', sender_id: criadoPor,
    })
    await admin.from('cobrancas_cartao').update({ status: 'enviada', url: urlNossa }).eq('id', cobranca.id)

    return NextResponse.json({
      sucesso: true, cobranca_id: cobranca.id, url: urlNossa,
      valor_liquido: liquido / 100, parcelas, bandeira, escolha_do_paciente: true,
      parcial: erroMsg ? 'O link foi criado, mas a mensagem falhou ao enfileirar: ' + erroMsg.message : null,
    })
  }

  // --- caminho (a): link da Safrapay criado já com o valor exato --------------
  let link: { id: string; url: string }
  try {
    link = await criarLinkPagamento(cfg, {
      valorCentavos: total,
      descricao: descricao || 'Atendimento Obesity Health',
      orderCode: String(cobranca.id),
      maxParcelas: parcelas,
      // Trava o parcelamento só quando a secretária é quem decide. Se o paciente
      // pode escolher, o link vai como "até N vezes" — e o preço acima já foi
      // calculado pela taxa DESSE N, o maior permitido, justamente para a clínica
      // não receber menos caso ele escolha o parcelamento mais longo.
      travarParcelas: !!cfg.repassar_taxa && !cfg.paciente_escolhe,
      nomePaciente: contato.full_name || undefined,
      // Expira em 3 dias: tempo suficiente para o paciente organizar o pagamento,
      // sem deixar link de cobrança vivo indefinidamente. O padrão da Safrapay
      // seria 24 h, curto demais para quem recebe a mensagem à noite.
      expiraEm: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      redirectUrl: `${base}/pagamento-confirmado`,
    })
  } catch (e: any) {
    await admin.from('cobrancas_cartao').update({ status: 'erro', erro: String(e?.message || e).slice(0, 400) }).eq('id', cobranca.id)
    return NextResponse.json({ erro: e?.message || 'Não foi possível criar o link na Safrapay' }, { status: 502 })
  }

  await admin.from('cobrancas_cartao').update({
    status: 'enviada', safra_link_id: link.id, url: link.url,
  }).eq('id', cobranca.id)

  // Mensagem para o paciente. O valor cobrado e o parcelamento vão explícitos —
  // se a clínica repassa a taxa, o paciente tem que ver a diferença antes de pagar.
  // Com o parcelamento travado o texto tem que dizer "em Nx", não "em até Nx" —
  // o paciente não vai poder escolher outro número na página.
  const travado = cfg.repassar_taxa && !cfg.paciente_escolhe
  const linhaParcelas = parcelas > 1
    ? `\n${travado ? 'Em' : 'Em até'} ${parcelas}x de ${reais(Math.ceil(total / parcelas))}`
    : ''
  const texto =
    `${saudacao}\n\n` +
    `Segue o link para pagamento com cartão${descricao ? ` — ${descricao}` : ''}.\n\n` +
    `Valor: ${reais(total)}${linhaParcelas}\n` +
    `Cartão: ${NOME_BANDEIRA[bandeira]}\n\n` +
    `${link.url}` +
    explicacao +
    `\n\nO pagamento é concluído em ambiente seguro do Banco Safra.`

  const { error: erroMsg } = await admin.from('messages').insert({
    contact_id: contactId, channel: 'whatsapp', direction: 'outbound',
    content: texto, status: 'queued', sender_id: criadoPor,
  })

  return NextResponse.json({
    sucesso: true,
    cobranca_id: cobranca.id,
    url: link.url,
    valor_total: total / 100,
    valor_liquido: liquido / 100,
    taxa,
    parcelas,
    bandeira,
    parcial: erroMsg ? 'O link foi criado, mas a mensagem falhou ao enfileirar: ' + erroMsg.message : null,
  })
}

// ---------------------------------------------------------------------------
// v48.50 — InfinitePay
//
// Mesmos dois caminhos do Safra, com uma diferença que muda o texto: na
// InfinitePay quem escolhe o parcelamento é sempre o paciente, na página deles —
// a API não tem como travar. Por isso:
//   - o link é criado com o valor EXATO de um parcelamento, e a mensagem diz
//     claramente "na página, escolha Nx";
//   - se ele escolher outro número, a baixa registra a divergência para a
//     secretária ver (lib/infinitepayBaixa.ts).
// E não há bandeira: a taxa do link é a mesma para todos os cartões.
// ---------------------------------------------------------------------------
async function cobrarInfinitePay(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  cfg: InfinitePayConfig,
  c: { contato: any; contactId: string; valor: number; parcelas: number; descricao: string; criadoPor: any; criadoPorNome: string | null },
) {
  if (!cfg.handle) {
    return NextResponse.json({ erro: 'InfinitePay não configurada. Vá em Configurações → Cobrança e preencha a InfiniteTag.' }, { status: 400 })
  }
  const parcelas = Math.min(c.parcelas, cfg.max_parcelas || 12)
  const pacienteEscolhe = !!cfg.repassar_taxa && !!cfg.paciente_escolhe
  const liquido = Math.round(c.valor * 100)
  const taxa = pacienteEscolhe ? 0 : taxaInfinitePay(cfg, parcelas)
  const total = pacienteEscolhe ? liquido : calcularBruto(liquido, taxa)

  const { data: cobranca, error: erroIns } = await admin.from('cobrancas_cartao').insert({
    contact_id: c.contactId,
    valor_liquido: liquido / 100,
    valor_total: total / 100,
    taxa_aplicada: taxa,
    parcelas,
    descricao: c.descricao || null,
    bandeira: null,
    max_parcelas: parcelas,
    ambiente: 'producao',
    provedor: 'infinitepay',
    status: pacienteEscolhe ? 'aguardando_escolha' : 'criando',
    criado_por: c.criadoPor,
    criado_por_nome: c.criadoPorNome,
  }).select().single()
  if (erroIns || !cobranca) {
    const falta = /provedor/.test(erroIns?.message || '') ? ' Falta rodar a migração 20260921_infinitepay_v48_50.sql.' : ''
    return NextResponse.json({ erro: 'Não foi possível registrar a cobrança: ' + (erroIns?.message || '') + falta }, { status: 500 })
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br').replace(/\/$/, '')
  const saudacao = saudacaoFormal(c.contato.full_name)
  const explicacao = (cfg.repassar_taxa && parcelas > 1 && cfg.texto_parcelamento)
    ? '\n\n' + cfg.texto_parcelamento : ''

  let url: string
  let texto: string
  if (pacienteEscolhe) {
    url = `${base}/pagar-cartao/${cobranca.id}`
    texto =
      `${saudacao}\n\n` +
      `Segue o link para pagamento com cartão${c.descricao ? ` — ${c.descricao}` : ''}.\n\n` +
      (parcelas > 1 ? `Você escolhe em quantas vezes deseja pagar, em até ${parcelas}x.\n` : `Pagamento à vista.\n`) +
      `\n${url}` + explicacao +
      `\n\nO pagamento é concluído em ambiente seguro da InfinitePay.`
    await admin.from('cobrancas_cartao').update({ status: 'enviada', url }).eq('id', cobranca.id)
  } else {
    try {
      const link = await criarLinkInfinitePay(cfg, {
        valorCentavos: total,
        descricao: c.descricao || 'Atendimento Obesity Health',
        orderNsu: String(cobranca.id),
        redirectUrl: `${base}/pagamento-confirmado`,
        webhookUrl: `${base}/api/infinitepay/webhook`,
        nome: c.contato.full_name || undefined,
        telefone: telefoneInfinitePay(c.contato.phone),
        email: emailInfinitePay(c.contato.email),
        endereco: enderecoInfinitePay(c.contato.custom_fields),
      })
      url = link.url
      await admin.from('cobrancas_cartao').update({ status: 'enviada', url, infinitepay_slug: link.slug }).eq('id', cobranca.id)
    } catch (e: any) {
      const motivo = String(e?.message || e).slice(0, 400)
      await admin.from('cobrancas_cartao').update({ status: 'erro', erro: motivo }).eq('id', cobranca.id)
      await admin.from('infinitepay_eventos').insert({ origem: 'criar', payload: { cobranca_id: cobranca.id, erro: motivo, status_http: e?.status ?? null, corpo: e?.corpo ?? null } })
      return NextResponse.json({ erro: motivo }, { status: 502 })
    }
    // Sem repasse pelo CRM, quem mostra os juros de cada parcelamento é a
    // própria página da InfinitePay — o paciente escolhe livremente.
    const linhaParcelas = !cfg.repassar_taxa
      ? `\nNa página você escolhe: PIX ou cartão em até ${cfg.max_parcelas || 12}x. No cartão, o valor de cada parcelamento aparece lá antes de confirmar.`
      : parcelas > 1
        ? `\nEm ${parcelas}x de ${reais(Math.ceil(total / parcelas))} — na página de pagamento, escolha ${parcelas}x.`
        : `\nNa página de pagamento, escolha à vista (1x) ou PIX.`
    texto =
      `${saudacao}\n\n` +
      `Segue o link para pagamento com cartão${c.descricao ? ` — ${c.descricao}` : ''}.\n\n` +
      `Valor: ${reais(total)}${linhaParcelas}\n\n` +
      `${url}` + explicacao +
      `\n\nO pagamento é concluído em ambiente seguro da InfinitePay.`
  }

  const { error: erroMsg } = await admin.from('messages').insert({
    contact_id: c.contactId, channel: 'whatsapp', direction: 'outbound',
    content: texto, status: 'queued', sender_id: c.criadoPor,
  })
  // O motivo fica gravado na cobrança: sem isso, "a mensagem não saiu" vira
  // um mistério assim que a janela fecha.
  if (erroMsg) {
    console.error('[cobranca-cartao/infinitepay] mensagem não enfileirada', erroMsg)
    await admin.from('cobrancas_cartao').update({ erro: 'Mensagem: ' + erroMsg.message }).eq('id', cobranca.id)
  }

  return NextResponse.json({
    sucesso: true, cobranca_id: cobranca.id, url, provedor: 'infinitepay',
    valor_total: total / 100, valor_liquido: liquido / 100, taxa, parcelas,
    escolha_do_paciente: pacienteEscolhe,
    parcial: erroMsg ? 'O link foi criado, mas a mensagem falhou ao enfileirar: ' + erroMsg.message : null,
  })
}
