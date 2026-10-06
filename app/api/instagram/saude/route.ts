import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// A conferência do token do Instagram.
//
// Roda no servidor, e não no navegador, por dois motivos: o token não precisa
// passar pela tela de ninguém, e a Meta não responde a chamadas de outra
// origem sem CORS.
//
// v48.41 — A TERCEIRA versão desta conferência, e a primeira que pergunta a
// coisa certa.
//
// A v48.35 perguntava "o token vale?". A v48.38 tentou perguntar pela caixa de
// mensagens e bateu numa porta que não existe, pintando de vermelho até conta
// que funcionava. A v48.39 passou a perguntar de quem era o token, achando que
// token de usuário não enviava — errado também.
//
// O que aconteceu de verdade em 17/09, por volta das 17h: a Meta fechou o envio
// por
//     POST /{id_da_conta_instagram}/messages
// e passou a responder "(#3) Application does not have the capability" para
// TODAS as contas, com qualquer token. O caminho que continua aberto é o da
// PÁGINA do Facebook:
//     POST /{id_da_pagina}/messages
// com o mesmo token de sempre. Não havia token para renovar — havia uma porta
// trocada.
//
// Por isso a conferência agora bate na porta do envio, de verdade, com um
// destinatário que não existe. Se a Meta responde "(#100) não dá para enviar
// para este id", o caminho está aberto: o problema era só o destinatário
// inventado. Nenhuma mensagem sai, e nenhum paciente recebe nada.

export const runtime = 'nodejs'
export const maxDuration = 30

const LISTA_CONTAS = 'https://n8n-n8n.5k3mqv.easypanel.host/webhook/ig-accounts-list'

type Conta = { numero?: number; nome_conta?: string; instagram_business_account_id?: string; access_token?: string; ativo?: string }

// A Meta diz a data do vencimento dentro da mensagem de erro, em inglês e em
// formato próprio: "Session has expired on Wednesday, 16-Sep-26 11:19:09 PDT".
// Guardar essa data é o que permite dizer "vencido desde ontem" em vez de
// "vencido".
function dataDoVencimento(mensagem: string): string | null {
  const m = mensagem.match(/expired on \w+,\s*(\d{1,2})-(\w{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/i)
  if (!m) return null
  const meses: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  const mes = meses[m[2].toLowerCase()]
  if (mes === undefined) return null
  const d = new Date(Date.UTC(2000 + Number(m[3]), mes, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

type Resposta = { ok: boolean; erro: { mensagem: string; codigo: number | null } | null; dados: any }

async function pedir(url: string, token: string, corpo?: any): Promise<Resposta> {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
    method: corpo ? 'POST' : 'GET',
    headers: corpo ? { 'content-type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(10000),
  })
  const texto = await r.text()
  let j: any = null
  try { j = JSON.parse(texto) } catch {}
  if (r.ok) return { ok: true, erro: null, dados: j }
  return {
    ok: false,
    dados: j,
    erro: { mensagem: j?.error?.message || texto.slice(0, 300), codigo: j?.error?.code ?? null },
  }
}

// Um destinatário que não existe. A resposta (#100) é a prova de que a porta
// está aberta — a Meta só reclama do destinatário depois de aceitar a chamada.
const DESTINATARIO_INEXISTENTE = '1'

async function conferir(token: string, contaId: string) {
  const ehTokenInstagram = token.startsWith('IGA')
  const base = ehTokenInstagram ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0'

  try {
    // 1) O token ainda vale? É esta pergunta que pega o token vencido, que foi
    //    o problema de 16/09.
    const alvo = contaId ? `${base}/${contaId}?fields=id,username` : `${base}/me?fields=id`
    const valido = await pedir(alvo, token)
    if (!valido.ok) {
      let msg = valido.erro!.mensagem
      if (/expired/i.test(msg)) msg = 'O token venceu. Gere um novo e cole no cadastro desta conta. ' + msg
      return { ok: false, via: null as string | null, mensagem: msg, expirado_em: dataDoVencimento(msg) }
    }

    // 2) Por onde se envia hoje?
    let destino = contaId
    let via = 'conta do Instagram'
    if (!ehTokenInstagram) {
      const paginas = await pedir(`${base}/me/accounts?fields=id,name,instagram_business_account{id}&limit=50`, token)
      const lista: any[] = Array.isArray(paginas.dados?.data) ? paginas.dados.data : []
      const dona = lista.find(p => String(p?.instagram_business_account?.id || '') === String(contaId)) || (lista.length === 1 ? lista[0] : null)
      if (!dona?.id) {
        return {
          ok: false,
          via: null,
          mensagem: 'Este token não enxerga a página do Facebook desta conta do Instagram, e é pela página que o envio passa. '
            + 'Gere o token de novo pelo mesmo app, marcando a página da conta.',
          expirado_em: null as string | null,
        }
      }
      destino = String(dona.id)
      via = `página ${dona.name || dona.id}`
    }

    // 2.5) v48.49 — Esta conta está ESCUTANDO?
    //
    // Enviar e receber são duas portas diferentes. Uma conta pode enviar
    // perfeitamente e não receber nada, porque receber depende de uma assinatura
    // de eventos que é feita num passo separado — e que não avisa quando falta.
    // Foi o que deixou a conta do Dr. Marcello muda em 18/09.
    const assinatura = await pedir(`${base}/${contaId}/subscribed_apps`, token)
    const campos: string[] = (assinatura.dados?.data || []).flatMap((x: any) => x?.subscribed_fields || [])
    const recebendo = campos.includes('messages')

    // 3) A porta do envio está aberta? Sem mandar nada para ninguém.
    const sonda = await pedir(`${base}/${destino}/messages`, token, {
      messaging_product: 'instagram',
      recipient: { id: DESTINATARIO_INEXISTENTE },
      message: { text: 'x' },
    })
    const codigo = sonda.erro?.codigo ?? null

    // (#100) é o "não existe esse destinatário" — exatamente o que se espera de
    // um id inventado, e prova de que o envio de verdade passaria.
    if (sonda.ok || codigo === 100) {
      // Envio funcionando, mas sem escutar: a clínica responde e nunca é
      // procurada. Isso precisa aparecer em vermelho, não passar batido.
      if (!recebendo) {
        return {
          ok: false,
          via,
          mensagem: 'Esta conta ENVIA, mas não está recebendo: os eventos dela não estão assinados na Meta. '
            + 'Abra o cadastro desta conta abaixo e salve de novo — o CRM liga o recebimento ao salvar.',
          expirado_em: null as string | null,
        }
      }
      return { ok: true, via, mensagem: null as string | null, expirado_em: null as string | null }
    }

    let msg = sonda.erro?.mensagem || 'A Meta recusou o envio.'
    if (codigo === 3) {
      msg = 'A Meta está recusando o envio por este caminho. Foi o que aconteceu em 17/09, quando ela fechou o envio pelo '
        + 'id da conta do Instagram e passou a aceitar só pelo id da página. Detalhe da Meta: ' + msg
    }
    return { ok: false, via, mensagem: msg, expirado_em: dataDoVencimento(msg) }
  } catch (e: any) {
    const msg = e?.name === 'TimeoutError' ? 'A Meta não respondeu em 10 segundos.' : (e?.message || String(e))
    return { ok: false, via: null as string | null, mensagem: msg, expirado_em: null as string | null }
  }
}

export async function GET() {
  const admin = getSupabaseAdmin()

  let contas: Conta[] = []
  try {
    const r = await fetch(LISTA_CONTAS, { signal: AbortSignal.timeout(15000), cache: 'no-store' })
    const j = await r.json()
    // O webhook devolve { contas: [...] } — é assim que a tela de contas lê.
    // Os outros nomes ficam como rede de segurança para o dia em que o fluxo
    // mudar de formato sem avisar.
    contas = Array.isArray(j) ? j : (j.contas || j.accounts || j.data || [])
  } catch (e: any) {
    return NextResponse.json({
      erro: 'Não foi possível ler as contas do Instagram: ' + (e?.message || String(e)),
    }, { status: 502 })
  }

  // "ativo" chega da planilha como texto ("sim"/"nao"), mas já apareceu como
  // booleano e como 1/0 em versões diferentes do fluxo. Aceitar as três formas
  // custa uma linha e evita o pior dos erros aqui: dizer "está tudo bem"
  // porque não achou conta nenhuma para conferir.
  const ligada = (v: any) => {
    if (v === true || v === 1) return true
    const t = String(v ?? '').trim().toLowerCase()
    return t === 'sim' || t === 's' || t === 'true' || t === '1' || t === 'ativa' || t === 'ativo'
  }
  const ativas = contas.filter(c => ligada(c.ativo) && String(c.access_token || '').trim())

  const resultados = []
  for (const c of ativas) {
    const nome = (c.nome_conta || 'conta sem nome').trim()
    const bruto = String(c.access_token || '')
    const r = await conferir(bruto, String(c.instagram_business_account_id || ''))
    // O começo do token (4 letras) é a única parte que aparece na tela: já diz
    // de qual mundo ele veio, e não serve para ninguém usar.
    resultados.push({ conta: nome, comeco: bruto.slice(0, 4), ...r })

    if (!admin) continue

    // "desde" só é reescrito quando o estado VIRA — assim a tela consegue dizer
    // há quanto tempo o canal está fora, que é a informação que importa.
    const { data: anterior } = await admin.from('canal_saude')
      .select('ok, desde').eq('canal', 'instagram').ilike('conta', nome).maybeSingle()

    const virou = !anterior || anterior.ok !== r.ok
    await admin.from('canal_saude').upsert({
      canal: 'instagram',
      conta: nome,
      ok: r.ok,
      mensagem: r.mensagem,
      expirado_em: r.expirado_em,
      desde: virou ? new Date().toISOString() : anterior!.desde,
      verificado_em: new Date().toISOString(),
    }, { onConflict: 'canal,conta' })
  }

  return NextResponse.json({
    ok: resultados.length > 0 && resultados.every(r => r.ok),
    // Quantas contas existem no cadastro e quantas estavam em condição de ser
    // conferidas. Sem isso, "nenhuma conta ativa" e "tudo certo" ficam
    // indistinguíveis na tela — que foi exatamente o que aconteceu.
    cadastradas: contas.length,
    conferidas: resultados.length,
    verificado_em: new Date().toISOString(),
    contas: resultados,
  })
}
