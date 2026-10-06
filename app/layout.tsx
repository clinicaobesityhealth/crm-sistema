import type { Metadata } from 'next'
import './globals.css'
import AuthProvider from '@/lib/AuthContext'
import ClientProviders from '@/components/ClientProviders'
import { supabase } from '@/lib/supabase'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.obesityhealth.com.br'
const DEFAULT_DESCRIPTION = 'Sistema de atendimento Obesity Health'

export async function generateMetadata(): Promise<Metadata> {
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
    metadataBase: new URL(APP_URL),
    title: clinicName,
    description: DEFAULT_DESCRIPTION,
    icons: {
      icon: logoUrl || '/favicon.ico',
      apple: logoUrl || '/apple-icon.png',
    },
    openGraph: {
      title: clinicName,
      description: DEFAULT_DESCRIPTION,
      url: APP_URL,
      siteName: clinicName,
      images: logoUrl ? [{ url: logoUrl }] : [],
    },
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            const total = localStorage.getItem('crm_badge_total');
            const base = localStorage.getItem('crm_badge_base') || 'Obesity Health CRM';
            if (total && total !== '0') document.title = '(' + total + ') ' + base;
            else document.title = base;
            const favicon = localStorage.getItem('crm_favicon');
            if (favicon) {
              var link = document.querySelector("link[rel='icon']") || document.createElement('link');
              link.rel = 'icon';
              link.href = favicon;
              document.head.appendChild(link);
            }
          } catch(e) {}
        `}}/>
      </head>
      <body>
        <AuthProvider>
          {children}
          <ClientProviders/>
        </AuthProvider>
      </body>
    </html>
  )
}

