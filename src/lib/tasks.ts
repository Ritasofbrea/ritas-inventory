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
// Standalone (non-checklist) tasks only — named-checklist items ignore this.
export type Priority = 'normal' | 'high'

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
  checklist_name: string | null
  section: string | null
  sort_order: number
  priority: Priority
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
  checklist_name: string | null
  section: string | null
  sort_order: number
  priority: Priority
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

// Fixed display order for known named checklists; anything else (future checklists
// added as data) sorts alphabetically after these, so the order stays stable run to run.
const CHECKLIST_ORDER = ['Opening Checklist', 'Closing Checklist', 'Time to Lean, Time to Clean']

export function sortChecklistNames(names: string[]): string[] {
  const known = CHECKLIST_ORDER.filter((n) => names.includes(n))
  const rest = names.filter((n) => !CHECKLIST_ORDER.includes(n)).sort((a, b) => a.localeCompare(b))
  return [...known, ...rest]
}

interface ChecklistShaped {
  checklist_name: string | null
  section: string | null
  sort_order: number
}

export interface ChecklistSection<T> {
  name: string
  items: T[]
}

export interface ChecklistGroup<T> {
  name: string
  sections: ChecklistSection<T>[]
}

// Groups a checklist's items into ordered sections. Section order is derived
// from sort_order — not from `section` text or DB row order — since sort_order
// is the only column that reliably encodes position (it counts continuously
// across the whole checklist; see supabase/corporate-checklists-seed.sql, and
// the add/reorder/rename server helpers in task-server.ts that preserve this).
// `tiebreak` resolves items that land on the same sort_order (e.g. an instance's
// today copy and an older, still-open overdue copy of the same checklist item).
function groupSections<T extends ChecklistShaped>(
  items: T[],
  tiebreak: (a: T, b: T) => number = () => 0
): ChecklistSection<T>[] {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || tiebreak(a, b))
  const sections: ChecklistSection<T>[] = []
  for (const item of sorted) {
    const name = item.section ?? ''
    const last = sections[sections.length - 1]
    if (last && last.name === name) last.items.push(item)
    else sections.push({ name, items: [item] })
  }
  return sections
}

function buildGroups<T extends ChecklistShaped>(items: T[], tiebreak?: (a: T, b: T) => number): ChecklistGroup<T>[] {
  const named = items.filter((t) => t.checklist_name !== null)
  const names = sortChecklistNames(Array.from(new Set(named.map((t) => t.checklist_name as string))))
  return names.map((name) => ({
    name,
    sections: groupSections(named.filter((t) => t.checklist_name === name), tiebreak),
  }))
}

export interface TaskInstanceChecklistGroup extends ChecklistGroup<TaskInstance> {
  total: number
  done: number
}

// Builds the named-checklist groups for Today's Tasks from the open + done lists
// the API already returns. Items with no checklist_name are the caller's concern
// (they render in the existing flat "To-Do" block, unchanged).
export function buildChecklistGroups(open: TaskInstance[], done: TaskInstance[]): TaskInstanceChecklistGroup[] {
  const groups = buildGroups([...open, ...done], (a, b) => a.due_date.localeCompare(b.due_date))
  return groups.map((g) => {
    const items = g.sections.flatMap((s) => s.items)
    return { ...g, total: items.length, done: items.filter((t) => t.status === 'done').length }
  })
}

// Same grouping for the Repeating (owner) view — one entry per template, no
// open/done concept. Ties (shouldn't normally happen; sort_order is kept
// unique per checklist by the server helpers) break by title.
export function buildTemplateChecklistGroups(templates: TaskTemplate[]): ChecklistGroup<TaskTemplate>[] {
  return buildGroups(templates, (a, b) => a.title.localeCompare(b.title))
}

// Standalone (non-checklist) task display order: high priority above normal,
// then sort_order within each tier. Used for Today's Tasks' flat "To-Do" list.
export function sortStandalone<T extends { priority: Priority; sort_order: number }>(items: T[]): T[] {
  const tierRank = (p: Priority) => (p === 'high' ? 0 : 1)
  return [...items].sort((a, b) => tierRank(a.priority) - tierRank(b.priority) || a.sort_order - b.sort_order)
}
