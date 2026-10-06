import { createClient } from '@supabase/supabase-js'

// v46.86 — Cliente Supabase com service_role, exclusivo para uso NO SERVIDOR
// (rotas app/api/**). NUNCA importar este arquivo em um componente de cliente
// ("use client") nem em código que rode no navegador: SUPABASE_SERVICE_ROLE_KEY
// não tem o prefixo NEXT_PUBLIC_ de propósito, para nunca ir parar no bundle do
// navegador. É a chave que ignora RLS — hoje usada só pela rota pública de
// confirmação de consulta (app/api/confirmacao/[id]), que precisa ler/gravar
// em `agendamentos`/`contacts`/`messages` sem que o paciente esteja logado.
//
// Necessário configurar a variável SUPABASE_SERVICE_ROLE_KEY no EasyPanel
// (Project Settings -> API -> service_role no painel do Supabase). Sem ela,
// as rotas que usam este cliente devolvem erro 503 em vez de quebrar o build.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export function getSupabaseAdmin() {
  if (!serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
