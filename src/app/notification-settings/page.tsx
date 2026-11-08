'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import OwnerAlertSettings from '@/components/OwnerAlertSettings'
import { getRole } from '@/lib/auth'

export default function NotificationSettingsPage() {
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: flips the gate open once the role check passes on mount
    setChecked(true)
  }, [router])

  if (!checked) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Notification Settings</h1>
          <p className="text-gray-500 mt-1">
            Turn order reminders and receipt-note alerts on or off for Josh or Gina. Push notifications must also be enabled on this device — see &quot;Enable Notifications&quot; in the More menu.
          </p>
        </div>

        <OwnerAlertSettings />
      </main>
    </div>
  )
}
