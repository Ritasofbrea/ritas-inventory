'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { setRole, clearRole } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [showPinEntry, setShowPinEntry] = useState(false)
  const [pinRole, setPinRole] = useState<'owner' | 'shift_lead'>('owner')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  const handleShiftLead = () => {
    setPinRole('shift_lead')
    setShowPinEntry(true)
    setError('')
    setPin('')
  }

  const handleOwnerClick = () => {
    setPinRole('owner')
    setShowPinEntry(true)
    setError('')
    setPin('')
  }

  // To-Do is open to everyone: no PIN, and no role is kept (so a previously stored
  // owner/shift-lead role can't carry over into the role-less To-Do view).
  const handleTodo = () => {
    clearRole()
    router.push('/todo')
  }

  // Shift lead and owner each have their own PIN
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const expectedPin =
      pinRole === 'owner'
        ? process.env.NEXT_PUBLIC_OWNER_PIN || '1234'
        : process.env.NEXT_PUBLIC_SHIFT_LEAD_PIN || '1234'
    if (pin === expectedPin) {
      setRole(pinRole)
      router.push(pinRole === 'owner' ? '/dashboard' : '/count')
    } else {
      setError('Wrong PIN. Try again.')
      setPin('')
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#1a7a3c] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-4">
            <Image src="/Ritas_Logo_4c.png" alt="Rita's Italian Ice" width={200} height={200} priority />
          </div>
          <p className="text-green-200 mt-1 font-medium tracking-wide">Brea Location – Inventory</p>
        </div>

        {!showPinEntry ? (
          <div className="flex flex-col gap-4">
            <p className="text-center text-green-100 font-medium mb-2">Who are you?</p>

            <button
              onClick={handleShiftLead}
              className="w-full bg-[#c8102e] hover:bg-[#a50d26] active:bg-[#8a0b1f] text-white text-xl font-semibold py-5 rounded-2xl shadow-lg transition-colors"
            >
              I&apos;m a Shift Lead
            </button>

            <button
              onClick={handleOwnerClick}
              className="w-full bg-white hover:bg-green-50 active:bg-green-100 text-[#1a7a3c] text-xl font-semibold py-5 rounded-2xl shadow-lg border-2 border-white transition-colors"
            >
              I&apos;m an Owner
            </button>

            <button
              onClick={handleTodo}
              className="w-full bg-transparent hover:bg-[#155f2f] active:bg-[#0f4a24] text-white text-xl font-semibold py-5 rounded-2xl border-2 border-green-200 transition-colors"
            >
              To-Do List
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-6">
            <h2 className="text-xl font-bold text-[#1a7a3c] mb-4">{pinRole === 'owner' ? 'Owner PIN' : 'Shift Lead PIN'}</h2>
            <form onSubmit={handlePinSubmit} className="flex flex-col gap-4">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter PIN"
                autoFocus
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-2xl text-center tracking-widest focus:outline-none focus:border-[#1a7a3c]"
              />
              {error && (
                <p className="text-[#c8102e] text-center font-medium">{error}</p>
              )}
              <button
                type="submit"
                className="w-full bg-[#c8102e] hover:bg-[#a50d26] text-white text-lg font-semibold py-4 rounded-xl"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setShowPinEntry(false)}
                className="text-gray-400 hover:text-gray-600 text-sm"
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
