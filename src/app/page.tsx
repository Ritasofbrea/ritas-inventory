'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getRole } from '@/lib/auth'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const role = getRole()
    if (!role) {
      router.replace('/login')
    } else if (role === 'owner') {
      router.replace('/dashboard')
    } else {
      router.replace('/count')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-gray-400 text-lg">Loading…</div>
    </div>
  )
}
