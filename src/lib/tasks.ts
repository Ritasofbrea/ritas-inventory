// Shared types + date helpers for the To-Do feature (safe for client and server).
// All "today" / weekday logic is Pacific time (Brea, CA) — Vercel servers run UTC.

export const TASK_TZ = 'America/Los_Angeles'

// Week starts Monday: index 0 = Monday .. 6 = Sunday
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// assigned_to value for tasks that aren't assigned to one person
export const EVERYONE = 'Everyone'

// Who can be recorded as having added a task (created_by)
export const TASK_CREATORS = ['Josh', 'Gina', 'Valerie'] as const

export type Recurrence = 'none' | 'daily' | 'weekly' | 'custom'
export type PhotoSetting = 'off' | 'optional' | 'required'

export interface Staff {
  id: string
  name: string
  active: boolean
  created_at: string
}

export interface TaskTemplate {
  id: string
  title: string
  description: string | null
  recurrence: Recurrence
  weekday: number | null
  custom_days: number[] | null
  active: boolean
  photo_required: boolean
  photo_allowed: boolean
  assigned_to: string
  created_by: string
  created_at: string
}

export interface TaskInstance {
  id: string
  template_id: string | null
  title: string
  description: string | null
  due_date: string
  status: 'open' | 'done'
  assigned_to: string
  created_by: string
  completed_by: string | null
  completed_at: string | null
  photo_url: string | null
  photo_required: boolean
  photo_allowed: boolean
  created_at: string
}

export const photoFlags = (setting: PhotoSetting) => ({
  photo_allowed: setting !== 'off',
  photo_required: setting === 'required',
})

export const photoSettingOf = (x: { photo_allowed: boolean; photo_required: boolean }): PhotoSetting =>
  x.photo_required ? 'required' : x.photo_allowed ? 'optional' : 'off'

// YYYY-MM-DD for the given moment in Pacific time.
export function todayInTZ(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TASK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Monday-start weekday index (0=Monday..6=Sunday) for a YYYY-MM-DD date.
// JS getDay() is 0=Sunday, so shift: Sunday -> 6, Monday -> 0.
export function weekdayMonday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return (jsDay + 6) % 7
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().split('T')[0]
}

export function templateMatchesDate(
  t: Pick<TaskTemplate, 'recurrence' | 'weekday' | 'custom_days'>,
  dateStr: string
): boolean {
  const wd = weekdayMonday(dateStr)
  if (t.recurrence === 'daily') return true
  if (t.recurrence === 'weekly') return t.weekday === wd
  if (t.recurrence === 'custom') return (t.custom_days ?? []).includes(wd)
  return false
}

export function describeRecurrence(t: Pick<TaskTemplate, 'recurrence' | 'weekday' | 'custom_days'>): string {
  if (t.recurrence === 'daily') return 'Every day'
  if (t.recurrence === 'weekly' && t.weekday !== null) return `Every ${WEEKDAY_FULL[t.weekday]}`
  if (t.recurrence === 'custom') {
    return [...(t.custom_days ?? [])].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d]).join(', ')
  }
  return 'One time'
}

// "Mon, Sep 22" from a YYYY-MM-DD string (no timezone shift).
export function formatDateShort(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: TASK_TZ, hour: 'numeric', minute: '2-digit' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: TASK_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
