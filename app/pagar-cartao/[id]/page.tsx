'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Check, Loader2, XCircle } from 'lucide-react'

// v47.18 — Página pública onde o paciente escolhe em quantas vezes quer pagar.
//
// Por que ela existe: o valor do link da Safrapay é fixo, e a taxa depende de
// quantas parcelas o pagador escolher. Se o link fosse criado antes da escolha,
// seria preciso precificar pelo pior caso — e quem pagasse à vista arcaria com o
// acréscimo de quem parcela em 12x. Aqui o paciente vê cada opção pelo preço
// certo e, ao escolher, o link é criado naquele momento com o valor exato.
//
// Os valores vêm prontos do servidor. Esta página não calcula preço.

type Opcao = { parcelas: number; total: number; parcela: number }
type Dados = {
  descricao: string
  bandeira_nome: string
  status: string
  opcoes: Opcao[]
  url_safra: string | null
  provedor?: string
}

export default function PagarCartao() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  const [clinicName, setClinicName] = useState('Obesity Health')

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [dados, setDados] = useState<Dados | null>(null)
  const [escolhida, setEscolhida] = useState<number | null>(null)
  const [indo, setIndo] = useState(false)
  // v48.62 — Na InfinitePay o parcelamento é escolhido de novo na página deles.
  // O aviso de qual escolher fica aqui mesmo, junto do botão, para o paciente
  // não passar por uma tela só de confirmação antes de pagar.

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
    fetch(`/api/cobranca-cartao/${id}`)
      .then(async r => {
        const texto = await r.text()
        if (!r.ok || !texto) throw new Error('nao encontrado')
        try { return JSON.parse(texto) } catch { throw new Error('resposta invalida') }
      })
      .then((d: Dados) => {
        setDados(d)
        if (d.opcoes?.length === 1) setEscolhida(d.opcoes[0].parcelas)
      })
      .catch(() => setErro('Não encontramos esta cobrança. Ela pode ter expirado ou o link estar incompleto.'))
      .finally(() => setLoading(false))
  }, [id])

  // v48.05 — A resposta é lida como texto antes de virar JSON.
  //
  // Quando o servidor ou o proxy devolve uma página de erro em HTML, um
  // r.json() direto estoura com "Unexpected token '<'" — uma frase que não diz
  // nada a quem está tentando pagar, e que esconde o que de fato aconteceu.
  // Lendo como texto, conseguimos distinguir "a Safrapay recusou" de "o
  // servidor não respondeu", e dizer isso em português.
  async function continuar() {
    if (!escolhida || indo) return
    setIndo(true); setErro('')
    try {
      const r = await fetch(`/api/cobranca-cartao/${id}/escolher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcelas: escolhida }),
      })
      const texto = await r.text()
      let j: any = null
      try { j = texto ? JSON.parse(texto) : null } catch {}

      if (!j) {
        // Não veio JSON: o pedido não chegou a ser respondido pelo sistema de
        // cobrança. Registramos o código no console para a clínica conseguir
        // investigar, e mostramos algo acionável ao paciente.
        console.error('[pagar-cartao] resposta não-JSON', r.status, texto.slice(0, 200))
        throw new Error(
          r.status === 504 || r.status === 502
            ? 'O sistema de pagamento demorou para responder. Tente de novo em alguns instantes.'
            : `Não conseguimos abrir o pagamento agora (erro ${r.status}). Tente de novo ou avise a clínica pelo WhatsApp.`)
      }

      if (!r.ok || !j.url) throw new Error(j.erro || 'Não foi possível abrir o pagamento.')
      window.location.href = j.url
    } catch (e: any) {
      setErro(e?.message || 'Não foi possível abrir o pagamento.')
      setIndo(false)
    }
  }

  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  return (
    <div className="h-[100dvh] min-h-[100dvh] overflow-y-auto bg-slate-50 flex flex-col items-center px-4 py-3">
      <div className="w-full max-w-md my-auto">
        <div className="flex flex-col items-center text-center mb-2">
          {logoUrl
            ? <img src={logoUrl} alt={clinicName} className="w-14 h-14 object-contain mb-2"/>
            : <div className="w-14 h-14 rounded-full mb-2" style={{ background: primaryColor }}/>}
          <h1 className="text-base font-semibold text-slate-800">Pagamento com cartão — {clinicName}</h1>
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <Loader2 size={22} className="animate-spin mb-2"/>
            <p className="text-sm">Carregando...</p>
          </div>
        ) : !dados ? (
          <div className="bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">
            <XCircle size={30} className="text-slate-300 mx-auto mb-3"/>
            <p className="text-sm text-slate-600">{erro}</p>
          </div>
        ) : dados.status === 'paga' ? (
          <div className="bg-white border border-slate-200 rounded-2xl px-5 py-8 text-center">
            <Check size={30} className="text-emerald-500 mx-auto mb-3"/>
            <p className="text-sm text-slate-600">Este pagamento já foi concluído. Obrigado!</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl px-4 py-4">
            {dados.descricao && <p className="text-center text-sm text-slate-500 mb-1">{dados.descricao}</p>}
            <p className="text-center text-xs text-slate-500 mb-3">
              Escolha em quantas vezes quer pagar
            </p>

            <div className="space-y-1.5 max-h-[36vh] overflow-y-auto pr-0.5">
              {dados.opcoes.map(o => {
                const ativa = escolhida === o.parcelas
                return (
                  <button key={o.parcelas} type="button" onClick={() => setEscolhida(o.parcelas)}
                    className={'w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-colors ' +
                      (ativa ? 'border-2' : 'border-slate-200 hover:border-slate-300')}
                    style={ativa ? { borderColor: primaryColor, background: primaryColor + '10' } : undefined}>
                    <span className="text-sm font-semibold text-slate-800">
                      {o.parcelas === 1 ? 'À vista' : `${o.parcelas}x de ${brl(o.parcela)}`}
                    </span>
                    <span className="text-xs text-slate-500">
                      {o.parcelas === 1 ? brl(o.total) : `total ${brl(o.total)}`}
                    </span>
                  </button>
                )
              })}
            </div>

            {dados.provedor === 'infinitepay' && escolhida ? (
              <p className="mt-3 text-center text-xs text-slate-600">
                Na página do pagamento, escolha{' '}
                <span className="font-bold" style={{ color: primaryColor }}>
                  {escolhida === 1 ? 'à vista (1x)' : `${escolhida}x`}
                </span>.
              </p>
            ) : null}

            {erro && <p className="mt-2 text-xs text-red-600 text-center">{erro}</p>}

            <button onClick={continuar} disabled={!escolhida || indo}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
              style={{ background: primaryColor }}>
              {indo ? <><Loader2 size={16} className="animate-spin"/> Abrindo pagamento...</> : 'Continuar'}
            </button>

            <p className="mt-2 text-center text-[11px] text-slate-400">
              O pagamento é concluído em ambiente seguro {dados.provedor === 'infinitepay' ? 'da InfinitePay' : 'do Banco Safra'}. Os dados do seu cartão
              não passam pela clínica.
            </p>
          </div>
        )}

        <p className="mt-2 text-center text-[11px] text-slate-400">
          Em caso de dúvida, responda no WhatsApp da clínica.
        </p>
      </div>
    </div>
  )
}
