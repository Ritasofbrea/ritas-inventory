'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { orderDayLabel } from '@/lib/vendor-schedule'

interface VendorSchedule {
  vendor: string
  order_day: number | null
  cutoff_time: string
  reminder_start_time: string
  reminder_interval_minutes: number
  override_date: string | null
  active: boolean
}

const DAY_OPTIONS = [
  { value: '', label: 'Anytime (no fixed day)' },
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
]

function toHM(t: string): string {
  return t.slice(0, 5)
}

function VendorRow({ schedule, onSaved }: { schedule: VendorSchedule; onSaved: (s: VendorSchedule) => void }) {
  const [orderDay, setOrderDay] = useState(schedule.order_day === null ? '' : String(schedule.order_day))
  const [cutoffTime, setCutoffTime] = useState(toHM(schedule.cutoff_time))
  const [reminderStart, setReminderStart] = useState(toHM(schedule.reminder_start_time))
  const [intervalMin, setIntervalMin] = useState(String(schedule.reminder_interval_minutes))
  const [overrideDate, setOverrideDate] = useState(schedule.override_date ?? '')
  const [active, setActive] = useState(schedule.active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/vendor-schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor: schedule.vendor,
          order_day: orderDay === '' ? null : parseInt(orderDay, 10),
          cutoff_time: cutoffTime,
          reminder_start_time: reminderStart,
          reminder_interval_minutes: parseInt(intervalMin, 10) || 30,
          override_date: overrideDate || null,
          active,
        }),
      })
      if (!res.ok) throw new Error()
      onSaved(await res.json())
      setNotice('✓ Saved')
      setTimeout(() => setNotice(''), 2500)
    } catch {
      setError('Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="font-bold text-gray-900 capitalize">{schedule.vendor}</p>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="w-4 h-4 accent-gray-700" />
          Active
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500 font-medium">Order day</label>
        <select
          value={orderDay}
          onChange={(e) => setOrderDay(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500"
        >
          {DAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {orderDay !== '' && <p className="text-xs text-gray-400">Due {orderDayLabel(parseInt(orderDay, 10))}</p>}
      </div>

      {orderDay !== '' && (
        <>
          <div className="flex gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-500 font-medium">Cutoff time</label>
              <input type="time" value={cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500" />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs text-gray-500 font-medium">Reminders start at</label>
              <input type="time" value={reminderStart} onChange={(e) => setReminderStart(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Remind every (minutes)</label>
            <input
              type="text"
              inputMode="numeric"
              value={intervalMin}
              onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*$/.test(v)) setIntervalMin(v) }}
              className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">This week only, due a different day (optional)</label>
            <div className="flex items-center gap-2">
              <input type="date" value={overrideDate} onChange={(e) => setOverrideDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500" />
              {overrideDate && (
                <button type="button" onClick={() => setOverrideDate('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
              )}
            </div>
            <p className="text-xs text-gray-400">Only applies while that date falls inside the current week — it has no effect afterward.</p>
          </div>
        </>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}
      {notice && <p className="text-green-600 text-sm font-semibold">{notice}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="bg-gray-800 hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-2.5 rounded-xl text-sm"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

export default function VendorSchedulesPage() {
  const router = useRouter()
  const [checked, setChecked] = useState(false)
  const [schedules, setSchedules] = useState<VendorSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [newVendor, setNewVendor] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/vendor-schedules')
      if (!res.ok) throw new Error()
      setSchedules(await res.json())
    } catch {
      setError('Could not load vendor schedules.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: flips the gate open + fetches on mount, this app's standard pattern
    setChecked(true)
    load()
  }, [router, load])

  const addVendor = async () => {
    if (!newVendor.trim()) return
    setAdding(true)
    setError('')
    try {
      const res = await fetch('/api/vendor-schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor: newVendor.trim().toLowerCase(), order_day: 1 }),
      })
      if (!res.ok) throw new Error()
      setNewVendor('')
      await load()
    } catch {
      setError('Could not add vendor. Try again.')
    } finally {
      setAdding(false)
    }
  }

  if (!checked || loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Vendor Schedules</h1>
          <p className="text-gray-500 mt-1">
            Set which day each vendor is due and when reminders start. A vendor with no fixed day is &quot;anytime&quot; — no reminders, no due tag on the Order List.
          </p>
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <div className="flex flex-col gap-4 mb-6">
          {schedules.map((s) => (
            <VendorRow key={s.vendor} schedule={s} onSaved={(updated) => setSchedules((prev) => prev.map((p) => (p.vendor === updated.vendor ? updated : p)))} />
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-700">Add a vendor schedule</p>
          <p className="text-xs text-gray-400">Must exactly match the vendor name used on items (Manage Items&apos; Distributor field) — e.g. &quot;balford&quot; or &quot;bunzl&quot;, all lowercase.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newVendor}
              onChange={(e) => setNewVendor(e.target.value)}
              placeholder="vendor name"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-gray-500"
            />
            <button
              onClick={addVendor}
              disabled={adding || !newVendor.trim()}
              className="bg-gray-800 hover:bg-gray-900 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-4 py-2 rounded-xl text-sm"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
