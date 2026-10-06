import type { Metadata } from 'next'

// v48.129 — "Salvei o link do médico na tela de início do celular e, ao
// abrir, cai na tela de login" (relato real do Jorge; o mesmo aconteceu com
// a Claudiana no link de pagamento no cartão).
//
// Causa: o CRM inteiro usa UM manifest só (app/manifest.ts), com
// display:'standalone' e start_url:'/inbox'. Toda página do site herda esse
// manifest — inclusive as públicas, sem login, que o paciente/médico abre
// por um link de WhatsApp. Quando o Safari do iPhone detecta um manifest
// assim numa página, "Adicionar à Tela de Início" vira instalar um app de
// verdade: ao abrir o ícone salvo, ele usa o start_url do manifest (/inbox)
// em vez da própria página que a pessoa salvou — e quem não tem sessão do
// CRM aberta naquele celular cai direto no login.
//
// A saída, já que app/manifest.ts (arquivo de convenção do Next.js) NÃO
// aceita ser sobrescrito por rota — só o link <link rel="manifest"> em si
// aceita — é apontar esse link, nas rotas públicas, para um manifest
// ESTÁTICO próprio (em /public), com display:'browser'. Isso tira o
// comportamento de "app instalado": o Safari volta a tratar "Adicionar à
// Tela de Início" como um favorito comum, que abre exatamente a página
// salva (com o token da cirurgia/cobrança), sem passar pelo /inbox.
//
// Cada rota pública ganha um layout.tsx só para isto (metadata.manifest não
// pode ir num Client Component, e essas páginas são todas 'use client').
export const manifestPublico: Metadata = { manifest: '/manifest-publico.webmanifest' }
export const manifestAgendarCirurgia: Metadata = { manifest: '/manifest-agendar-cirurgia.webmanifest' }
