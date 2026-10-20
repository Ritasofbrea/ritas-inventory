'use client'

import { toHM } from '@/lib/tasks'

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

function parseHM(hm: string | null): { h12: number; minute: number; period: 'AM' | 'PM' } | null {
  if (!hm) return null
  const [hStr, mStr] = hm.split(':')
  const h24 = parseInt(hStr, 10)
  const minute = parseInt(mStr, 10)
  if (Number.isNaN(h24) || Number.isNaN(minute)) return null
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return { h12, minute, period }
}

const selectCls =
  'border border-gray-200 rounded-xl px-2 py-3 text-base text-gray-900 bg-white focus:outline-none focus:border-green-500 disabled:opacity-50'

// Safari/WebKit renders an empty <input type="time"> with a misleading
// grayed-out phantom time ("12:30 PM", always, regardless of what — if
// anything — is actually stored) instead of a truly blank field. Confirmed
// independent of this app's code or data: a bare <input type="time"> with
// value="" shows the same ghost. Plain <select>s sidestep it entirely — no
// native "empty widget" rendering, and every option is a complete, valid
// choice, so there's no partial-entry state to misread as blank either.
export default function TimeField({
  value,
  onChange,
  disabled,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const parsed = parseHM(toHM(value ?? null))

  if (!parsed) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-base">No time set</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange('12:00')}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
        >
          Set a time
        </button>
      </div>
    )
  }

  const emit = (h12: number, minute: number, period: 'AM' | 'PM') => {
    let h24 = h12 % 12
    if (period === 'PM') h24 += 12
    onChange(`${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Hour"
        value={parsed.h12}
        disabled={disabled}
        onChange={(e) => emit(Number(e.target.value), parsed.minute, parsed.period)}
        className={selectCls}
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-gray-400 font-semibold">:</span>
      <select
        aria-label="Minute"
        value={parsed.minute}
        disabled={disabled}
        onChange={(e) => emit(parsed.h12, Number(e.target.value), parsed.period)}
        className={selectCls}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
        ))}
      </select>
      <select
        aria-label="AM or PM"
        value={parsed.period}
        disabled={disabled}
        onChange={(e) => emit(parsed.h12, parsed.minute, e.target.value as 'AM' | 'PM')}
        className={selectCls}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('')}
        className="text-xs font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50"
      >
        Clear
      </button>
    </div>
  )
}
