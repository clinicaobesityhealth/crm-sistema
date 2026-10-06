'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/AuthContext'
import Sidebar from '@/components/Sidebar'
import PhotoCapture from '@/components/PhotoCapture'
import { Save, Loader2, CheckCircle2, Palette, MessageSquare, Building2 } from 'lucide-react'

const CLINIC_ID = '00000000-0000-0000-0000-000000000001'

const PALETTE = [
  '#0c8ee7','#0058a0','#06b6d4','#10b981','#8b5cf6',
  '#ef4444','#f97316','#f59e0b','#ec4899','#1f2937',
]

type BubbleConfig = {
  label: string
  bgKey: string
  colorKey: string
  defaultBg: string
  defaultColor: string
  preview: string
}

const BUBBLES: BubbleConfig[] = [
  { label: 'Mensagem enviada', bgKey: 'bubble_out_bg', colorKey: 'bubble_out_color', defaultBg: '#dcfce7', defaultColor: '#14532d', preview: 'Olá, como posso ajudar?' },
  { label: 'Mensagem recebida', bgKey: 'bubble_in_bg', colorKey: 'bubble_in_color', defaultBg: '#ffffff', defaultColor: '#0f172a', preview: 'Boa tarde! Quero agendar.' },
  { label: 'Mensagem privada', bgKey: 'bubble_private_bg', colorKey: 'bubble_private_color', defaultBg: '#fff7ed', defaultColor: '#7c2d12', preview: '🔒 Nota interna da equipe' },
]

export default function AppearancePage() {
  const { refreshBranding } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [primaryColor, setPrimaryColor] = useState('#0c8ee7')
  const [clinicName, setClinicName] = useState('Obesity Health')
  const [bubbles, setBubbles] = useState<Record<string, string>>({
    bubble_out_bg: '#dcfce7', bubble_out_color: '#14532d',
    bubble_in_bg: '#ffffff', bubble_in_color: '#0f172a',
    bubble_private_bg: '#fff7ed', bubble_private_color: '#7c2d12',
  })

  useEffect(() => {
    supabase.from('clinic_branding').select('*').eq('clinic_id', CLINIC_ID).single()
      .then(({ data }) => {
        if (!data) return
        setLogoUrl(data.logo_url)
        setPrimaryColor(data.primary_color || '#0c8ee7')
        setClinicName(data.clinic_name || 'Obesity Health')
        setBubbles({
          bubble_out_bg: data.bubble_out_bg || '#dcfce7',
          bubble_out_color: data.bubble_out_color || '#14532d',
          bubble_in_bg: data.bubble_in_bg || '#ffffff',
          bubble_in_color: data.bubble_in_color || '#0f172a',
          bubble_private_bg: data.bubble_private_bg || '#fff7ed',
          bubble_private_color: data.bubble_private_color || '#7c2d12',
        })
      })
  }, [])

  async function handleSave() {
    setSaving(true)
    const payload = {
      primary_color: primaryColor,
      logo_url: logoUrl,
      clinic_name: clinicName,
      ...bubbles,
      updated_at: new Date().toISOString(),
    }
    const { data: existing } = await supabase.from('clinic_branding').select('id').eq('clinic_id', CLINIC_ID).single()
    if (existing) {
      await supabase.from('clinic_branding').update(payload).eq('clinic_id', CLINIC_ID)
    } else {
      await supabase.from('clinic_branding').insert({ ...payload, clinic_id: CLINIC_ID })
    }
    await refreshBranding()
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar/>
      <div className="flex-1 overflow-y-auto">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Aparência</h1>
            <p className="text-xs text-slate-400 mt-0.5">Identidade visual e cores do sistema</p>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin"/> : saved ? <CheckCircle2 size={14}/> : <Save size={14}/>}
            {saved ? 'Salvo!' : 'Salvar'}
          </button>
        </div>

        <div className="max-w-2xl px-6 py-8 space-y-8">

          {/* Nome da clínica */}
          <section className="bg-white border border-slate-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Building2 size={16} className="text-brand-500"/>
              <h2 className="text-sm font-semibold text-slate-800">Nome da clínica</h2>
            </div>
            <input
              value={clinicName}
              onChange={e => setClinicName(e.target.value)}
              placeholder="Ex: Obesity Health"
              className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 mt-2">Aparece na aba do navegador, tela de login e títulos do sistema.</p>
          </section>

          {/* Logo */}
          <section className="bg-white border border-slate-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Palette size={16} className="text-brand-500"/>
              <h2 className="text-sm font-semibold text-slate-800">Logo</h2>
            </div>
            <div className="flex items-center gap-6">
              <PhotoCapture
                currentUrl={logoUrl}
                onUploaded={url => setLogoUrl(url)}
                shape="square"
                size={80}
              />
              <div>
                <p className="text-sm text-slate-600 font-medium">{logoUrl ? 'Logo atual' : 'Sem logo'}</p>
                <p className="text-xs text-slate-400 mt-1">Aparece na tela de login e na aba do Chrome.<br/>Formatos: PNG, JPG, SVG. Preferencialmente retangular.</p>
              </div>
            </div>
          </section>

          {/* Cor principal */}
          <section className="bg-white border border-slate-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Palette size={16} className="text-brand-500"/>
              <h2 className="text-sm font-semibold text-slate-800">Cor principal</h2>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {PALETTE.map(c => (
                <button key={c} onClick={() => setPrimaryColor(c)}
                  className="w-9 h-9 rounded-xl border-2 transition-all"
                  style={{ backgroundColor: c, borderColor: primaryColor === c ? '#0f172a' : 'transparent' }}/>
              ))}
              <div className="flex items-center gap-2">
                <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                  className="w-9 h-9 rounded-xl border border-slate-200 cursor-pointer p-0.5"/>
                <span className="text-xs text-slate-400 font-mono">{primaryColor}</span>
              </div>
            </div>
            <div className="h-10 rounded-xl flex items-center px-4 text-white text-sm font-medium"
              style={{ backgroundColor: primaryColor }}>
              Prévia da cor — botões e destaques
            </div>
          </section>

          {/* Cores das bolhas */}
          <section className="bg-white border border-slate-100 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <MessageSquare size={16} className="text-brand-500"/>
              <h2 className="text-sm font-semibold text-slate-800">Cores das mensagens</h2>
            </div>
            <div className="space-y-5">
              {BUBBLES.map(b => (
                <div key={b.bgKey}>
                  <p className="text-xs font-medium text-slate-500 mb-2">{b.label}</p>
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Seletor de fundo */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Fundo</span>
                      <input type="color" value={bubbles[b.bgKey] || b.defaultBg}
                        onChange={e => setBubbles(prev => ({ ...prev, [b.bgKey]: e.target.value }))}
                        className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"/>
                      <span className="text-xs text-slate-400 font-mono">{bubbles[b.bgKey] || b.defaultBg}</span>
                    </div>
                    {/* Seletor de texto */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Texto</span>
                      <input type="color" value={bubbles[b.colorKey] || b.defaultColor}
                        onChange={e => setBubbles(prev => ({ ...prev, [b.colorKey]: e.target.value }))}
                        className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"/>
                      <span className="text-xs text-slate-400 font-mono">{bubbles[b.colorKey] || b.defaultColor}</span>
                    </div>
                    {/* Preview */}
                    <div className="px-3 py-2 rounded-xl text-sm font-medium shadow-sm"
                      style={{
                        backgroundColor: bubbles[b.bgKey] || b.defaultBg,
                        color: bubbles[b.colorKey] || b.defaultColor,
                        border: `1px solid ${bubbles[b.bgKey] || b.defaultBg}`,
                      }}>
                      {b.preview}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
