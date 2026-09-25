// Server-only helpers for the To-Do feature.
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateMatchesDate, TaskTemplate, Recurrence, EVERYONE, TASK_CREATORS } from './tasks'

export { TASK_PHOTO_BUCKET } from './task-constants'

// Creates today's task_instances for active templates that match the date.
// Idempotent: skips templates that already have an instance for that date, and
// the unique index on (template_id, due_date) backstops concurrent calls.
export async function generateInstancesForDate(
  db: SupabaseClient,
  dateStr: string,
  templateId?: string
): Promise<{ matched: number; created: number }> {
  let query = db.from('task_templates').select('*').eq('active', true)
  if (templateId) query = query.eq('id', templateId)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const matching = ((data ?? []) as TaskTemplate[]).filter((t) => templateMatchesDate(t, dateStr))
  if (matching.length === 0) return { matched: 0, created: 0 }

  const { data: existing, error: existingError } = await db
    .from('task_instances')
    .select('template_id')
    .eq('due_date', dateStr)
    .in('template_id', matching.map((t) => t.id))
  if (existingError) throw new Error(existingError.message)

  const have = new Set((existing ?? []).map((r: { template_id: string }) => r.template_id))
  const rows = matching
    .filter((t) => !have.has(t.id))
    .map((t) => ({
      template_id: t.id,
      title: t.title,
      due_date: dateStr,
      assigned_to: t.assigned_to,
      created_by: t.created_by,
      photo_required: t.photo_required,
      photo_allowed: t.photo_allowed,
      ...(t.description ? { description: t.description } : {}),
    }))
  if (rows.length === 0) return { matched: matching.length, created: 0 }

  const { error: insertError } = await db.from('task_instances').insert(rows)
  if (!insertError) return { matched: matching.length, created: rows.length }
  if (insertError.code !== '23505') throw new Error(insertError.message)

  // Another call created one of these between our check and insert — retry one by one.
  let created = 0
  for (const row of rows) {
    const { error: rowError } = await db.from('task_instances').insert(row)
    if (!rowError) created++
    else if (rowError.code !== '23505') throw new Error(rowError.message)
  }
  return { matched: matching.length, created }
}

export async function isActiveStaff(db: SupabaseClient, name: unknown): Promise<boolean> {
  if (typeof name !== 'string' || !name.trim()) return false
  const { data } = await db.from('staff').select('id').eq('name', name).eq('active', true).maybeSingle()
  return !!data
}

// assigned_to may be an active staff member or "Everyone" (unassigned task).
// completed_by keeps using isActiveStaff — whoever finishes a task must pick their own name.
export async function isValidAssignee(db: SupabaseClient, name: unknown): Promise<boolean> {
  return name === EVERYONE || isActiveStaff(db, name)
}

// created_by ("added by") is limited to the hardcoded list.
export function isValidCreator(name: unknown): boolean {
  return typeof name === 'string' && (TASK_CREATORS as readonly string[]).includes(name)
}

// Validates + normalizes recurrence fields so the DB check constraint never has to reject them.
export function normalizeRecurrence(body: {
  recurrence?: unknown
  weekday?: unknown
  custom_days?: unknown
}): { recurrence: Recurrence; weekday: number | null; custom_days: number[] | null } | { error: string } {
  const { recurrence, weekday, custom_days } = body
  if (recurrence === 'daily') return { recurrence, weekday: null, custom_days: null }
  if (recurrence === 'weekly') {
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { error: 'Pick a day of the week' }
    }
    return { recurrence, weekday, custom_days: null }
  }
  if (recurrence === 'custom') {
    if (
      !Array.isArray(custom_days) ||
      custom_days.length === 0 ||
      !custom_days.every((d) => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return { error: 'Pick at least one day' }
    }
    const unique = Array.from(new Set(custom_days as number[])).sort((a, b) => a - b)
    return { recurrence, weekday: null, custom_days: unique }
  }
  return { error: 'Recurrence must be daily, weekly, or custom' }
}
