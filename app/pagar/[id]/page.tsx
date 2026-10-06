'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Check, Copy, Loader2, Share2, XCircle } from 'lucide-react'

// v47.06 — Página pública (sem login) do link de cobrança PIX enviado por
// WhatsApp. Mesmo molde da tela de confirmação de consulta: só conversa com
// app/api/cobranca-pix/[id], e usa o cliente anônimo apenas para pegar logo e
// cor da clínica (dado público, igual à tela de login).
//
// Foi desenhada olhando a página que o paciente já conhecia (a do meuairgo):
// valor em destaque, QR grande, botão de copiar o código e botão de compartilhar.
//
// v47.11 — dois problemas no celular, resolvidos juntos:
//   1) o CRM trava a rolagem do body no mobile (globals.css) para o header do
//      inbox não oscilar. Numa página pública isso cortava o conteúdo: o botão
//      de copiar ficava embaixo da dobra e não dava para rolar até ele. Aqui a
//      própria página vira a área de rolagem (h-[100dvh] overflow-y-auto), sem
//      mexer no comportamento do CRM.
//   2) mesmo rolando, o ideal é caber de uma vez. O espaçamento foi reduzido e
//      o QR passou a ser proporcional à largura do celular, com teto no desktop.

type Dados = {
  valor: number
  descricao: string
  brcode: string
  qr_url: string | null
  status: string
  recebedor: string
  banco: string
}

export default function PagarPix() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  const [clinicName, setClinicName] = useState('Obesity Health')

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState<Dados | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [compartilhado, setCompartilhado] = useState(false)

  useEffect(() => {
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').single()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url)
        if (data?.primary_color) setPrimaryColor(data.primary_color)
        if (data?.clinic_name) setClinicName(data.clinic_name)
      })
  }, [])

  useEffect(() => {
    if (!id) return
    fetch(`/api/cobranca-pix/${id}`)
      .then(async r => {
        if (!r.ok) throw new Error('nao encontrado')
        return r.json()
      })
      .then(setDados)
      .catch(() => setErro('Não encontramos esta cobrança. Ela pode ter expirado ou o link estar incompleto.'))
      .finally(() => setLoading(false))
  }, [id])

  async function copiar() {
    if (!dados) return
    try {
      await navigator.clipboard.writeText(dados.brcode)
    } catch {
      // Safari antigo e WebView do WhatsApp às vezes bloqueiam a API moderna.
      const el = document.createElement('textarea')
      el.value = dados.brcode
      document.body.appendChild(el); el.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(el)
    }
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

  async function compartilhar() {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: `Pagamento ${clinicName}`, url }); return } catch { /* usuário cancelou */ }
    }
    try { await navigator.clipboard.writeText(url); setCompartilhado(true); setTimeout(() => setCompartilhado(false), 2500) } catch {}
  }

  const valorBR = dados ? dados.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-y-auto bg-slate-50 flex flex-col items-center px-4 py-3">
      <div className="w-full max-w-md my-auto">
        <div className="flex flex-col items-center text-center mb-2.5">
          {logoUrl
            ? <img src={logoUrl} alt={clinicName} className="w-14 h-14 object-contain mb-2"/>
            : <div className="w-14 h-14 rounded-full mb-2" style={{ background: primaryColor }}/>}
          <h1 className="text-base font-semibold text-slate-800">Pague com PIX para {clinicName}</h1>
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin mb-2"/>
            <p className="text-sm">Carregando...</p>
          </div>
        ) : erro ? (
          <div className="bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">
            <XCircle size={30} className="text-slate-300 mx-auto mb-3"/>
            <p className="text-sm text-slate-600">{erro}</p>
          </div>
        ) : dados ? (
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
            <p className="text-center text-xs text-slate-500">Valor</p>
            <p className="text-center text-2xl font-semibold text-slate-800">{valorBR}</p>
            {dados.descricao && <p className="text-center text-sm text-slate-500 mt-0.5">{dados.descricao}</p>}

            {dados.status === 'paga' && (
              <div className="mt-3 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
                <Check size={15}/> Pagamento já registrado pela clínica
              </div>
            )}

            <p className="text-center text-xs text-slate-500 mt-3 mb-3">
              Pague pelo QR Code ou pelo PIX Copia e Cola
            </p>

            {dados.qr_url && (
              // Proporcional à largura do celular, com teto para não estourar no
              // desktop. Antes eram 240px fixos, que num aparelho menor empurravam
              // os botões para fora da tela.
              <img src={dados.qr_url} alt="QR Code do PIX"
                className="w-[min(48vw,190px,26dvh)] aspect-square mx-auto mb-3 rounded-xl border border-slate-100"/>
            )}

            <button onClick={copiar}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold mb-2"
              style={{ background: copiado ? '#059669' : primaryColor }}>
              {copiado ? <><Check size={16}/> Código copiado!</> : <><Copy size={16}/> Copiar código PIX Copia e Cola</>}
            </button>

            <button onClick={compartilhar}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium">
              {compartilhado ? <><Check size={16}/> Link copiado!</> : <><Share2 size={16}/> Compartilhar link de pagamento</>}
            </button>

            <p className="mt-2.5 text-center text-[11px] text-slate-400">
              Recebedor: {dados.recebedor}{dados.banco ? ` · ${dados.banco}` : ''}
            </p>
          </div>
        ) : null}

        <p className="mt-2.5 text-center text-[11px] text-slate-400">
          Em caso de dúvida, responda no WhatsApp da clínica.
        </p>
      </div>
    </div>
  )
}
