'use client'

import { useCallback, useEffect, useState } from 'react'
import { getOwnerName } from '@/lib/auth'

interface OwnerAlerts {
  name: string
  order_alerts_enabled: boolean
  receipt_note_alerts_enabled: boolean
  linked: boolean
}

const switchBtn = (active: boolean) =>
  `flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition-colors ${
    active ? 'bg-[#1a7a3c] text-white border-[#1a7a3c]' : 'bg-white text-gray-600 border-gray-200'
  }`

// Patch 44: two independent switches per owner (order reminders,
// receipt-note alerts) — either owner can view or change either one, same
// self-service pattern as PinManagementView's Josh/Gina picker.
export default function OwnerAlertSettings() {
  const [owners, setOwners] = useState<OwnerAlerts[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [testingName, setTestingName] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owners/alerts')
      if (!res.ok) throw new Error()
      setOwners(await res.json())
    } catch {
      setError('Could not load alert settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetches on mount, this app's standard load-on-mount pattern
    load()
  }, [load])

  const toggle = async (name: string, field: 'order_alerts_enabled' | 'receipt_note_alerts_enabled', value: boolean) => {
    setSaving(`${name}:${field}`)
    setError('')
    try {
      const res = await fetch('/api/owners/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, [field]: value }),
      })
      if (!res.ok) throw new Error()
      const updated: OwnerAlerts = await res.json()
      setOwners((prev) => prev.map((o) => (o.name === name ? updated : o)))
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(null)
    }
  }

  // Owner-only feature — a device that has never logged in as an owner
  // (shift_lead, staff) has no getOwnerName() value, so this is only ever
  // "you" for whichever owner this device is currently logged in as.
  const myName = getOwnerName()

  const sendTest = async (name: string) => {
    setTestingName(name)
    setTestResult((prev) => ({ ...prev, [name]: '' }))
    try {
      const res = await fetch('/api/owners/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      const { sent } = await res.json()
      setTestResult((prev) => ({
        ...prev,
        [name]: sent > 0 ? `Sent to ${sent} device${sent !== 1 ? 's' : ''}` : `No linked devices for ${name} — have them tap Enable Notifications`,
      }))
    } catch {
      setTestResult((prev) => ({ ...prev, [name]: 'Could not send. Try again.' }))
    } finally {
      setTestingName(null)
    }
  }

  if (loading) return <p className="text-gray-400 text-center py-10">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-red-500 text-sm">{error}</p>}
      {owners.map((owner) => (
        <div key={owner.name} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold text-gray-900">{owner.name}</p>
            <span className={`text-xs font-semibold ${owner.linked ? 'text-green-600' : 'text-gray-400'}`}>
              {owner.linked ? (owner.name === myName ? 'Linked to you' : 'Linked') : 'Not linked'}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Order reminders</label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving === `${owner.name}:order_alerts_enabled`}
                className={switchBtn(owner.order_alerts_enabled)}
                onClick={() => toggle(owner.name, 'order_alerts_enabled', true)}
              >
                On
              </button>
              <button
                type="button"
                disabled={saving === `${owner.name}:order_alerts_enabled`}
                className={switchBtn(!owner.order_alerts_enabled)}
                onClick={() => toggle(owner.name, 'order_alerts_enabled', false)}
              >
                Off
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Receipt note alerts</label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving === `${owner.name}:receipt_note_alerts_enabled`}
                className={switchBtn(owner.receipt_note_alerts_enabled)}
                onClick={() => toggle(owner.name, 'receipt_note_alerts_enabled', true)}
              >
                On
              </button>
              <button
                type="button"
                disabled={saving === `${owner.name}:receipt_note_alerts_enabled`}
                className={switchBtn(!owner.receipt_note_alerts_enabled)}
                onClick={() => toggle(owner.name, 'receipt_note_alerts_enabled', false)}
              >
                Off
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1 pt-1 border-t border-gray-100">
            <button
              type="button"
              onClick={() => sendTest(owner.name)}
              disabled={testingName === owner.name}
              className="min-h-[40px] text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-50 disabled:opacity-50 mt-2"
            >
              {testingName === owner.name ? 'Sending…' : `Send ${owner.name} a test notification`}
            </button>
            {testResult[owner.name] && <p className="text-xs text-gray-500">{testResult[owner.name]}</p>}
          </div>
        </div>
      ))}
      <p className="text-xs text-gray-400">
        These control which alerts reach a device after it taps &quot;Enable Notifications&quot; (in the More menu). A switch turned off here stops that person&apos;s push alerts of that kind — it never changes anyone else&apos;s.
      </p>
    </div>
  )
}
