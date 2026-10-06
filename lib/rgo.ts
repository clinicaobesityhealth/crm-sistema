// v48.59 — Descrição cirúrgica (RGO). Só servidor.
//
// Guardar a descrição cirúrgica marca a cirurgia como REALIZADA — é a regra da
// clínica: foto da descrição recebida = cirurgia feita. Um lugar só para essa
// regra, usado pelo link do cirurgião e pelo envio da secretária.

import type { getSupabaseAdmin } from './supabaseAdmin'
type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>

export const STATUS_REALIZADA = 'CIRURGIA REALIZADA'

export async function marcarRealizada(admin: Admin, cirurgia: { id: string; status?: string | null; categoria?: string | null }, quem: string) {
  if (cirurgia.categoria === 'realizada' || String(cirurgia.status || '').toUpperCase() === STATUS_REALIZADA) return false
  const { data: st } = await admin.from('cirurgia_status').select('id, nome, categoria').ilike('nome', STATUS_REALIZADA).maybeSingle()
  const { error } = await admin.from('cirurgias').update({
    status: st?.nome || STATUS_REALIZADA,
    status_id: st?.id ?? null,
    categoria: st?.categoria || 'realizada',
    criado_por_nome: quem,
    updated_at: new Date().toISOString(),
  }).eq('id', cirurgia.id)
  return !error
}
