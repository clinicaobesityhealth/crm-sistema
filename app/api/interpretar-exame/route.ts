import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { REGRAS_RESUMO_PADRAO } from '@/lib/examAnalysisDefaultPrompt'

// v46.88 — Resumo de exames de sangue por IA, pra virar anotação clínica no
// MedX depois de revisado pela equipe. SÓ roda quando alguém clica em
// "Analisar exame com IA" no anexo (nunca automático, nunca via Sofia) — ver
// components/ConversationSidePanel.tsx (AttachmentItem).
//
// v46.91 — trocado de Anthropic (Claude) pra Google Gemini, a pedido do
// Jorge (usa a chave de API do Gemini, que tem nível gratuito). O
// comportamento pro usuário não muda em nada: mesmo botão, mesmas regras do
// resumo, mesma tela de revisão antes de enviar/copiar.
//
// v47.00 — as regras do resumo agora podem ser personalizadas pela própria
// clínica em Configuração > Agente de IA > Análise de exames (Jorge pediu
// para poder adicionar categorias de "exames de destaque" sem precisar de
// deploy). Se a clínica não personalizou nada, usa REGRAS_RESUMO_PADRAO
// (lib/examAnalysisDefaultPrompt.ts) — o mesmo texto de sempre.
//
// Recebe a URL pública do PDF já anexado na conversa (Supabase Storage),
// busca o arquivo, manda pro Gemini com as regras do prompt (personalizadas
// ou padrão), e devolve o texto pronto pra revisão/edição na tela antes de
// copiar/enviar pro MedX.

export const runtime = 'nodejs'

async function getRegrasResumo(): Promise<string> {
  try {
    const admin = getSupabaseAdmin()
    if (!admin) return REGRAS_RESUMO_PADRAO
    const { data } = await admin.from('clinic_settings').select('sofia_config').limit(1).maybeSingle()
    const custom = data?.sofia_config?.exam_analysis_prompt
    if (typeof custom === 'string' && custom.trim()) return custom.trim()
  } catch {
    // Qualquer falha ao buscar a personalização (RLS, coluna ausente em
    // instalação antiga, etc.) cai no padrão — nunca quebra a análise.
  }
  return REGRAS_RESUMO_PADRAO
}

function getModel() {
  return process.env.GEMINI_EXAM_MODEL || 'gemini-2.5-pro'
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Análise por IA ainda não configurada (falta a chave do Gemini no servidor). Fale com o suporte técnico.' }, { status: 503 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requisição inválida.' }, { status: 400 })
  }
  const mediaUrl = body?.media_url
  if (!mediaUrl || typeof mediaUrl !== 'string') {
    return NextResponse.json({ error: 'Arquivo do exame não informado.' }, { status: 400 })
  }

  try {
    const fileRes = await fetch(mediaUrl)
    if (!fileRes.ok) throw new Error('Não foi possível baixar o arquivo do exame.')
    const contentType = fileRes.headers.get('content-type') || ''
    if (!contentType.includes('pdf') && !mediaUrl.toLowerCase().includes('.pdf')) {
      return NextResponse.json({ error: 'Este recurso funciona apenas com arquivos PDF de exames.' }, { status: 400 })
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer())
    const MAX_BYTES = 30 * 1024 * 1024
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'Arquivo muito grande para análise (limite de 30MB).' }, { status: 400 })
    }
    const base64 = buffer.toString('base64')
    const regrasResumo = await getRegrasResumo()

    const model = getModel()
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: regrasResumo }] },
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
            { text: 'Resumir' },
          ],
        }],
        // v46.98 — 2000 tokens era suficiente pra exames pequenos, mas o
        // gemini-2.5-pro é um modelo "thinking": parte (às vezes a maior
        // parte) do orçamento de maxOutputTokens é gasta em raciocínio
        // interno, invisível na resposta. Num exame maior/mais complexo, o
        // raciocínio sozinho já estourava os 2000 tokens antes de escrever
        // qualquer texto de resposta — resultado: `content.parts` vinha
        // vazio e a tela mostrava "a IA não retornou nenhum resumo", mesmo
        // sem nenhum filtro de segurança ter sido acionado. Aumentei bastante
        // o teto de saída e limitei o orçamento de raciocínio, deixando
        // espaço garantido pro texto do resumo em si.
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0,
          thinkingConfig: { thinkingBudget: 1024 },
        },
      }),
    })

    if (!geminiRes.ok) {
      const errText = await geminiRes.text()
      throw new Error(`A IA não conseguiu processar o exame (${geminiRes.status}). ${errText.slice(0, 200)}`)
    }
    const json = await geminiRes.json()
    const candidate = json?.candidates?.[0]
    const finishReason = candidate?.finishReason
    const summary = (candidate?.content?.parts || [])
      .filter((p: any) => typeof p?.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
      .trim()
    if (!summary) {
      if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
        throw new Error('A IA recusou processar este arquivo (filtro de segurança do Gemini). Tente novamente ou avise o suporte técnico.')
      }
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('O exame é grande/complexo demais e a IA foi cortada antes de terminar o resumo. Tente novamente — se persistir, avise o suporte técnico.')
      }
      throw new Error('A IA não retornou nenhum resumo.')
    }

    return NextResponse.json({ summary })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Não foi possível analisar o exame.' }, { status: 500 })
  }
}
