'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { buscarCep, formatarCep, soDigitosCep, type EnderecoDoCep } from '@/lib/cep'

// v48.51 — Campo de CEP que preenche o endereço sozinho ao completar 8 dígitos.
// Só preenche; quem digita pode corrigir qualquer campo depois. O número e o
// complemento nunca vêm do CEP — continuam com a secretária.
export default function CampoCep({ value, onChange, onEndereco, className }: {
  value: string
  onChange: (cep: string) => void
  onEndereco: (e: EnderecoDoCep) => void
  className?: string
}) {
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState('')

  async function mudou(v: string) {
    const f = formatarCep(v)
    onChange(f)
    setAviso('')
    if (soDigitosCep(f).length !== 8) return
    setBuscando(true)
    const e = await buscarCep(f)
    setBuscando(false)
    if (e) onEndereco(e)
    else setAviso('CEP não encontrado — preencha o endereço à mão.')
  }

  return (
    <div className={className}>
      <div className="relative">
        <input value={value} onChange={e => mudou(e.target.value)} placeholder="CEP" inputMode="numeric"
          maxLength={9} className="field-input pr-8"/>
        {buscando && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400"/>}
      </div>
      {aviso && <p className="mt-1 text-[11px] text-amber-600">{aviso}</p>}
    </div>
  )
}
