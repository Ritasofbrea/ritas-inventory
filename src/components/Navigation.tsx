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
          ? 'bg-blue-600 text-white'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="font-bold text-blue-700 text-lg mr-2">
          Rita&apos;s Inventory
        </span>

        {navLink('/count', 'Count Entry')}

        {role === 'owner' && (
          <>
            {navLink('/order-list', 'Order List')}
            {navLink('/dashboard', 'Dashboard')}
            {navLink('/par-settings', 'Par Levels')}
            {navLink('/manage-items', 'Manage Items')}
            {navLink('/history', 'History')}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500 capitalize">
            {role === 'owner' ? 'Owner' : 'Shift Lead'}
          </span>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded border border-gray-200 hover:border-red-300"
          >
            Switch
          </button>
        </div>
      </div>
    </nav>
  )
}
