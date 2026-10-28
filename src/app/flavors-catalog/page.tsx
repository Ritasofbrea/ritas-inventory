'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import FlavorCatalogView from '@/components/todo/FlavorCatalogView'
import { getRole } from '@/lib/auth'

// Owner-only, reached from the main "More" dropdown — same gating pattern
// as Staff/Shift Leads (patch 20).
export default function FlavorsCatalogPage() {
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
          <h1 className="text-2xl font-bold text-gray-900">Flavors Catalog</h1>
          <p className="text-gray-500 mt-1">Manage the master flavor list used by the weekly planner.</p>
        </div>

        <FlavorCatalogView />
      </main>
    </div>
  )
}
