'use client'
import { useState, useEffect } from 'react'
import AccessRequestNotification from './AccessRequestNotification'
import InternalChat from './InternalChat'
import { useAuth } from '@/lib/AuthContext'
import { supabase } from '@/lib/supabase'
import RegistrationNotification from './RegistrationNotification'
import PatientConfirmationNotification from './PatientConfirmationNotification'
import PagamentoRecebidoNotification from './PagamentoRecebidoNotification'
import AvisoCirurgiaNotification from './AvisoCirurgiaNotification'
import LembreteCompromissoNotification from './LembreteCompromissoNotification'
import NovaCirurgiaNotification from './NovaCirurgiaNotification'

// Estado global do chat interno via evento window
export default function ClientProviders() {
  const { agent } = useAuth()
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    const handler = () => setChatOpen(v => !v)
    window.addEventListener('toggle-internal-chat', handler)
    return () => window.removeEventListener('toggle-internal-chat', handler)
  }, [])

  return (
    <>
      <AccessRequestNotification/>
      <RegistrationNotification/>
      <PatientConfirmationNotification/>
      <PagamentoRecebidoNotification/>
      <AvisoCirurgiaNotification/>
      <LembreteCompromissoNotification/>
      <NovaCirurgiaNotification/>
      {agent && <InternalChat open={chatOpen} setOpen={setChatOpen}/>}
    </>
  )
}
