'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearRole, getRole } from '@/lib/auth'
import { useEffect, useState } from 'react'
import { Role } from '@/lib/types'

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    setRole(getRole())
  }, [])

  const handleLogout = () => {
    clearRole()
    router.push('/login')
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
        pathname === href
          ? 'bg-[#c8102e] text-white'
          : 'text-green-100 hover:bg-[#155f2f]'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="bg-[#1a7a3c] border-b border-[#155f2f] sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-white text-lg mr-2 tracking-wide">
          Brea&apos;s Inventory
        </span>

        {navLink('/count', 'Count Entry')}

        {role === 'owner' && (
          <>
            {navLink('/order-list', 'Order List')}
            {navLink('/dashboard', 'Dashboard')}
            {navLink('/par-settings', 'Par Levels')}
            {navLink('/manage-items', 'Manage Items')}
            {navLink('/history', 'History')}
            {navLink('/reports', 'Reports')}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-green-200 capitalize">
            {role === 'owner' ? 'Owner' : 'Shift Lead'}
          </span>
          <button
            onClick={handleLogout}
            className="text-xs text-green-200 hover:text-white px-2 py-1 rounded border border-green-700 hover:border-white"
          >
            Switch
          </button>
        </div>
      </div>
    </nav>
  )
}
