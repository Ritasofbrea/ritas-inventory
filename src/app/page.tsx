'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clearRole, setRole } from '@/lib/auth'
import { fetchSession } from '@/lib/client-session'

// Patch 29: the PWA's start_url. Used to redirect purely off localStorage;
// now checks the real session cookie first (the source of truth — a
// browser with a role in localStorage but no valid cookie counts as
// logged out, per B8) and only falls back to /login when there's none.
export default function Home() {
  const router = useRouter()

  useEffect(() => {
    fetchSession().then(({ role }) => {
      if (role === 'owner' || role === 'shift_lead') {
        setRole(role)
        router.replace(role === 'owner' ? '/dashboard' : '/count')
      } else if (role === 'staff') {
        router.replace('/todo')
      } else {
        clearRole()
        router.replace('/login')
      }
    })
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-gray-400 text-lg">Loading…</div>
    </div>
  )
}
