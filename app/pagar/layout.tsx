import type { Metadata } from 'next'
import { manifestPublico } from '@/lib/publicManifest'

// v48.129 — ver a explicação completa em lib/publicManifest.ts.
export const metadata: Metadata = manifestPublico

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
