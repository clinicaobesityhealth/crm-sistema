import type { Metadata } from 'next'
import { manifestAgendarCirurgia } from '@/lib/publicManifest'

// v48.129 — ver a explicação completa em lib/publicManifest.ts.
export const metadata: Metadata = manifestAgendarCirurgia

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
