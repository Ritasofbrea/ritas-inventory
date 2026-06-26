'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { clearRole, getRole } from '@/lib/auth'
import { useEffect, useRef, useState } from 'react'
import { Role } from '@/lib/types'

const MORE_LINKS = [
  { href: '/count', label: 'Count Entry' },
  { href: '/receive-order', label: 'Receive Order' },
  { href: '/par-settings', label: 'Par Levels' },
  { href: '/manage-items', label: 'Manage Items' },
  { href: '/reports', label: 'Reports' },
]

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const [role, setRole] = useState<Role | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState({ top: 80, left: 0 })
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setRole(getRole())
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    clearRole()
    router.push('/login')
  }

  const navLink = (href: string, label: string) => (
    <Link
      href={href}
      className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
        pathname === href
          ? 'bg-[#c8102e] text-white'
          : 'text-green-100 hover:bg-[#155f2f]'
      }`}
    >
      {label}
    </Link>
  )

  const moreActive = MORE_LINKS.some((l) => l.href === pathname)

  return (
    <nav className="bg-[#1a7a3c] border-b border-[#155f2f] sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4">

        {/* Top row: logo + title + switch */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Image src="/Ritas_Logo_4c.png" alt="Rita's" width={32} height={32} className="rounded-full flex-shrink-0" />
            <span className="font-bold text-white text-base tracking-wide">
              Brea&apos;s Inventory
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-200">
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

        {/* Bottom row: nav tabs — scrollable on mobile */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2 scrollbar-hide">
          {role === 'shift_lead' && (
            <>
              {navLink('/count', 'Count Entry')}
              {navLink('/receive-order', 'Receive Order')}
            </>
          )}

          {role === 'owner' && (
            <>
              {navLink('/dashboard', 'Dashboard')}
              {navLink('/order-list', 'Order List')}
              {navLink('/history', 'History')}

              <div className="relative flex-shrink-0" ref={moreRef}>
                <button
                  ref={moreButtonRef}
                  onClick={() => {
                    if (moreButtonRef.current) {
                      const rect = moreButtonRef.current.getBoundingClientRect()
                      setMorePos({ top: rect.bottom + 4, left: rect.left })
                    }
                    setMoreOpen((o) => !o)
                  }}
                  className={`flex items-center gap-1 px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-colors ${
                    moreActive
                      ? 'bg-[#c8102e] text-white'
                      : 'text-green-100 hover:bg-[#155f2f]'
                  }`}
                >
                  More
                  <svg className={`w-3.5 h-3.5 transition-transform ${moreOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {moreOpen && (
                  <div className="fixed bg-white rounded-xl border border-gray-300 py-1 min-w-[180px] z-[9999]" style={{ top: morePos.top, left: morePos.left, boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)' }}>
                    {MORE_LINKS.map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        onClick={() => setMoreOpen(false)}
                        className={`block px-4 py-2.5 text-sm font-medium transition-colors ${
                          pathname === l.href
                            ? 'text-[#c8102e] bg-red-50'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

      </div>
    </nav>
  )
}
