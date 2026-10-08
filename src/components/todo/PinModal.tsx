'use client'

import { useState } from 'react'

// Same owner-PIN check the login screen uses, against the `pins` table.
export default function PinModal({ onSuccess, onClose }: { onSuccess: () => void; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setVerifying(true)
    try {
      const res = await fetch('/api/pins/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'owner', pin }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not verify PIN')
      if (body.valid) {
        onSuccess()
      } else {
        setError('Wrong PIN. Try again.')
        setPin('')
      }
    } catch {
      setError('Could not check the PIN. Check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
      >
        <div>
          <h2 className="text-xl font-bold text-gray-900">Enter PIN</h2>
          <p className="text-sm text-gray-500 mt-1">A PIN is needed to add tasks.</p>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          disabled={verifying}
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError('') }}
          placeholder="PIN"
          className="border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl text-center tracking-widest text-gray-900 focus:outline-none focus:border-green-500 disabled:opacity-50"
        />
        {error && <p className="text-red-500 text-sm -mt-2">{error}</p>}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={verifying}
            className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 font-semibold py-3 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!pin || verifying}
            className="flex-1 bg-[#1a7a3c] hover:bg-[#155f2f] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl"
          >
            {verifying ? 'Checking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  )
}
