'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import { supabase } from '@/lib/supabase'
import { gerarBrCode, normalizarChave } from '@/lib/pixBrCode'
import { INFINITEPAY_VAZIO, normalizarInfinitePay, simularInfinitePay, simularRepasseInfinitePay, limparHandle, TAXAS_INFINITEPAY_PADRAO, type InfinitePayConfig } from '@/lib/infinitepay'
import { MEIOS_SAFRA, simularParcelas, prazoMedioMeses, taxaEfetiva, calcularBruto, TAXAS_BANDEIRA_PADRAO, NOME_BANDEIRA, ANTECIPACAO_PADRAO, TEXTO_PARCELAMENTO_PADRAO, type Bandeira, type SafraConfig } from '@/lib/safrapay'
import BandeiraIcone from '@/components/BandeiraIcone'
import { AlertCircle, Check, CreditCard, Eye, EyeOff, Loader2, Plus, QrCode, Save, Trash2 } from 'lucide-react'

// v47.06 — Configuração da cobrança PIX.
// v47.14 — Ganhou a configuração do cartão (Link de Pagamentos da Safrapay).
//
// A chave PIX e o Merchant Token ficam AQUI, digitados pela clínica, e nunca
// dentro do código. Ficam em clinic_settings.pix_config e clinic_settings.safra_config.

type PixConfig = {
  chave: string
  tipo: string
  nome_recebedor: string
  cidade: string
  banco: string
  // Descrições prontas que aparecem como atalho na hora de cobrar, para a equipe
  // não digitar "Consulta presencial" toda vez (e não escrever cada vez de um
  // jeito diferente, o que atrapalha na hora de conferir depois).
  // v47.14 — cada descrição carrega o parcelamento sugerido: consulta em 2x,
  // cirurgia em 12x. A equipe ainda pode mudar na hora da cobrança.
  descricoes: { texto: string; parcelas: number }[]
}

const pixVazio: PixConfig = {
  chave: '', tipo: 'telefone', nome_recebedor: '', cidade: '', banco: 'Safra',
  descricoes: [
    { texto: 'Consulta presencial', parcelas: 2 },
    { texto: 'Consulta online', parcelas: 2 },
    { texto: 'Cirurgia', parcelas: 12 },
  ],
}

const safraVazio: SafraConfig = {
  ambiente: 'homologacao',
  merchant_id: '',
  merchant_token: '',
  meios: [1, 2],
  repassar_taxa: true,
  paciente_escolhe: false,
  // Já vem preenchido com as taxas do contrato da clínica (coluna online, a
  // bandeira mais cara de cada faixa). São números seus, não do sistema —
  // confira antes de usar com paciente e ajuste se o contrato mudar.
  taxas_bandeira: JSON.parse(JSON.stringify(TAXAS_BANDEIRA_PADRAO)),
  bandeira_padrao: 'visa_master',
  antecipa: true,
  avista_sem_acrescimo: true,
  texto_parcelamento: TEXTO_PARCELAMENTO_PADRAO,
  taxa_antecipacao: ANTECIPACAO_PADRAO,
  max_parcelas: 12,
}

// Aceita o formato antigo (lista de textos) e o novo (texto + parcelas).
function normalizarDescricoes(bruto: any): { texto: string; parcelas: number }[] {
  if (!Array.isArray(bruto)) return pixVazio.descricoes
  return bruto.map((d: any) =>
    typeof d === 'string'
      ? { texto: d, parcelas: /cirurg/i.test(d) ? 12 : 2 }
      : { texto: String(d?.texto || ''), parcelas: Number(d?.parcelas) || 1 }
  ).filter(d => d.texto)
}

export default function PagamentosSettings() {
  const [cfg, setCfg] = useState<PixConfig>(pixVazio)
  const [safra, setSafra] = useState<SafraConfig>(safraVazio)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')
  const [verToken, setVerToken] = useState(false)
  const [testando, setTestando] = useState(false)
  const [testeSafra, setTesteSafra] = useState<{ ok: boolean; mensagem: string; detalhe?: string } | null>(null)
  const [bandeiraEditando, setBandeiraEditando] = useState<Bandeira>('visa_master')
  // v48.50 — InfinitePay e a chave que escolhe por onde o cartão passa.
  const [provedor, setProvedor] = useState<'safra' | 'infinitepay' | 'desligado'>('safra')
  const [ip, setIp] = useState<InfinitePayConfig>(INFINITEPAY_VAZIO)
  const [verSafra, setVerSafra] = useState(false)
  const [testandoIp, setTestandoIp] = useState(false)
  const [testeIp, setTesteIp] = useState<{ ok: boolean; mensagem: string; url?: string; detalhe?: string } | null>(null)
  function campoIp<K extends keyof InfinitePayConfig>(k: K, v: InfinitePayConfig[K]) { setIp(s => ({ ...s, [k]: v })); setSalvo(false) }
  function editarTaxaIp(p: number, valor: string) {
    const n = Number(String(valor).replace(',', '.'))
    setIp(s => ({ ...s, taxas: { ...s.taxas, [String(p)]: Number.isFinite(n) ? n : 0 } })); setSalvo(false)
  }
  async function testarIp() {
    setTestandoIp(true); setTesteIp(null)
    try {
      const r = await fetch('/api/infinitepay/testar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: ip.handle }),
      })
      const texto = await r.text()
      let j: any = null
      try { j = texto ? JSON.parse(texto) : null } catch {}
      if (!j) setTesteIp({ ok: false, mensagem: `O próprio CRM não respondeu ao teste (erro ${r.status}).` })
      else setTesteIp({
        ok: !!j.ok, mensagem: j.mensagem || '', url: j.url,
        detalhe: [j.status_http ? 'HTTP ' + j.status_http : '', typeof j.tempo_ms === 'number' ? j.tempo_ms + ' ms' : '', j.corpo ? 'resposta: ' + j.corpo : ''].filter(Boolean).join(' · '),
      })
    } catch (e: any) {
      setTesteIp({ ok: false, mensagem: 'Não foi possível executar o teste: ' + (e?.message || e) })
    }
    setTestandoIp(false)
  }

  useEffect(() => {
    supabase.from('clinic_settings').select('*').limit(1)
      .then(({ data, error }) => {
        if (error) setErro('Não foi possível carregar: ' + error.message)
        const linha = data?.[0]
        if (linha) {
          setSettingsId(linha.id)
          const pix = ((linha as any).pix_config || {}) as Partial<PixConfig>
          setCfg({ ...pixVazio, ...pix, descricoes: normalizarDescricoes(pix.descricoes) })
          const prov = String((linha as any).cartao_provedor || 'safra')
          setProvedor(prov === 'infinitepay' || prov === 'desligado' ? prov : 'safra')
          setIp(normalizarInfinitePay((linha as any).infinitepay_config))
          const sf = ((linha as any).safra_config || {}) as Partial<SafraConfig>
          setSafra({
            ...safraVazio, ...sf,
            // Configuração salva antes de existirem as taxas: preenche com as do
            // contrato em vez de deixar tudo zerado (o que faria o repasse não
            // acontecer, silenciosamente).
            taxas_bandeira: sf.taxas_bandeira ?? JSON.parse(JSON.stringify(TAXAS_BANDEIRA_PADRAO)),
            bandeira_padrao: sf.bandeira_padrao ?? 'visa_master',
            antecipa: sf.antecipa ?? true,
            avista_sem_acrescimo: sf.avista_sem_acrescimo ?? true,
            texto_parcelamento: sf.texto_parcelamento ?? TEXTO_PARCELAMENTO_PADRAO,
            paciente_escolhe: sf.paciente_escolhe ?? false,
            taxa_antecipacao: Number.isFinite(Number(sf.taxa_antecipacao)) && Number(sf.taxa_antecipacao) > 0
              ? Number(sf.taxa_antecipacao) : ANTECIPACAO_PADRAO,
            meios: sf.meios?.length ? sf.meios : [1, 2],
          })
        }
        setLoading(false)
      })
  }, [])

  function campo(k: keyof PixConfig, v: string) { setCfg(c => ({ ...c, [k]: v })); setSalvo(false) }
  function campoSafra<K extends keyof SafraConfig>(k: K, v: SafraConfig[K]) { setSafra(s => ({ ...s, [k]: v })); setSalvo(false) }

  function editarDescricao(i: number, patch: Partial<{ texto: string; parcelas: number }>) {
    setCfg(c => ({ ...c, descricoes: c.descricoes.map((d, idx) => idx === i ? { ...d, ...patch } : d) })); setSalvo(false)
  }
  function removerDescricao(i: number) {
    setCfg(c => ({ ...c, descricoes: c.descricoes.filter((_, idx) => idx !== i) })); setSalvo(false)
  }
  function novaDescricao() {
    setCfg(c => ({ ...c, descricoes: [...c.descricoes, { texto: '', parcelas: 1 }] })); setSalvo(false)
  }
  function editarTaxa(bandeira: Bandeira, parcela: number, valor: string) {
    const n = Number(valor.replace(',', '.'))
    setSafra(s => ({
      ...s,
      taxas_bandeira: {
        ...s.taxas_bandeira,
        [bandeira]: {
          ...s.taxas_bandeira[bandeira],
          parcelas: { ...s.taxas_bandeira[bandeira].parcelas, [String(parcela)]: Number.isFinite(n) ? n : 0 },
        },
      },
    }))
    setSalvo(false)
  }
  function editarDebito(bandeira: Bandeira, valor: string) {
    const n = Number(valor.replace(',', '.'))
    setSafra(s => ({
      ...s,
      taxas_bandeira: { ...s.taxas_bandeira, [bandeira]: { ...s.taxas_bandeira[bandeira], debito: Number.isFinite(n) ? n : 0 } },
    }))
    setSalvo(false)
  }
  function alternarMeio(v: number) {
    setSafra(s => ({ ...s, meios: s.meios.includes(v) ? s.meios.filter(m => m !== v) : [...s.meios, v].sort() })); setSalvo(false)
  }

  // Testa só a autenticação com a Safrapay: não cria cobrança nem link.
  // Serve para responder, em um clique, a pergunta que aparece toda vez que um
  // pagamento falha — é a credencial, o ambiente, ou a Safrapay fora do ar?
  async function testarSafra() {
    setTestando(true); setTesteSafra(null)
    try {
      const r = await fetch('/api/safrapay/testar', { method: 'POST' })
      const texto = await r.text()
      let j: any = null
      try { j = texto ? JSON.parse(texto) : null } catch {}
      if (!j) {
        setTesteSafra({ ok: false, mensagem: `O próprio CRM não respondeu ao teste (erro ${r.status}).` })
      } else {
        const partes: string[] = []
        if (j.gateway) partes.push(j.gateway)
        if (j.status_http) partes.push('HTTP ' + j.status_http)
        if (typeof j.tempo_ms === 'number') partes.push(j.tempo_ms + ' ms')
        if (j.corpo) partes.push('resposta: ' + j.corpo)
        setTesteSafra({ ok: !!j.ok, mensagem: j.mensagem || '', detalhe: partes.join(' · ') })
      }
    } catch (e: any) {
      setTesteSafra({ ok: false, mensagem: 'Não foi possível executar o teste: ' + (e?.message || e) })
    }
    setTestando(false)
  }

  async function salvar() {
    if (!settingsId) { setErro('Configuração da clínica não encontrada.'); return }
    if (!cfg.chave.trim()) { setErro('Informe a chave PIX.'); return }
    setSalvando(true); setErro('')
    const pixLimpo: PixConfig = {
      chave: cfg.chave.trim(),
      tipo: cfg.tipo,
      nome_recebedor: cfg.nome_recebedor.trim(),
      cidade: cfg.cidade.trim(),
      banco: cfg.banco.trim(),
      descricoes: cfg.descricoes.map(d => ({ texto: d.texto.trim(), parcelas: Math.min(Math.max(1, d.parcelas || 1), 12) })).filter(d => d.texto),
    }
    const safraLimpo: SafraConfig = {
      antecipa: !!safra.antecipa,
      avista_sem_acrescimo: !!safra.avista_sem_acrescimo,
      texto_parcelamento: (safra.texto_parcelamento ?? '').trim(),
      paciente_escolhe: !!safra.paciente_escolhe,
      taxa_antecipacao: Number(safra.taxa_antecipacao) || 0,
      ambiente: safra.ambiente === 'producao' ? 'producao' : 'homologacao',
      merchant_id: (safra.merchant_id || '').trim(),
      merchant_token: (safra.merchant_token || '').trim(),
      meios: safra.meios?.length ? safra.meios : [1, 2],
      repassar_taxa: !!safra.repassar_taxa,
      taxas_bandeira: safra.taxas_bandeira,
      bandeira_padrao: safra.bandeira_padrao || 'visa_master',
      max_parcelas: Math.min(Math.max(1, Number(safra.max_parcelas) || 12), 12),
    }
    if (provedor === 'infinitepay' && !limparHandle(ip.handle)) {
      setSalvando(false); setErro('Para cobrar pela InfinitePay, preencha a InfiniteTag.'); return
    }
    const ipLimpo: InfinitePayConfig = {
      ...normalizarInfinitePay(ip),
      texto_parcelamento: (ip.texto_parcelamento ?? '').trim(),
    }
    const { error } = await supabase.from('clinic_settings')
      .update({ pix_config: pixLimpo, safra_config: safraLimpo, cartao_provedor: provedor, infinitepay_config: ipLimpo }).eq('id', settingsId)
    setSalvando(false)
    if (error) {
      const falta = /cartao_provedor|infinitepay_config/.test(error.message)
        ? ' — falta rodar no Supabase a migração 20260921_infinitepay_v48_50.sql.' : ''
      setErro('Não foi possível salvar: ' + error.message + falta); return
    }
    setSalvo(true)
    setTimeout(() => setSalvo(false), 3000)
  }

  // Prévia: mostra que a configuração produz um código válido, sem cobrar ninguém.
  let previa = ''
  let previaErro = ''
  const chaveNoCodigo = cfg.chave.trim() ? normalizarChave(cfg.chave.trim(), cfg.tipo) : ''
  try {
    if (cfg.chave.trim()) {
      previa = gerarBrCode({ chave: cfg.chave.trim(), tipo: cfg.tipo, nome: cfg.nome_recebedor || 'OBESITY HEALTH', cidade: cfg.cidade || 'SAO PAULO', valor: 1 })
    }
  } catch (e: any) { previaErro = e?.message || 'erro' }

  // Simulação do repasse: o que a clínica recebe x o que o paciente paga.
  const simulacao = simularParcelas(100000, safra, bandeiraEditando).filter(o => [1, 2, 6, 12].includes(o.parcelas))
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const simulacaoIp = simularInfinitePay(100000, ip).filter(o => [1, 2, 6, 12].includes(o.parcelas))
  // Comparação de CUSTO puro (quanto some do valor, sem nenhuma regra de repasse):
  // Safra = taxa do cartão + antecipação sobre o prazo médio; InfinitePay = taxa
  // da tabela, que já é com recebimento em 1 dia útil (plano Novus).
  const safraCusto = { ...safra, avista_sem_acrescimo: false, meios: [2] } as SafraConfig
  const comparacao = Array.from({ length: 12 }, (_, i) => i + 1).map(p => {
    const tSafra = taxaEfetiva(safraCusto, bandeiraEditando, p)
    const tIp = Number(ip.taxas?.[String(p)] ?? TAXAS_INFINITEPAY_PADRAO[String(p)]) || 0
    return { p, tSafra, tIp, bSafra: calcularBruto(1000000, tSafra), bIp: calcularBruto(1000000, tIp) }
  })
  const pct = (n: number) => n.toFixed(2).replace('.', ',') + '%'

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-400'
  const cardClass = 'bg-white border border-slate-200 rounded-2xl p-5 space-y-4'
  const labelClass = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5'

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar/>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-1">
            <QrCode size={20} className="text-brand-600"/>
            <h1 className="text-xl font-semibold text-slate-800">Cobrança</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">
            PIX e cartão de crédito. Os dados ficam guardados na configuração da clínica,
            nunca no código do sistema.
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 py-10"><Loader2 size={16} className="animate-spin"/> Carregando...</div>
          ) : (
            <div className="space-y-5">

              {/* ---------------------------------------------------------- PIX */}
              <div className={cardClass}>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><QrCode size={15} className="text-emerald-600"/> PIX</p>

                <div>
                  <label className={labelClass}>Tipo da chave</label>
                  <select value={cfg.tipo} onChange={e => campo('tipo', e.target.value)} className={inputClass}>
                    <option value="telefone">Telefone</option>
                    <option value="cpf">CPF</option>
                    <option value="cnpj">CNPJ</option>
                    <option value="email">E-mail</option>
                    <option value="aleatoria">Chave aleatória</option>
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Chave PIX</label>
                  <input value={cfg.chave} onChange={e => campo('chave', e.target.value)} className={inputClass}
                    placeholder="Somente números, no caso de telefone/CPF/CNPJ"/>
                  <p className="mt-1 text-xs text-slate-400">É a conta que vai receber. Confira com atenção — o dinheiro cai exatamente aqui.</p>
                  {chaveNoCodigo && (
                    <p className="mt-1 text-xs text-slate-500">
                      No código PIX ela entra como <span className="font-mono font-semibold text-slate-700">{chaveNoCodigo}</span>
                      {cfg.tipo === 'telefone' && ' — o +55 é acrescentado automaticamente.'}
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Nome do recebedor</label>
                  <input value={cfg.nome_recebedor} onChange={e => campo('nome_recebedor', e.target.value)} className={inputClass}
                    placeholder="OBESITY HEALTH" maxLength={25}/>
                  <p className="mt-1 text-xs text-slate-400">É o que o paciente vê no app do banco. Máximo de 25 caracteres, sem acento (o padrão do PIX não aceita).</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Cidade</label>
                    <input value={cfg.cidade} onChange={e => campo('cidade', e.target.value)} className={inputClass}
                      placeholder="SAO PAULO" maxLength={15}/>
                  </div>
                  <div>
                    <label className={labelClass}>Banco (exibição)</label>
                    <input value={cfg.banco} onChange={e => campo('banco', e.target.value)} className={inputClass} placeholder="Safra"/>
                  </div>
                </div>

                {previa && (
                  <div className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <p className="text-xs font-semibold text-emerald-700 mb-1">Prévia de um código de R$ 1,00 (não cobra ninguém)</p>
                    <p className="text-[11px] text-emerald-800 break-all font-mono leading-4">{previa}</p>
                  </div>
                )}
                {previaErro && (
                  <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">{previaErro}</div>
                )}
              </div>

              {/* ------------------------------------------ CARTÃO: POR ONDE */}
              <div className={cardClass}>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><CreditCard size={15} className="text-brand-600"/> Cartão — por onde cobrar</p>
                <p className="text-xs text-slate-500 -mt-2">
                  A chave vale para as próximas cobranças. As que já foram enviadas terminam por onde começaram.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { v: 'infinitepay', t: 'InfinitePay' },
                    { v: 'safra', t: 'Safrapay' },
                    { v: 'desligado', t: 'Desligado' },
                  ] as const).map(o => (
                    <button key={o.v} type="button" onClick={() => { setProvedor(o.v); setSalvo(false) }}
                      className={'px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors ' + (provedor === o.v
                        ? (o.v === 'desligado' ? 'bg-slate-100 border-slate-400 text-slate-700' : 'bg-brand-50 border-brand-300 text-brand-800')
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300')}>
                      {o.t}
                    </button>
                  ))}
                </div>
                {provedor === 'desligado' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    O botão "Enviar no cartão" fica indisponível até escolher InfinitePay ou Safrapay. O PIX continua funcionando.
                  </p>
                )}
              </div>

              {/* ------------------------------------------- CARTÃO: INFINITEPAY */}
              {provedor === 'infinitepay' && (
              <div className={cardClass}>
                <img src="/logo-infinitepay.png" alt="InfinitePay" className="h-7 object-contain object-left"/>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><CreditCard size={15} className="text-brand-600"/> Cartão — Link de pagamento InfinitePay</p>
                <p className="text-xs text-slate-500 -mt-2">
                  Não tem token nem homologação: o que identifica a clínica é a InfiniteTag. O paciente paga na página da
                  InfinitePay (cartão ou PIX) e nenhum dado de cartão passa pelo CRM.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>InfiniteTag</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                      <input value={ip.handle} onChange={e => campoIp('handle', limparHandle(e.target.value))}
                        className={inputClass + ' pl-6'} placeholder="obesityhealth" autoComplete="off"/>
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Máximo de parcelas</label>
                    <input type="number" min={1} max={12} value={ip.max_parcelas}
                      onChange={e => campoIp('max_parcelas', Number(e.target.value))} className={inputClass}/>
                  </div>
                </div>
                <p className="-mt-2 text-xs text-slate-400">
                  Está no app da InfinitePay, no seu perfil — o nome com $ na frente. Pode colar com ou sem o $.
                </p>

                <div>
                  <button type="button" onClick={testarIp} disabled={testandoIp || !ip.handle}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-50">
                    {testandoIp ? 'Gerando...' : 'Gerar link de teste de R$ 1,00'}
                  </button>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Criar o link não cobra ninguém. Abra e confira se aparece o nome da clínica; não precisa pagar.
                  </p>
                  {testeIp && (
                    <div className={'mt-2 rounded-lg px-3 py-2 text-xs ' + (testeIp.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                      <p className="font-semibold">{testeIp.mensagem}</p>
                      {testeIp.url && <a href={testeIp.url} target="_blank" rel="noopener noreferrer" className="block mt-1 underline break-all">{testeIp.url}</a>}
                      {testeIp.detalhe && <p className="mt-0.5 opacity-70 break-all">{testeIp.detalhe}</p>}
                    </div>
                  )}
                </div>

                <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold">Tem que combinar com o app da InfinitePay</p>
                  <p>
                    No site da InfinitePay: Checkout Integrado → Configurações → Meios de pagamento → Cartão.
                  </p>
                  {ip.repassar_taxa ? (
                    <p>
                      Com o CRM calculando a taxa, lá tem que estar <strong>"Até 12x"</strong> (a clínica assume todas as
                      taxas). Se estiver "Repassar todas as taxas", a InfinitePay soma juros de novo por cima do valor que o
                      CRM já calculou, e o paciente paga duas vezes.
                    </p>
                  ) : (
                    <p>
                      Com a InfinitePay calculando os juros, lá tem que estar <strong>"Repassar todas as taxas"</strong>
                      (à vista no cartão também com acréscimo) ou <strong>"Até 1x"</strong> (à vista sem acréscimo, a clínica
                      assume os 4,2%). Se estiver "Até 12x", a clínica paga todas as taxas.
                    </p>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Como cobrar</label>
                  <div className="space-y-2">
                    {[
                      { rep: false, livre: true, titulo: 'A InfinitePay calcula os juros (recomendado)',
                        texto: 'O link vai com o valor que a clínica quer receber. Na página, o paciente vê o PIX sem acréscimo e o preço de cada parcelamento no cartão, e escolhe. Não tem como desencontrar: qualquer parcelamento fecha a conta.' },
                      { rep: true, livre: true, titulo: 'O CRM calcula — paciente escolhe na nossa página',
                        texto: 'Ele recebe a nossa página com cada opção pelo preço da tabela abaixo, escolhe, e vai à InfinitePay com o valor exato — e um aviso de qual parcelamento marcar lá.' },
                      { rep: true, livre: false, titulo: 'O CRM calcula — secretária define o parcelamento',
                        texto: 'O link sai com o valor do parcelamento escolhido, e a mensagem pede para o paciente marcar esse número. Se ele marcar outro, a cobrança fica com aviso de divergência.' },
                    ].map((m, i) => {
                      const ativo = !!ip.repassar_taxa === m.rep && (!m.rep || !!ip.paciente_escolhe === m.livre)
                      return (
                        <button key={i} type="button"
                          onClick={() => { campoIp('repassar_taxa', m.rep); campoIp('paciente_escolhe', m.livre) }}
                          className={'w-full text-left px-3 py-2.5 rounded-lg border transition-colors ' + (ativo
                            ? 'bg-brand-50 border-brand-300' : 'bg-white border-slate-200 hover:border-slate-300')}>
                          <span className={'block text-sm font-medium ' + (ativo ? 'text-brand-800' : 'text-slate-700')}>{m.titulo}</span>
                          <span className="block mt-0.5 text-xs text-slate-500">{m.texto}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {!ip.repassar_taxa && (
                  <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-slate-700">No app da InfinitePay, a clínica assume a taxa até</span>
                      <select value={ip.assume_ate} onChange={e => campoIp('assume_ate', Number(e.target.value))}
                        className="px-2 py-1 border border-slate-200 rounded-lg text-sm">
                        <option value={0}>nenhuma (repassa tudo)</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(p => <option key={p} value={p}>{p}x</option>)}
                      </select>
                    </div>
                    <p className="text-xs text-slate-500">
                      Tem que ser igual ao que está no app ("Assumindo até 1x"). É o que faz a janela de cobrança mostrar
                      para a secretária quanto o paciente vai pagar em cada parcelamento — para passar orçamento.
                    </p>
                    <table className="w-full text-xs text-slate-600">
                      <thead><tr className="text-slate-400"><th className="text-left font-medium">R$ 1.000,00 em</th><th className="text-right font-medium">Paciente paga</th><th className="text-right font-medium">Por parcela</th></tr></thead>
                      <tbody>
                        {simularRepasseInfinitePay(100000, ip).filter(o => [1, 2, 6, 10, 12].includes(o.parcelas)).map(o => (
                          <tr key={o.parcelas}><td className="py-0.5">{o.parcelas}x</td><td className="text-right font-semibold text-slate-700">{brl(o.totalCentavos)}</td><td className="text-right">{brl(o.parcelaCentavos)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {ip.repassar_taxa && (
                  <div>
                    <div className="mb-3 px-3 py-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={ip.avista_sem_acrescimo}
                          onChange={e => campoIp('avista_sem_acrescimo', e.target.checked)} className="rounded"/>
                        <span className="text-sm text-slate-700">Pagamento à vista sem nenhum acréscimo</span>
                      </label>
                      <p className="mt-1 text-xs text-slate-500">
                        Ligado, quem paga em 1x paga o valor digitado e a clínica absorve os {pct(Number(ip.taxas['1']) || 0)} da InfinitePay.
                      </p>
                    </div>

                    <label className={labelClass}>Taxas do link InfinitePay (%) — todas as bandeiras</label>
                    <p className="text-xs text-slate-400 mb-2">
                      Preenchidas com a tabela "Link de Pagamento e Gestão de Cobrança" que você enviou. Já incluem o
                      recebimento em 1 dia útil (plano Novus) — não há antecipação para somar.
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {Array.from({ length: Math.min(ip.max_parcelas || 12, 12) }, (_, i) => i + 1).map(p => (
                        <div key={p}>
                          <span className="block text-[11px] text-slate-500 mb-0.5">{p}x{p === 1 && ip.avista_sem_acrescimo ? ' · sem acréscimo' : ''}</span>
                          <input value={ip.taxas?.[String(p)] ?? ''} onChange={e => editarTaxaIp(p, e.target.value)}
                            disabled={p === 1 && ip.avista_sem_acrescimo} inputMode="decimal"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-400"/>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-xs font-semibold text-slate-600 mb-1.5">Simulação para R$ 1.000,00 que a clínica quer receber</p>
                      <table className="w-full text-xs text-slate-600">
                        <thead><tr className="text-slate-400"><th className="text-left font-medium">Parcelas</th><th className="text-right font-medium">Taxa</th><th className="text-right font-medium">Paciente paga</th><th className="text-right font-medium">Por parcela</th></tr></thead>
                        <tbody>
                          {simulacaoIp.map(o => (
                            <tr key={o.parcelas}>
                              <td className="py-0.5">{o.parcelas}x</td>
                              <td className="text-right">{o.taxa ? pct(o.taxa) : '—'}</td>
                              <td className="text-right font-semibold text-slate-700">{brl(o.totalCentavos)}</td>
                              <td className="text-right">{brl(o.parcelaCentavos)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelClass}>Explicação enviada com a cobrança</label>
                  <textarea value={ip.texto_parcelamento ?? ''} rows={3} maxLength={300}
                    onChange={e => campoIp('texto_parcelamento', e.target.value)}
                    className={inputClass + ' resize-none leading-5'}/>
                  <p className="mt-1 text-xs text-slate-400">Só vai quando há acréscimo. Em branco, nunca vai.</p>
                </div>

                <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs font-semibold text-slate-600 mb-1">Aviso de pagamento (webhook)</p>
                  <p className="text-xs text-slate-500">
                    Não precisa cadastrar nada: o CRM manda o endereço junto com cada link, e confere cada aviso com a
                    própria InfinitePay antes de dar baixa.
                  </p>
                </div>
              </div>
              )}

              {/* --------------------------------------- COMPARAÇÃO DE TAXAS */}
              <div className={cardClass}>
                <p className="text-sm font-semibold text-slate-700">Quanto custa cada um — Safra × InfinitePay</p>
                <p className="text-xs text-slate-500 -mt-2">
                  Custo total para receber em até 1 dia útil. Safra = taxa do cartão ({NOME_BANDEIRA[bandeiraEditando]}) +
                  antecipação de {pct(Number(safra.taxa_antecipacao) || 0)} ao mês sobre o prazo médio. InfinitePay = taxa da
                  tabela, igual para todas as bandeiras. Valores de cobrança para a clínica receber R$ 10.000,00.
                </p>
                <div className="flex gap-1.5">
                  {(['visa_master', 'elo', 'amex'] as Bandeira[]).map(b => (
                    <button key={b} type="button" onClick={() => setBandeiraEditando(b)}
                      className={'px-2.5 py-1 rounded-lg text-xs font-semibold border ' + (bandeiraEditando === b
                        ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-slate-200 text-slate-500')}>
                      {NOME_BANDEIRA[b]}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-slate-600">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left font-medium py-1">Parc.</th>
                        <th className="text-right font-medium">Safra</th>
                        <th className="text-right font-medium">InfinitePay</th>
                        <th className="text-right font-medium">Diferença</th>
                        <th className="text-right font-medium hidden sm:table-cell">Cobrar (Safra)</th>
                        <th className="text-right font-medium hidden sm:table-cell">Cobrar (InfinitePay)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparacao.map(c => {
                        const dif = c.tIp - c.tSafra
                        return (
                          <tr key={c.p} className="border-t border-slate-100">
                            <td className="py-1">{c.p}x</td>
                            <td className="text-right">{pct(c.tSafra)}</td>
                            <td className="text-right">{pct(c.tIp)}</td>
                            <td className={'text-right font-semibold ' + (dif > 0 ? 'text-red-600' : 'text-emerald-600')}>
                              {dif > 0 ? '+' : ''}{dif.toFixed(2).replace('.', ',')} pp
                            </td>
                            <td className="text-right hidden sm:table-cell">{brl(c.bSafra)}</td>
                            <td className="text-right hidden sm:table-cell">{brl(c.bIp)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">
                  Vermelho: a InfinitePay sai mais cara naquele parcelamento. A comparação usa as taxas que estão nesta tela —
                  se o contrato de algum dos dois mudar, ajuste a tabela e ela se refaz.
                </p>
              </div>

              {provedor !== 'safra' && (
                <button type="button" onClick={() => setVerSafra(v => !v)}
                  className="text-xs font-semibold text-slate-500 underline">
                  {verSafra ? 'Esconder a configuração do Safrapay' : 'Mostrar a configuração do Safrapay (guardada, sem uso)'}
                </button>
              )}

              {/* ------------------------------------------------------- CARTÃO */}
              {(provedor === 'safra' || verSafra) && (
              <div className={cardClass}>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2"><CreditCard size={15} className="text-brand-600"/> Cartão — Link de Pagamentos Safrapay</p>
                <p className="text-xs text-slate-500 -mt-2">
                  O paciente paga numa página do próprio Banco Safra. Nenhum dado de cartão passa pelo CRM.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Ambiente</label>
                    <select value={safra.ambiente} onChange={e => campoSafra('ambiente', e.target.value as any)} className={inputClass}>
                      <option value="homologacao">Homologação (testes)</option>
                      <option value="producao">Produção (cobra de verdade)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Máximo de parcelas</label>
                    <input type="number" min={1} max={12} value={safra.max_parcelas}
                      onChange={e => campoSafra('max_parcelas', Number(e.target.value))} className={inputClass}/>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Merchant ID</label>
                  <input value={safra.merchant_id} onChange={e => campoSafra('merchant_id', e.target.value)} className={inputClass}
                    placeholder="UUID do estabelecimento"/>
                </div>

                <div>
                  <label className={labelClass}>Merchant Token</label>
                  <div className="relative">
                    <input type={verToken ? 'text' : 'password'} value={safra.merchant_token}
                      onChange={e => campoSafra('merchant_token', e.target.value)} className={inputClass + ' pr-10'}
                      placeholder="mk_..." autoComplete="off"/>
                    <button type="button" onClick={() => setVerToken(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
                      {verToken ? <EyeOff size={15}/> : <Eye size={15}/>}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Sai do portal Safrapay em Configurações → Chave de Acesso. É uma senha de cobrança:
                    não envie por e-mail nem por mensagem.
                  </p>

                  <button type="button" onClick={testarSafra} disabled={testando}
                    className="mt-2 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-50">
                    {testando ? 'Testando...' : 'Testar conexão com a Safrapay'}
                  </button>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Só verifica a credencial. Não cria cobrança nem link de pagamento.
                  </p>

                  {testeSafra && (
                    <div className={'mt-2 rounded-lg px-3 py-2 text-xs ' +
                      (testeSafra.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
                      <p className="font-semibold">{testeSafra.mensagem}</p>
                      {testeSafra.detalhe && <p className="mt-0.5 opacity-70 break-all">{testeSafra.detalhe}</p>}
                    </div>
                  )}
                </div>

                <div>
                  <label className={labelClass}>Meios aceitos na página</label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 8].map(v => (
                      <button key={v} type="button" onClick={() => alternarMeio(v)}
                        className={'px-3 py-1.5 rounded-lg text-xs font-semibold border ' + (safra.meios.includes(v)
                          ? 'bg-brand-50 border-brand-300 text-brand-700'
                          : 'bg-white border-slate-200 text-slate-500')}>
                        {MEIOS_SAFRA[v]}
                      </button>
                    ))}
                  </div>
                  {safra.meios.includes(8) && (
                    <p className="mt-1.5 text-xs text-amber-600">
                      O PIX pela Safrapay tem custo por transação aprovada. O PIX que o CRM gera não tem.
                    </p>
                  )}
                </div>

                <div className="pt-1">
                  <label className={labelClass}>Como cobrar</label>
                  <div className="space-y-2">
                    {[
                      { rep: true, livre: false, titulo: 'Parcelamento definido pela secretária',
                        texto: 'O link vai travado no número de parcelas escolhido. A conta fecha exata: a clínica recebe exatamente o valor digitado.' },
                      { rep: true, livre: true, titulo: 'Paciente escolhe o parcelamento (recomendado)',
                        texto: 'O paciente recebe uma página nossa com cada opção pelo preço certo — "à vista R$ X", "6x de R$ Y" — escolhe a que couber e só então vai ao Safra, com o valor exato daquele parcelamento. Uma mensagem só, e ninguém paga a mais.' },
                      { rep: false, livre: true, titulo: 'Paciente escolhe, sem repassar taxa',
                        texto: 'Cobra exatamente o valor digitado e a taxa sai do caixa da clínica. É também o melhor jeito de testar se a própria Safrapay acrescenta juros na página.' },
                    ].map((m, i) => {
                      const ativo = !!safra.repassar_taxa === m.rep && !!safra.paciente_escolhe === m.livre
                      return (
                        <button key={i} type="button"
                          onClick={() => { campoSafra('repassar_taxa', m.rep); campoSafra('paciente_escolhe', m.livre) }}
                          className={'w-full text-left px-3 py-2.5 rounded-lg border transition-colors ' + (ativo
                            ? 'bg-brand-50 border-brand-300'
                            : 'bg-white border-slate-200 hover:border-slate-300')}>
                          <span className={'block text-sm font-medium ' + (ativo ? 'text-brand-800' : 'text-slate-700')}>{m.titulo}</span>
                          <span className="block mt-0.5 text-xs text-slate-500">{m.texto}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {safra.repassar_taxa && (
                  <div>
                    <div className="mb-3 px-3 py-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={safra.avista_sem_acrescimo}
                          onChange={e => campoSafra('avista_sem_acrescimo', e.target.checked)} className="rounded"/>
                        <span className="text-sm text-slate-700">Pagamento à vista sem nenhum acréscimo</span>
                      </label>
                      <p className="mt-1 text-xs text-slate-500">
                        Ligado, quem paga em 1x paga exatamente o valor digitado — sem taxa de cartão e sem
                        antecipação. O acréscimo passa a existir só a partir de 2x, onde ele é juros de parcelamento
                        e aparece discriminado para o paciente.
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Não adianta só zerar o campo de 1x na tabela abaixo: a antecipação é somada por cima e o
                        à vista continuaria com acréscimo.
                      </p>
                    </div>

                    <div className="mb-3 px-3 py-2.5 bg-amber-50/60 border border-amber-200 rounded-lg">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={safra.antecipa}
                          onChange={e => campoSafra('antecipa', e.target.checked)} className="rounded"/>
                        <span className="text-sm text-slate-700">A clínica antecipa os recebimentos</span>
                      </label>
                      {safra.antecipa && (
                        <div className="mt-2 flex items-center gap-2">
                          <input value={safra.taxa_antecipacao ?? ''} inputMode="decimal"
                            onChange={e => campoSafra('taxa_antecipacao', Number(e.target.value.replace(',', '.')))}
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"/>
                          <span className="text-xs text-slate-600">% ao mês</span>
                        </div>
                      )}
                      <p className="mt-2 text-xs text-slate-500">
                        A antecipação custa por tempo de espera. Numa venda em N parcelas o prazo médio é
                        (N+1)/2 meses — em 12x são 6,5 meses, ou seja {(prazoMedioMeses(12) * (safra.taxa_antecipacao || 0)).toFixed(2).replace('.', ',')}%
                        só de antecipação, bem acima da taxa do cartão. É o que mais pesa no preço final.
                      </p>
                    </div>

                    <label className={labelClass}>Taxas do cartão, por bandeira (%)</label>
                    <p className="text-xs text-slate-400 mb-2">
                      Preenchidas com o seu contrato, coluna <strong>online</strong>. Na hora de cobrar, a secretária
                      pergunta ao paciente qual cartão ele vai usar e escolhe aqui — assim o preço sai exato, sem
                      precisar supor a bandeira mais cara.
                    </p>

                    <div className="flex gap-1.5 mb-2">
                      {(['visa_master', 'elo', 'amex'] as Bandeira[]).map(b => (
                        <button key={b} type="button" onClick={() => setBandeiraEditando(b)}
                          className={'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border ' + (bandeiraEditando === b
                            ? 'bg-brand-50 border-brand-300 text-brand-700'
                            : 'bg-white border-slate-200 text-slate-500')}>
                          <BandeiraIcone bandeira={b} className="w-6 h-3.5"/>{NOME_BANDEIRA[b]}
                        </button>
                      ))}
                    </div>

                    {safra.meios?.includes(1) && (
                      <div className="mb-2 flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 w-16">Débito</span>
                        <input value={safra.taxas_bandeira?.[bandeiraEditando]?.debito ?? ''} inputMode="decimal"
                          onChange={e => editarDebito(bandeiraEditando, e.target.value)}
                          className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm"/>
                        <span className="text-[11px] text-slate-400">
                          o débito online costuma ser mais caro que o crédito à vista — a cobrança de 1x usa a maior das duas
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-2">
                      {Array.from({ length: Math.min(safra.max_parcelas || 12, 12) }, (_, i) => i + 1).map(p => (
                        <div key={p}>
                          <span className="block text-[11px] text-slate-500 mb-0.5">
                            {p}x{p === 1 && safra.avista_sem_acrescimo ? ' · sem acréscimo' : ''}
                          </span>
                          <input value={safra.taxas_bandeira?.[bandeiraEditando]?.parcelas?.[String(p)] ?? ''}
                            onChange={e => editarTaxa(bandeiraEditando, p, e.target.value)}
                            disabled={p === 1 && safra.avista_sem_acrescimo}
                            inputMode="decimal" placeholder="0,00"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50 disabled:text-slate-400"/>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-xs font-semibold text-slate-600 mb-1.5">
                        Simulação para R$ 1.000,00 que a clínica quer receber — {NOME_BANDEIRA[bandeiraEditando]}
                      </p>
                      <table className="w-full text-xs text-slate-600">
                        <thead><tr className="text-slate-400"><th className="text-left font-medium">Parcelas</th><th className="text-right font-medium">Taxa efetiva</th><th className="text-right font-medium">Paciente paga</th><th className="text-right font-medium">Por parcela</th></tr></thead>
                        <tbody>
                          {simulacao.map(o => (
                            <tr key={o.parcelas}>
                              <td className="py-0.5">{o.parcelas}x</td>
                              <td className="text-right">{o.taxa ? o.taxa.toFixed(2).replace('.', ',') + '%' : '—'}</td>
                              <td className="text-right font-semibold text-slate-700">{brl(o.totalCentavos)}</td>
                              <td className="text-right">{brl(o.parcelaCentavos)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelClass}>Explicação enviada com a cobrança</label>
                  <textarea value={safra.texto_parcelamento ?? ''} rows={3} maxLength={300}
                    onChange={e => campoSafra('texto_parcelamento', e.target.value)}
                    className={inputClass + ' resize-none leading-5'}/>
                  <p className="mt-1 text-xs text-slate-400">
                    Vai na mesma mensagem da cobrança, logo depois do link — e só quando há acréscimo. Em cobrança
                    à vista ou sem repasse de taxa o texto não é enviado, porque seria mentira. Deixe em branco
                    para não enviar nunca.
                  </p>
                </div>

                <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <p className="text-xs font-semibold text-slate-600 mb-1">Endereço para avisos de pagamento (webhook)</p>
                  <p className="text-[11px] text-slate-700 break-all font-mono">https://crm.obesityhealth.com.br/api/safrapay/webhook</p>
                  <p className="mt-1 text-xs text-slate-400">Cadastre no portal Safrapay para a baixa acontecer sozinha.</p>
                </div>
              </div>
              )}

              {/* -------------------------------------------- DESCRIÇÕES PRONTAS */}
              <div className={cardClass}>
                <p className="text-sm font-semibold text-slate-700">Descrições prontas</p>
                <p className="text-xs text-slate-400 -mt-2">
                  Aparecem como atalho na janela de cobrança, no PIX e no cartão. O parcelamento ao lado é
                  a sugestão que aparece pronta ao escolher — a equipe ainda pode mudar na hora.
                </p>
                <div className="space-y-2">
                  {cfg.descricoes.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={d.texto} onChange={e => editarDescricao(i, { texto: e.target.value })} maxLength={40}
                        placeholder="Ex.: Consulta presencial" className={inputClass}/>
                      <select value={d.parcelas} onChange={e => editarDescricao(i, { parcelas: Number(e.target.value) })}
                        className="px-2 py-2 border border-slate-200 rounded-lg text-sm flex-shrink-0">
                        {Array.from({ length: 12 }, (_, k) => k + 1).map(p => <option key={p} value={p}>{p}x</option>)}
                      </select>
                      <button onClick={() => removerDescricao(i)} title="Remover"
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg flex-shrink-0"><Trash2 size={15}/></button>
                    </div>
                  ))}
                </div>
                <button onClick={novaDescricao}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-600 hover:bg-brand-50 rounded-lg">
                  <Plus size={13}/> Adicionar descrição
                </button>
              </div>

              {erro && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle size={14}/>{erro}
                </div>
              )}

              <button onClick={salvar} disabled={salvando}
                className="flex items-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg disabled:opacity-50">
                {salvando ? <Loader2 size={15} className="animate-spin"/> : salvo ? <Check size={15}/> : <Save size={15}/>}
                {salvo ? 'Salvo!' : 'Salvar'}
              </button>
            </div>
          )}

          <p className="mt-4 text-xs text-slate-400">
            Antes de usar com paciente: salve, gere uma cobrança de R$ 1,00 para você mesmo — no PIX e no cartão —
            e confira no app do banco se o nome e o valor aparecem corretos.
          </p>
        </div>
      </main>
    </div>
  )
}
