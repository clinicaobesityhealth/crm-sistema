'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SettingsIndexPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/settings/appearance') }, [router])
  return null
}
