import type { Metadata } from 'next'
import { manifestPublico } from '@/lib/publicManifest'

// v48.129 — ver a explicação completa em lib/publicManifest.ts.
// Este foi o caso real relatado (Claudiana): link de pagamento no cartão.
export const metadata: Metadata = manifestPublico

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
