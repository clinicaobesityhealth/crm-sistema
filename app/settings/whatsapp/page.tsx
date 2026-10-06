'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/components/Sidebar'
import { Smartphone, Loader2, RefreshCw, CheckCircle2, XCircle, QrCode, Power, Settings2, Save, Wrench } from 'lucide-react'
import clsx from 'clsx'

type EvoConfig = { url: string; key: string; instance: string; settingsId: string | null }
type WahaConfig = { url: string; key: string; instance: string }

// v46.94 — migração de provedor: WAHA passou a ser o principal (é o que a
// clínica usa de verdade agora). A Evolution NÃO foi apagada — todo o código
// dela continua aqui do jeito que estava, só que a seção fica desligada
// (SHOW_EVOLUTION_SECTION = false) e não aparece mais em lugar nenhum da tela.
// Pra voltar a mostrar a Evolution um dia, é só trocar isso pra true.
//
// v47.01 — religada. Hoje o arranjo é híbrido: o RECEBIMENTO das mensagens dos
// pacientes ainda entra pela Evolution (instância "recados"), e o ENVIO, a edição
// e a foto de perfil já vão pelo WAHA. Como a Evolution segue sendo peça viva do
// caminho crítico, a seção precisa ficar à mão para reconectar rápido se a sessão
// dela cair — sem depender de um novo deploy só para isso.
// v47.06 — Evolution escondido a pedido do Jorge: desde 08/09 todo o WhatsApp
// (envio e recebimento) roda no WAHA, e a seção do Evolution só confundia quem
// abre a tela. Escondido, não removido: se um dia precisar voltar, é trocar
// para true aqui. A instância continua conectada no servidor, só com o webhook
// desligado.
const SHOW_EVOLUTION_SECTION = false

export default function WhatsAppPage() {
  const [config, setConfig] = useState<EvoConfig>({ url: '', key: '', instance: '', settingsId: null })
  const [configLoaded, setConfigLoaded] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)


  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'connecting' | 'error'>('loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // --- WAHA (v47.01: já é o canal REAL de envio, edição e foto de perfil — os fluxos do
  //     n8n apontam para cá. O recebimento das mensagens ainda entra pela Evolution) ---
  const [wahaConfig, setWahaConfig] = useState<WahaConfig>({ url: '', key: '', instance: '' })
  const [showWahaConfig, setShowWahaConfig] = useState(false)
  const [savingWahaConfig, setSavingWahaConfig] = useState(false)
  const [wahaStatus, setWahaStatus] = useState<'idle' | 'loading' | 'connected' | 'disconnected' | 'connecting' | 'passkey_required' | 'error' | 'failed'>('idle')
  const [restartingWaha, setRestartingWaha] = useState(false)
  const [wahaQrCode, setWahaQrCode] = useState<string | null>(null)
  const [wahaLoading, setWahaLoading] = useState(false)
  const [wahaError, setWahaError] = useState('')
  const wahaPollRef = useRef<NodeJS.Timeout | null>(null)

  // --- WAHA: fluxo de passkey (extensão do Chrome) — alguns números exigem verificação
  // por passkey (WebAuthn) ao invés de (ou além de) escanear o QR. Nesse caso a WAHA pede
  // que o usuário tenha a extensão oficial da WAHA instalada no Chrome, que assina o
  // desafio no domínio web.whatsapp.com (o CRM não consegue fazer isso sozinho, por
  // restrição de origem do WebAuthn).
  const WAHA_CHROME_EXTENSION_ID = 'ghpdcgnjffaaekflfpcgkgpbafmjldcp'
  const WAHA_CHROME_EXTENSION_URL = `https://chromewebstore.google.com/detail/${WAHA_CHROME_EXTENSION_ID}`
  const [wahaExtensionDetected, setWahaExtensionDetected] = useState<'checking' | 'found' | 'not_found'>('checking')
  const [wahaPasskeyLoading, setWahaPasskeyLoading] = useState(false)
  const [wahaPasskeyError, setWahaPasskeyError] = useState('')
  const [wahaConfirmationCode, setWahaConfirmationCode] = useState<string | null>(null)

  useEffect(() => {
    loadConfig()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (wahaPollRef.current) clearInterval(wahaPollRef.current)
    }
  }, [])

  async function loadConfig() {
    const { data } = await supabase.from('clinic_settings')
      .select('id, evolution_url, evolution_key, evolution_instance, waha_url, waha_key, waha_instance').limit(1)
    const s = data?.[0]
    if (s) {
      const cfg = {
        url: s.evolution_url || '',
        key: s.evolution_key || '',
        instance: s.evolution_instance || '',
        settingsId: s.id,
      }
      setConfig(cfg)
      const loadedWahaCfg = {
        url: s.waha_url || '',
        key: s.waha_key || '',
        instance: s.waha_instance || 'obesitycrm',
      }
      setWahaConfig(loadedWahaCfg)
      // Sem isso, o status da WAHA ficava "idle" (aparência idêntica a
      // "desconectada" na tela) toda vez que a página remontava — mesmo com a
      // instância conectada de verdade na WAHA — porque nada aqui chamava
      // checkWahaStatus ao carregar. Só era atualizado se o usuário clicasse
      // manualmente em "Atualizar status WAHA".
      if (loadedWahaCfg.url && loadedWahaCfg.key && loadedWahaCfg.instance) {
        checkWahaStatus(loadedWahaCfg)
      }
      setConfigLoaded(true)
      if (cfg.url && cfg.key && cfg.instance) {
        checkStatus(cfg)
      } else {
        setStatus('disconnected')
        setShowConfig(true)
      }
    } else {
      setWahaConfig(c => ({ ...c, instance: c.instance || 'obesitycrm' }))
      setConfigLoaded(true)
      setStatus('disconnected')
      setShowConfig(true)
    }
  }

  async function saveConfig() {
    if (!config.url || !config.key || !config.instance) { setError('Preencha todos os campos'); return }
    setSavingConfig(true)
    setError('')
    // Remove barra final da URL
    const cleanUrl = config.url.replace(/\/+$/, '')
    let query = supabase.from('clinic_settings').update({
      evolution_url: cleanUrl,
      evolution_key: config.key.trim(),
      evolution_instance: config.instance.trim(),
    })
    if (config.settingsId) query = query.eq('id', config.settingsId)
    else query = query.not('id', 'is', null)
    const { error: err } = await query
    if (err) { setError('Erro ao salvar: ' + err.message); setSavingConfig(false); return }
    setConfig(c => ({ ...c, url: cleanUrl }))
    setSavingConfig(false)
    setShowConfig(false)
    checkStatus({ ...config, url: cleanUrl })
  }

  async function checkStatus(cfg: EvoConfig = config) {
    if (!cfg.url || !cfg.key || !cfg.instance) { setStatus('disconnected'); return }
    try {
      const res = await fetch(`${cfg.url}/instance/connectionState/${cfg.instance}`, {
        headers: { 'apikey': cfg.key }
      })
      const data = await res.json()
      const state = data?.instance?.state || data?.state
      if (state === 'open') {
        setStatus('connected'); setQrCode(null)
        if (pollRef.current) clearInterval(pollRef.current)
      } else if (state === 'connecting') {
        setStatus('connecting')
      } else {
        setStatus('disconnected')
      }
    } catch (e) {
      setStatus('error'); setError('Não foi possível conectar à Evolution API. Verifique a URL e a chave.')
    }
  }

  async function generateQR() {
    setLoading(true); setError(''); setQrCode(null)
    try {
      const res = await fetch(`${config.url}/instance/connect/${config.instance}`, {
        headers: { 'apikey': config.key }
      })
      const data = await res.json()
      const qr = data?.base64 || data?.qrcode?.base64 || data?.code
      if (qr) {
        setQrCode(qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`)
        setStatus('connecting')
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = setInterval(() => checkStatus(), 3000)
      } else {
        setError('QR Code não retornado. Talvez já esteja conectado.')
        checkStatus()
      }
    } catch (e) {
      setError('Erro ao gerar QR Code. Verifique a configuração.')
    }
    setLoading(false)
  }

  async function disconnect() {
    if (!confirm('Desconectar o WhatsApp? Será necessário escanear o QR novamente.')) return
    setLoading(true)
    try {
      await fetch(`${config.url}/instance/logout/${config.instance}`, {
        method: 'DELETE', headers: { 'apikey': config.key }
      })
      setStatus('disconnected'); setQrCode(null)
    } catch (e) { setError('Erro ao desconectar') }
    setLoading(false)
  }

  // --- WAHA: preparação para uma futura migração. Estas ações só afetam a instância WAHA
  // configurada aqui (ex: "obesitycrm") — não têm nenhum efeito sobre o WhatsApp da Evolution
  // usado hoje em produção. Os fluxos do n8n continuam apontando para a Evolution até serem
  // atualizados manualmente no dia da migração. ---

  // ACHADO (debug ao vivo): POST /api/sessions/{instance}/start só funciona pra uma
  // sessão que JÁ existe na WAHA — numa sessão nova ele retorna 404 "Session not
  // found" (confirmado testando direto contra a API), então nunca criava nada
  // sozinho. Quem realmente cria a sessão é POST /api/sessions com { name, start }
  // no corpo (confirmado: retorna 201 e a sessão passa a existir de verdade).
  // Esta função tenta criar primeiro; se a sessão já existir (ou qualquer outro
  // motivo fizer o create falhar), cai pro /start de qualquer forma — cobre os
  // dois casos (primeira vez e reconfiguração de uma sessão que já existe).
  // ACHADO (debug ao vivo, 2ª rodada): logo após criada, a sessão às vezes cai
  // sozinha em status "FAILED" (engine gows não conecta de primeira — comum
  // neste tipo de sessão WhatsApp) e o QR Code não é gerado nesse estado.
  // POST /api/sessions/{instance}/restart resolve — confirmado ao vivo: FAILED
  // → STARTING → SCAN_QR_CODE em poucos segundos, e o QR passa a vir normal.
  async function reiniciarSessaoWaha(cfg: WahaConfig) {
    await fetch(`${cfg.url}/api/sessions/${cfg.instance}/restart`, {
      method: 'POST', headers: { 'X-Api-Key': cfg.key }
    })
  }

  async function garantirSessaoWaha(cfg: WahaConfig) {
    const createRes = await fetch(`${cfg.url}/api/sessions`, {
      method: 'POST',
      headers: { 'X-Api-Key': cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: cfg.instance, start: true }),
    })
    if (!createRes.ok) {
      // Provavelmente já existe (ou outro motivo) — tenta iniciar a que já existe.
      await fetch(`${cfg.url}/api/sessions/${cfg.instance}/start`, {
        method: 'POST', headers: { 'X-Api-Key': cfg.key }
      })
    }
    // Se caiu em FAILED (seja na criação agora ou de uma tentativa anterior),
    // reinicia e dá um respiro pro engine subir antes de seguir.
    try {
      const statusRes = await fetch(`${cfg.url}/api/sessions/${cfg.instance}`, {
        headers: { 'X-Api-Key': cfg.key }
      })
      const statusData = await statusRes.json()
      if (statusData?.status === 'FAILED') {
        await reiniciarSessaoWaha(cfg)
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    } catch { /* não crítico — segue o fluxo normal */ }
  }

  async function saveWahaConfig() {
    if (!wahaConfig.url || !wahaConfig.key || !wahaConfig.instance) { setWahaError('Preencha todos os campos'); return }
    setSavingWahaConfig(true)
    setWahaError('')
    // Tudo dentro de um try/catch/finally: qualquer erro (inclusive um erro
    // síncrono ao montar a query, ou de rede) precisa aparecer pro usuário e
    // liberar o botão — antes disso, uma falha aqui podia deixar o clique sem
    // nenhum efeito visível (nem erro, nem gravação) e sem pista do motivo.
    try {
      const cleanUrl = wahaConfig.url.replace(/\/+$/, '')
      let query = supabase.from('clinic_settings').update({
        waha_url: cleanUrl,
        waha_key: wahaConfig.key.trim(),
        waha_instance: wahaConfig.instance.trim(),
      })
      if (config.settingsId) query = query.eq('id', config.settingsId)
      else query = query.not('id', 'is', null)
      const { error: err } = await query
      if (err) { setWahaError('Erro ao salvar: ' + err.message); return }
      setWahaConfig(c => ({ ...c, url: cleanUrl }))
      const savedCfg = { ...wahaConfig, url: cleanUrl }
      // Salvar a configuração só grava a URL/chave/nome no banco — isso não cria a
      // instância na WAHA sozinho. Sem isso, a instância só existia se alguém
      // criasse manualmente pelo painel da WAHA.
      try {
        await garantirSessaoWaha(savedCfg)
      } catch (startErr: any) {
        console.error('[WAHA] falha ao criar/iniciar sessão após salvar:', startErr)
        // não bloqueia — checkWahaStatus abaixo ainda reporta o status real
      }
      checkWahaStatus(savedCfg)
    } catch (e: any) {
      console.error('[WAHA] erro ao salvar configuração:', e)
      setWahaError('Erro ao salvar: ' + (e?.message || 'falha inesperada — veja o console'))
    } finally {
      setSavingWahaConfig(false)
    }
  }

  async function checkWahaStatus(cfg: WahaConfig = wahaConfig) {
    if (!cfg.url || !cfg.key || !cfg.instance) { setWahaStatus('disconnected'); return }
    try {
      const res = await fetch(`${cfg.url}/api/sessions/${cfg.instance}`, {
        headers: { 'X-Api-Key': cfg.key }
      })
      const data = await res.json()
      const st = data?.status
      if (st === 'WORKING') {
        setWahaStatus('connected'); setWahaQrCode(null)
        if (wahaPollRef.current) clearInterval(wahaPollRef.current)
      } else if (st === 'PASSKEY_REQUIRED' || st === 'PASSKEY_CONFIRMATION_REQUIRED') {
        setWahaStatus('passkey_required')
        detectWahaExtension()
        if (st === 'PASSKEY_CONFIRMATION_REQUIRED') fetchWahaConfirmationCode(cfg)
      } else if (st === 'SCAN_QR_CODE' || st === 'STARTING') {
        setWahaStatus('connecting')
      } else if (st === 'FAILED') {
        // Estado observado logo após a criação da sessão (o engine às vezes não
        // conecta de primeira) — "Reiniciar instância" na tela resolve.
        setWahaStatus('failed')
        if (wahaPollRef.current) clearInterval(wahaPollRef.current)
      } else {
        setWahaStatus('disconnected')
      }
    } catch (e) {
      setWahaStatus('error'); setWahaError('Não foi possível conectar à instância WAHA. Verifique a URL e a chave.')
    }
  }

  async function handleReiniciarWaha() {
    setRestartingWaha(true)
    try {
      await reiniciarSessaoWaha(wahaConfig)
      await new Promise(resolve => setTimeout(resolve, 1500))
      await checkWahaStatus()
    } catch (e: any) {
      console.error('[WAHA] falha ao reiniciar sessão:', e)
      setWahaError('Não foi possível reiniciar a instância — veja o console.')
      setWahaStatus('error')
    } finally {
      setRestartingWaha(false)
    }
  }

  // Detecta se a extensão da WAHA está instalada e ativa no Chrome, enviando um "ping"
  // e aguardando a resposta. Se não responder em ~300ms, consideramos não instalada.
  function detectWahaExtension() {
    setWahaExtensionDetected('checking')
    const requestId = 'waha-ping-' + Date.now()
    function onMessage(event: MessageEvent) {
      if (event.data?.source === 'waha-passkey-extension' && event.data?.requestId === requestId) {
        setWahaExtensionDetected('found')
        window.removeEventListener('message', onMessage)
      }
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ source: 'waha-passkey-page', requestId, type: 'waha-passkey-ping' }, window.location.origin)
    setTimeout(() => {
      window.removeEventListener('message', onMessage)
      setWahaExtensionDetected(prev => (prev === 'checking' ? 'not_found' : prev))
    }, 400)
  }

  // Busca o código de confirmação de 4 dígitos que o WhatsApp às vezes pede
  // depois da assinatura do passkey (estado PASSKEY_CONFIRMATION_REQUIRED).
  async function fetchWahaConfirmationCode(cfg: WahaConfig = wahaConfig) {
    try {
      const res = await fetch(`${cfg.url}/api/${cfg.instance}/auth/passkey/confirmation`, {
        headers: { 'X-Api-Key': cfg.key }
      })
      const data = await res.json()
      setWahaConfirmationCode(data?.code ?? data?.confirmationCode ?? null)
    } catch (e) { /* silencioso — não é crítico */ }
  }

  // Fluxo completo de login por passkey: busca o desafio na WAHA, pede pra extensão
  // assinar (a extensão abre web.whatsapp.com e obtém o consentimento do usuário),
  // e envia a assinatura de volta pra WAHA.
  async function startWahaPasskeyLogin() {
    setWahaPasskeyLoading(true); setWahaPasskeyError('')
    try {
      const challengeRes = await fetch(`${wahaConfig.url}/api/${wahaConfig.instance}/auth/passkey/challenge`, {
        headers: { 'X-Api-Key': wahaConfig.key }
      })
      const challengeData = await challengeRes.json()
      const challenge = challengeData?.challenge ?? challengeData
      const requestId = 'waha-sign-' + Date.now()

      const assertion = await new Promise<any>((resolve, reject) => {
        function onMessage(event: MessageEvent) {
          if (event.data?.source === 'waha-passkey-extension' && event.data?.requestId === requestId) {
            window.removeEventListener('message', onMessage)
            if (event.data?.error) reject(new Error(event.data.error))
            else resolve(event.data?.assertion ?? event.data)
          }
        }
        window.addEventListener('message', onMessage)
        window.postMessage({ source: 'waha-passkey-page', requestId, type: 'waha-passkey-sign', challenge }, window.location.origin)
        setTimeout(() => { window.removeEventListener('message', onMessage); reject(new Error('timeout')) }, 60000)
      })

      await fetch(`${wahaConfig.url}/api/${wahaConfig.instance}/auth/passkey`, {
        method: 'POST',
        headers: { 'X-Api-Key': wahaConfig.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      })
      checkWahaStatus()
    } catch (e: any) {
      setWahaPasskeyError(e?.message === 'timeout'
        ? 'A extensão não respondeu a tempo. Confirme que ela está instalada/ativa e tente de novo.'
        : 'Erro ao concluir o login por passkey.')
    }
    setWahaPasskeyLoading(false)
  }

  async function generateWahaQR() {
    setWahaLoading(true); setWahaError(''); setWahaQrCode(null)
    try {
      // Garante que a sessão existe e está iniciada antes de pedir o QR (ver
      // garantirSessaoWaha — /start sozinho 404 numa sessão que nunca foi criada)
      await garantirSessaoWaha(wahaConfig)
      const res = await fetch(`${wahaConfig.url}/api/${wahaConfig.instance}/auth/qr`, {
        headers: { 'X-Api-Key': wahaConfig.key, 'Accept': 'application/json' }
      })
      const data = await res.json()
      const qr = data?.data
      if (qr) {
        setWahaQrCode(qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`)
        setWahaStatus('connecting')
        if (wahaPollRef.current) clearInterval(wahaPollRef.current)
        wahaPollRef.current = setInterval(() => checkWahaStatus(), 3000)
      } else {
        setWahaError('QR Code não retornado. Talvez já esteja conectado.')
        checkWahaStatus()
      }
    } catch (e) {
      setWahaError('Erro ao gerar QR Code. Verifique a configuração.')
    }
    setWahaLoading(false)
  }

  async function disconnectWaha() {
    if (!confirm('Desconectar a instância WAHA de preparação? Será necessário escanear o QR novamente.')) return
    setWahaLoading(true)
    try {
      await fetch(`${wahaConfig.url}/api/sessions/${wahaConfig.instance}/logout`, {
        method: 'POST', headers: { 'X-Api-Key': wahaConfig.key }
      })
      setWahaStatus('disconnected'); setWahaQrCode(null)
    } catch (e) { setWahaError('Erro ao desconectar') }
    setWahaLoading(false)
  }

  if (!configLoaded) {
    return (
      <div className="flex h-screen bg-surface overflow-hidden">
        <Sidebar/>
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 size={16} className="animate-spin mr-2"/>Carregando...
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Conexão WhatsApp</h1>
            <p className="text-xs text-slate-400 mt-0.5">Conecte o número da clínica escaneando o QR Code</p>
          </div>
          <button onClick={() => setShowWahaConfig(v => !v)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            <Settings2 size={15}/> Configurar API
          </button>
        </div>

        <div className="max-w-md px-6 py-8">
          {/* v47.06 — a "Localização da clínica" saiu daqui e foi para Configurações →
              Feriados, que é onde o dado é realmente usado (os feriados municipais
              que bloqueiam horários na agenda). Aqui ela só confundia. */}
          {/* Config da WAHA — v46.94: WAHA passou a ser o provedor principal */}
          {showWahaConfig && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Configuração da API (WAHA)</p>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">URL da API</label>
                <input value={wahaConfig.url} onChange={e => setWahaConfig(c => ({ ...c, url: e.target.value }))}
                  placeholder="https://sua-waha.com"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">API Key (X-Api-Key)</label>
                <input value={wahaConfig.key} onChange={e => setWahaConfig(c => ({ ...c, key: e.target.value }))}
                  placeholder="chave da instância"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Nome da instância (session)</label>
                <input value={wahaConfig.instance} onChange={e => setWahaConfig(c => ({ ...c, instance: e.target.value }))}
                  placeholder="obesitycrm"
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
              </div>
              <button onClick={saveWahaConfig} disabled={savingWahaConfig}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                {savingWahaConfig ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                Salvar configuração
              </button>
              <p className="text-xs text-slate-400">
                Nota: os fluxos do n8n (envio/recebimento) também precisam apontar para esta instância.
              </p>
            </div>
          )}

          {/* Status da WAHA */}
          <div className={clsx('rounded-xl border p-4 mb-6 flex items-center gap-3',
            wahaStatus === 'connected' ? 'bg-emerald-50 border-emerald-200' :
            wahaStatus === 'error' || wahaStatus === 'failed' ? 'bg-red-50 border-red-200' :
            wahaStatus === 'connecting' || wahaStatus === 'passkey_required' ? 'bg-amber-50 border-amber-200' :
            'bg-slate-50 border-slate-200')}>
            {wahaStatus === 'loading' ? <Loader2 size={20} className="animate-spin text-slate-400"/> :
             wahaStatus === 'connected' ? <CheckCircle2 size={20} className="text-emerald-600"/> :
             wahaStatus === 'error' || wahaStatus === 'failed' ? <XCircle size={20} className="text-red-600"/> :
             wahaStatus === 'passkey_required' ? <Smartphone size={20} className="text-amber-600"/> :
             wahaStatus === 'connecting' ? <Loader2 size={20} className="animate-spin text-amber-600"/> :
             <Smartphone size={20} className="text-slate-400"/>}
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {wahaStatus === 'loading' ? 'Verificando...' :
                 wahaStatus === 'connected' ? 'WhatsApp conectado' :
                 wahaStatus === 'error' ? 'Erro de conexão' :
                 wahaStatus === 'failed' ? 'Instância falhou ao iniciar' :
                 wahaStatus === 'passkey_required' ? 'Verificação por passkey necessária' :
                 wahaStatus === 'connecting' ? 'Aguardando leitura do QR...' :
                 'WhatsApp desconectado'}
              </p>
              <p className="text-xs text-slate-500">
                {wahaStatus === 'connected' ? 'A clínica está recebendo e enviando mensagens' :
                 wahaStatus === 'connecting' ? 'Escaneie o código abaixo no WhatsApp' :
                 wahaStatus === 'failed' ? 'Acontece às vezes logo após criar a instância — clique em "Reiniciar instância" abaixo.' :
                 wahaStatus === 'disconnected' ? 'Configure a API e gere o QR Code' :
                 wahaStatus === 'error' ? wahaError : 'Instância: ' + wahaConfig.instance}
              </p>
            </div>
          </div>

          {wahaError && wahaStatus !== 'error' && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{wahaError}</div>
          )}

          {wahaStatus === 'failed' && (
            <button onClick={handleReiniciarWaha} disabled={restartingWaha}
              className="w-full py-2.5 mb-4 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
              {restartingWaha ? <Loader2 size={14} className="animate-spin"/> : <RefreshCw size={14}/>}
              Reiniciar instância
            </button>
          )}

          {wahaStatus === 'passkey_required' && (
            <div className="bg-white border-2 border-amber-200 rounded-2xl p-5 mb-6">
              <p className="text-sm font-semibold text-slate-800 mb-1">Esse número pede verificação extra (passkey)</p>
              <p className="text-xs text-slate-500 mb-4">
                Alguns números exigem essa verificação do WhatsApp em vez do QR simples. Ela só funciona com a
                extensão oficial da WAHA instalada no Chrome (é ela quem confirma sua identidade em web.whatsapp.com).
              </p>

              {wahaExtensionDetected === 'checking' && (
                <p className="text-xs text-slate-400 flex items-center gap-2 mb-3"><Loader2 size={12} className="animate-spin"/> Verificando se a extensão está instalada...</p>
              )}

              {wahaExtensionDetected === 'not_found' && (
                <div className="mb-3">
                  <a href={WAHA_CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer"
                    className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                    Baixar extensão WAHA para o Chrome
                  </a>
                  <button onClick={detectWahaExtension}
                    className="w-full mt-2 py-2 text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1">
                    <RefreshCw size={12}/> Já instalei — verificar de novo
                  </button>
                </div>
              )}

              {wahaExtensionDetected === 'found' && (
                <button onClick={startWahaPasskeyLogin} disabled={wahaPasskeyLoading}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                  {wahaPasskeyLoading ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                  Extensão encontrada — fazer login
                </button>
              )}

              {wahaConfirmationCode && (
                <div className="mt-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-center">
                  <p className="text-xs text-slate-500">Confirme este código no WhatsApp do celular:</p>
                  <p className="text-lg font-bold tracking-widest text-amber-700">{wahaConfirmationCode}</p>
                </div>
              )}

              {wahaPasskeyError && (
                <div className="mt-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{wahaPasskeyError}</div>
              )}
            </div>
          )}

          {/* QR Code */}
          {wahaQrCode && wahaStatus === 'connecting' && (
            <div className="bg-white border-2 border-slate-100 rounded-2xl p-6 mb-6 flex flex-col items-center">
              <img src={wahaQrCode} alt="QR Code WhatsApp" className="w-64 h-64 object-contain"/>
              <p className="text-xs text-slate-500 mt-4 text-center">
                No celular da clínica: WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong> → aponte para este código
              </p>
            </div>
          )}

          {/* Ações */}
          <div className="space-y-2">
            {wahaStatus === 'connected' ? (
              <button onClick={disconnectWaha} disabled={wahaLoading}
                className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                {wahaLoading ? <Loader2 size={14} className="animate-spin"/> : <Power size={14}/>}
                Desconectar WhatsApp
              </button>
            ) : (
              <button onClick={generateWahaQR} disabled={wahaLoading || !wahaConfig.url || !wahaConfig.instance}
                className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                {wahaLoading ? <Loader2 size={14} className="animate-spin"/> : <QrCode size={14}/>}
                {wahaQrCode ? 'Gerar novo QR Code' : 'Gerar QR Code'}
              </button>
            )}
            <button onClick={() => checkWahaStatus()} disabled={wahaLoading}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg flex items-center justify-center gap-2">
              <RefreshCw size={14}/> Atualizar status
            </button>
          </div>

          {/* Evolution — v46.94: não é mais o provedor usado, código mantido
              intacto (nada apagado) mas a seção fica desligada por padrão.
              Pra reativar a exibição um dia, troque SHOW_EVOLUTION_SECTION
              pra true no topo do arquivo. */}
          {SHOW_EVOLUTION_SECTION && (
            <div className="mt-10 pt-6 border-t border-dashed border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Wrench size={15} className="text-slate-400"/>
                  <p className="text-sm font-semibold text-slate-700">Evolution <span className="font-normal text-slate-400">(desativado)</span></p>
                </div>
                <button onClick={() => setShowConfig(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
                  <Settings2 size={13}/> Configurar
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Provedor antigo, mantido aqui só de referência — não é mais usado pra enviar/receber nada.
              </p>

              {showConfig && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-700">Configuração da Evolution API</p>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">URL da API</label>
                    <input value={config.url} onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
                      placeholder="https://sua-evolution.com"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">API Key</label>
                    <input value={config.key} onChange={e => setConfig(c => ({ ...c, key: e.target.value }))}
                      placeholder="chave da instância"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Nome da instância</label>
                    <input value={config.instance} onChange={e => setConfig(c => ({ ...c, instance: e.target.value }))}
                      placeholder="ex: clinica-x"
                      className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"/>
                  </div>
                  <button onClick={saveConfig} disabled={savingConfig}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                    {savingConfig ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                    Salvar configuração
                  </button>
                </div>
              )}

              <div className={clsx('rounded-xl border p-4 mb-4 flex items-center gap-3',
                status === 'connected' ? 'bg-emerald-50 border-emerald-200' :
                status === 'error' ? 'bg-red-50 border-red-200' :
                status === 'connecting' ? 'bg-amber-50 border-amber-200' :
                'bg-slate-50 border-slate-200')}>
                {status === 'loading' ? <Loader2 size={18} className="animate-spin text-slate-400"/> :
                 status === 'connected' ? <CheckCircle2 size={18} className="text-emerald-600"/> :
                 status === 'error' ? <XCircle size={18} className="text-red-600"/> :
                 status === 'connecting' ? <Loader2 size={18} className="animate-spin text-amber-600"/> :
                 <Smartphone size={18} className="text-slate-400"/>}
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {status === 'loading' ? 'Verificando...' :
                     status === 'connected' ? 'WhatsApp conectado' :
                     status === 'error' ? 'Erro de conexão' :
                     status === 'connecting' ? 'Aguardando leitura do QR...' :
                     'WhatsApp desconectado'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {status === 'connected' ? 'A clínica está recebendo e enviando mensagens' :
                     status === 'connecting' ? 'Escaneie o código abaixo no WhatsApp' :
                     status === 'disconnected' ? 'Configure a API e gere o QR Code' :
                     status === 'error' ? error : 'Instância: ' + config.instance}
                  </p>
                </div>
              </div>

              {error && status !== 'error' && (
                <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
              )}

              {qrCode && status === 'connecting' && (
                <div className="bg-white border-2 border-slate-100 rounded-2xl p-6 mb-4 flex flex-col items-center">
                  <img src={qrCode} alt="QR Code WhatsApp" className="w-64 h-64 object-contain"/>
                  <p className="text-xs text-slate-500 mt-4 text-center">
                    No celular da clínica: WhatsApp → <strong>Aparelhos conectados</strong> → <strong>Conectar aparelho</strong> → aponte para este código
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {status === 'connected' ? (
                  <button onClick={disconnect} disabled={loading}
                    className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                    {loading ? <Loader2 size={14} className="animate-spin"/> : <Power size={14}/>}
                    Desconectar WhatsApp
                  </button>
                ) : (
                  <button onClick={generateQR} disabled={loading || !config.url || !config.instance}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
                    {loading ? <Loader2 size={14} className="animate-spin"/> : <QrCode size={14}/>}
                    {qrCode ? 'Gerar novo QR Code' : 'Gerar QR Code'}
                  </button>
                )}
                <button onClick={() => checkStatus()} disabled={loading}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-lg flex items-center justify-center gap-2">
                  <RefreshCw size={14}/> Atualizar status
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
