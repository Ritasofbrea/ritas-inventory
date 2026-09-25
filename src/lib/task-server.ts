// Server-only helpers for the To-Do feature.
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateMatchesDate, TaskTemplate, Recurrence, EVERYONE, TASK_CREATORS } from './tasks'

import { TASK_PHOTO_BUCKET } from './task-constants'
export { TASK_PHOTO_BUCKET }

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

// Best-effort cleanup of photo files for tasks that were just deleted.
export async function removeTaskPhotos(db: SupabaseClient, urls: (string | null | undefined)[]): Promise<void> {
  const marker = `/object/public/${TASK_PHOTO_BUCKET}/`
  const paths = urls
    .filter((u): u is string => !!u)
    .map((u) => {
      const i = u.indexOf(marker)
      return i === -1 ? null : decodeURIComponent(u.slice(i + marker.length))
    })
    .filter((p): p is string => !!p)
  if (paths.length === 0) return
  try {
    await db.storage.from(TASK_PHOTO_BUCKET).remove(paths)
  } catch (e) {
    console.error('task photo cleanup failed:', e)
  }
}

// Carries a template's new assigned_to / created_by onto its tasks that aren't done yet
// (today's and overdue copies). Completed tasks are history and are left untouched.
// Returns an error message, or null on success.
export async function syncOpenInstanceOwnership(
  db: SupabaseClient,
  templateId: string,
  ownership: { assigned_to?: string; created_by?: string }
): Promise<string | null> {
  if (Object.keys(ownership).length === 0) return null
  const { error } = await db.from('task_instances').update(ownership).eq('template_id', templateId).eq('status', 'open')
  return error ? error.message : null
}

type DeleteResult = { ok: true; deletedOpen?: number } | { ok: false; error: string; status: number }

// Permanently deletes a one-off task. Instances made from a repeating task are
// refused: the generator would just recreate today's copy — delete the template instead.
export async function deleteOneOffTask(db: SupabaseClient, id: string): Promise<DeleteResult> {
  const { data: task, error: findError } = await db
    .from('task_instances')
    .select('id, template_id, photo_url')
    .eq('id', id)
    .maybeSingle()
  if (findError) return { ok: false, error: findError.message, status: 500 }
  if (!task) return { ok: false, error: 'Task not found', status: 404 }
  if (task.template_id) {
    return { ok: false, error: 'This task repeats — delete it from the Repeating tab instead', status: 400 }
  }
  const { error } = await db.from('task_instances').delete().eq('id', id)
  if (error) return { ok: false, error: error.message, status: 500 }
  await removeTaskPhotos(db, [task.photo_url])
  return { ok: true }
}

// Permanently deletes a repeating task (template) and its open instances; completed
// instances stay in History. task_instances.template_id is a plain foreign key, so the
// completed rows must be detached (template_id -> null) before the template can go.
// Order matters: switch the template off first so nothing regenerates mid-delete.
export async function deleteTemplate(db: SupabaseClient, id: string): Promise<DeleteResult> {
  const { data: template, error: findError } = await db.from('task_templates').select('id').eq('id', id).maybeSingle()
  if (findError) return { ok: false, error: findError.message, status: 500 }
  if (!template) return { ok: false, error: 'Task not found', status: 404 }

  const { error: offError } = await db.from('task_templates').update({ active: false }).eq('id', id)
  if (offError) return { ok: false, error: offError.message, status: 500 }

  const { data: openRows, error: openError } = await db
    .from('task_instances')
    .delete()
    .eq('template_id', id)
    .eq('status', 'open')
    .select('photo_url')
  if (openError) return { ok: false, error: openError.message, status: 500 }

  const { error: detachError } = await db.from('task_instances').update({ template_id: null }).eq('template_id', id)
  if (detachError) return { ok: false, error: detachError.message, status: 500 }

  const { error: deleteError } = await db.from('task_templates').delete().eq('id', id)
  if (deleteError) return { ok: false, error: deleteError.message, status: 500 }

  await removeTaskPhotos(db, (openRows ?? []).map((r: { photo_url: string | null }) => r.photo_url))
  return { ok: true, deletedOpen: (openRows ?? []).length }
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
