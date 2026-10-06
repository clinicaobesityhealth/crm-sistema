import type { MetadataRoute } from 'next'
import { supabase } from '@/lib/supabase'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let logoUrl: string | null = null
  let clinicName = 'Obesity Health CRM'

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('sem env de build')
    const { data } = await supabase
      .from('clinic_branding')
      .select('logo_url, clinic_name')
      .eq('clinic_id', '00000000-0000-0000-0000-000000000001')
      .single()
    if (data) {
      logoUrl = data.logo_url || null
      clinicName = data.clinic_name || clinicName
    }
  } catch {}

  return {
    name: clinicName,
    short_name: clinicName,
    description: 'Sistema de atendimento Obesity Health',
    start_url: '/inbox',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: logoUrl
      ? [
          { src: logoUrl, sizes: 'any', type: 'image/png' },
          { src: logoUrl, sizes: '192x192', type: 'image/png' },
          { src: logoUrl, sizes: '512x512', type: 'image/png' },
        ]
      : [],
  }
}
