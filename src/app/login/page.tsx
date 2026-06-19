'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setRole } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const handleShiftLead = () => {
    setRole('shift_lead')
    router.push('/count')
  }

  const handleOwnerClick = () => {
    setShowPinEntry(true)
    setError('')
    setPin('')
  }

  const handleOwnerSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const ownerPin = process.env.NEXT_PUBLIC_OWNER_PIN || '1234'
    if (pin === ownerPin) {
      setRole('owner')
      router.push('/dashboard')
    } else {
      setError('Wrong PIN. Try again.')
      setPin('')
    }
  }

  return (
    <div className="min-h-screen bg-blue-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🍧</div>
          <h1 className="text-3xl font-bold text-blue-800">Rita&apos;s Italian Ice</h1>
          <p className="text-blue-600 mt-1">Brea Location – Inventory</p>
        </div>

        {!showPinEntry ? (
          <div className="flex flex-col gap-4">
            <p className="text-center text-gray-600 font-medium mb-2">Who are you?</p>

            <button
              onClick={handleShiftLead}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xl font-semibold py-5 rounded-2xl shadow-md transition-colors"
            >
              I&apos;m a Shift Lead
            </button>

            <button
              onClick={handleOwnerClick}
              className="w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-blue-700 text-xl font-semibold py-5 rounded-2xl shadow-md border-2 border-blue-200 transition-colors"
            >
              I&apos;m an Owner
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Owner PIN</h2>
            <form onSubmit={handleOwnerSubmit} className="flex flex-col gap-4">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                autoFocus
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-2xl text-center tracking-widest focus:outline-none focus:border-blue-400"
              />
              {error && (
                <p className="text-red-500 text-center font-medium">{error}</p>
              )}
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold py-4 rounded-xl"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setShowPinEntry(false)}
                className="text-gray-500 hover:text-gray-700 text-sm"
              >
                ← Back
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
