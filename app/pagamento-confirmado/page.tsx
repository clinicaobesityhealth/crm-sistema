'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CheckCircle2 } from 'lucide-react'

// v47.14 — Página pública para onde o paciente volta depois de pagar no ambiente
// do Banco Safra ou da InfinitePay. Ela não confirma pagamento nenhum por conta própria: quem diz
// se foi aprovado é a Safrapay, pelo webhook. Aqui é só o "pode fechar, deu
// certo" — evitar que o paciente caia numa página de erro ao voltar.

export default function PagamentoConfirmado() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [clinicName, setClinicName] = useState('Obesity Health')
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  // v48.50 — Quando o paciente volta da InfinitePay, o endereço traz os dados do
  // pagamento. Pedimos ao servidor que confira com a própria InfinitePay e dê a
  // baixa — segunda chance, caso o aviso automático (webhook) não chegue.
  const [confirmado, setConfirmado] = useState(false)
  const [recibo, setRecibo] = useState<string | null>(null)

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const order_nsu = q.get('order_nsu'), transaction_nsu = q.get('transaction_nsu'), slug = q.get('slug')
      const receipt_url = q.get('receipt_url')
      if (receipt_url && /^https:\/\//.test(receipt_url)) setRecibo(receipt_url)
      if (!order_nsu || !transaction_nsu || !slug) return
      fetch('/api/infinitepay/conferir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_nsu, transaction_nsu, slug, receipt_url }),
      }).then(r => r.json()).then(j => { if (j?.pago) setConfirmado(true) }).catch(() => {})
    } catch {}
  }, [])

  useEffect(() => {
    supabase.from('clinic_branding').select('logo_url, primary_color, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001').single()
      .then(({ data }) => {
        if (data?.logo_url) setLogoUrl(data.logo_url)
        if (data?.primary_color) setPrimaryColor(data.primary_color)
        if (data?.clinic_name) setClinicName(data.clinic_name)
      })
  }, [])

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-50 flex flex-col items-center justify-center px-5 text-center">
      {logoUrl
        ? <img src={logoUrl} alt={clinicName} className="w-16 h-16 object-contain mb-4"/>
        : <div className="w-16 h-16 rounded-full mb-4" style={{ background: primaryColor }}/>}
      <CheckCircle2 size={44} className="text-emerald-500 mb-3"/>
      <h1 className="text-lg font-semibold text-slate-800 mb-1">{confirmado ? 'Pagamento confirmado' : 'Pagamento enviado'}</h1>
      <p className="text-sm text-slate-500 max-w-xs">
        {confirmado
          ? <>Obrigado! A {clinicName} já registrou o seu pagamento.</>
          : <>Obrigado! Assim que o banco confirmar, a {clinicName} registra o pagamento.</>}
        {' '}Você pode fechar esta página — qualquer dúvida, responda no WhatsApp da clínica.
      </p>
      {recibo && (
        <a href={recibo} target="_blank" rel="noopener noreferrer"
          className="mt-4 text-sm font-semibold underline" style={{ color: primaryColor }}>
          Ver comprovante
        </a>
      )}
    </div>
  )
}
