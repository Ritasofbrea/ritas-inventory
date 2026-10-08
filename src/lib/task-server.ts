// Server-only helpers for the To-Do feature.
import type { SupabaseClient } from '@supabase/supabase-js'
import { templateMatchesDate, todayInTZ, TaskTemplate, TaskInstance, Recurrence, Priority, EVERYONE, TASK_CREATORS } from './tasks'

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
      checklist_name: t.checklist_name,
      section: t.section,
      sort_order: t.sort_order,
      priority: t.priority,
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

// ---------------------------------------------------------------------------
// Checklist editing: add item / reorder within a section / rename a section.
//
// Today's Tasks derives section order purely from sort_order counting
// continuously across a whole checklist (see groupSections in tasks.ts) — there
// is no separate section-order column. So every write here recomputes the
// checklist's full desired order explicitly and renumbers it 1..N, rather than
// trying to shift individual values — that keeps each section's rows
// contiguous by construction instead of by careful incremental arithmetic,
// which is exactly the kind of thing that goes quietly wrong later.
// ---------------------------------------------------------------------------

// Reconstructs a checklist's canonical item order from its current rows: groups
// by `section` value (not just adjacent sort_order runs), first-occurrence order,
// preserving each section's existing relative item order. Used by renameSection,
// where two previously-separate sections can end up sharing a name and need
// merging into one contiguous run.
function canonicalOrder(items: TaskTemplate[]): TaskTemplate[] {
  const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order)
  const order: string[] = []
  const buckets = new Map<string, TaskTemplate[]>()
  for (const item of sorted) {
    const key = item.section ?? ''
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(item)
  }
  return order.flatMap((key) => buckets.get(key)!)
}

async function renumberChecklist(db: SupabaseClient, orderedIds: string[]): Promise<string | null> {
  const results = await Promise.all(
    orderedIds.map((id, i) => db.from('task_templates').update({ sort_order: i + 1 }).eq('id', id))
  )
  const failed = results.find((r) => r.error)
  return failed?.error ? failed.error.message : null
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type TaskWriteResult<T = {}> = ({ ok: true } & T) | { ok: false; error: string; status: number }

// Adds a new line item to an existing (checklist_name, section). Copies
// recurrence/weekday/custom_days from an existing sibling in that section — all
// items in a section share the same cadence, so the owner never has to re-pick
// it. Placed at the end of its section, everything renumbered to stay contiguous.
export async function addChecklistItem(
  db: SupabaseClient,
  params: {
    checklist_name: string
    section: string
    title: string
    description: string | null
    assigned_to: string
    created_by: string
    photo_required: boolean
    photo_allowed: boolean
  }
): Promise<TaskWriteResult<{ template: TaskTemplate }>> {
  const { data: siblingsRaw, error: fetchError } = await db
    .from('task_templates')
    .select('*')
    .eq('checklist_name', params.checklist_name)
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  const siblings = (siblingsRaw ?? []) as TaskTemplate[]
  const sibling = siblings.find((t) => t.section === params.section)
  if (!sibling) return { ok: false, error: 'That checklist/section was not found', status: 400 }

  const { data: inserted, error: insertError } = await db
    .from('task_templates')
    .insert({
      title: params.title,
      description: params.description,
      recurrence: sibling.recurrence,
      weekday: sibling.weekday,
      custom_days: sibling.custom_days,
      checklist_name: params.checklist_name,
      section: params.section,
      sort_order: 0, // placeholder — overwritten by the renumber below
      assigned_to: params.assigned_to,
      created_by: params.created_by,
      photo_required: params.photo_required,
      photo_allowed: params.photo_allowed,
    })
    .select()
    .single()
  if (insertError) return { ok: false, error: insertError.message, status: 500 }

  const existingOrdered = canonicalOrder(siblings)
  let insertAt = existingOrdered.length
  for (let i = existingOrdered.length - 1; i >= 0; i--) {
    if (existingOrdered[i].section === params.section) {
      insertAt = i + 1
      break
    }
  }
  const ordered = [...existingOrdered.slice(0, insertAt), inserted as TaskTemplate, ...existingOrdered.slice(insertAt)]
  const renumberError = await renumberChecklist(db, ordered.map((t) => t.id))
  if (renumberError) return { ok: false, error: renumberError, status: 500 }

  const { data: final, error: finalError } = await db.from('task_templates').select('*').eq('id', inserted.id).single()
  if (finalError) return { ok: false, error: finalError.message, status: 500 }
  return { ok: true, template: final }
}

// Swaps a template with its neighbor within its own section (never crosses
// into another section — that's a rename/merge concern, not a reorder one).
export async function moveChecklistItem(
  db: SupabaseClient,
  templateId: string,
  direction: 'up' | 'down'
): Promise<TaskWriteResult> {
  const { data: target, error: targetError } = await db.from('task_templates').select('*').eq('id', templateId).maybeSingle()
  if (targetError) return { ok: false, error: targetError.message, status: 500 }
  if (!target) return { ok: false, error: 'Task not found', status: 404 }
  if (!target.checklist_name) return { ok: false, error: 'This task is not part of a checklist', status: 400 }

  const { data: siblingsRaw, error: fetchError } = await db
    .from('task_templates')
    .select('*')
    .eq('checklist_name', target.checklist_name)
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }

  const full = canonicalOrder((siblingsRaw ?? []) as TaskTemplate[])
  const fullIds = full.map((t) => t.id)
  const sectionPositions = full.reduce<number[]>((acc, t, i) => {
    if (t.section === target.section) acc.push(i)
    return acc
  }, [])
  const localIndex = sectionPositions.findIndex((i) => fullIds[i] === templateId)
  if (localIndex === -1) return { ok: false, error: 'Task not found in its section', status: 404 }

  const swapLocal = direction === 'up' ? localIndex - 1 : localIndex + 1
  if (swapLocal < 0 || swapLocal >= sectionPositions.length) {
    return {
      ok: false,
      error: direction === 'up' ? 'Already at the top of this section' : 'Already at the bottom of this section',
      status: 400,
    }
  }

  const globalA = sectionPositions[localIndex]
  const globalB = sectionPositions[swapLocal]
  const orderedIds = [...fullIds]
  ;[orderedIds[globalA], orderedIds[globalB]] = [orderedIds[globalB], orderedIds[globalA]]

  const renumberError = await renumberChecklist(db, orderedIds)
  if (renumberError) return { ok: false, error: renumberError, status: 500 }
  return { ok: true }
}

// Renames a section's label across every template that has it, and across
// already-generated, not-yet-done instances (so today's/overdue cards update
// immediately rather than waiting for tomorrow's regeneration — completed
// instances are history and are left as they were). If the new name collides
// with a different, already-existing section elsewhere in the same checklist,
// they're merged (treated as intentional) and renumbered into one contiguous run.
export async function renameChecklistSection(
  db: SupabaseClient,
  checklistName: string,
  oldSection: string,
  newSection: string
): Promise<TaskWriteResult> {
  const trimmed = newSection.trim()
  if (!trimmed) return { ok: false, error: 'Section name cannot be empty', status: 400 }
  if (trimmed === oldSection) return { ok: true }

  const { error: templatesError } = await db
    .from('task_templates')
    .update({ section: trimmed })
    .eq('checklist_name', checklistName)
    .eq('section', oldSection)
  if (templatesError) return { ok: false, error: templatesError.message, status: 500 }

  const { error: instancesError } = await db
    .from('task_instances')
    .update({ section: trimmed })
    .eq('checklist_name', checklistName)
    .eq('section', oldSection)
    .eq('status', 'open')
  if (instancesError) return { ok: false, error: instancesError.message, status: 500 }

  const { data: allRaw, error: fetchError } = await db.from('task_templates').select('*').eq('checklist_name', checklistName)
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  const ordered = canonicalOrder((allRaw ?? []) as TaskTemplate[])
  const renumberError = await renumberChecklist(db, ordered.map((t) => t.id))
  if (renumberError) return { ok: false, error: renumberError, status: 500 }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Standalone (non-checklist) tasks: priority + reorder.
//
// Unlike checklist items, these are day-scoped: reordering and the per-card
// priority toggle only affect today's/overdue open instances, not the
// template a recurring standalone task may have come from. A recurring
// standalone task's priority set at creation (or via editing its template)
// still carries onto every future day's instance through generateInstancesForDate
// — this only covers tweaking what's already on today's list.
// ---------------------------------------------------------------------------

// Where a newly created standalone task should slot in: after all existing
// open standalone instances in the same priority tier, so a fresh task
// appends at the bottom of its tier instead of defaulting to sort_order 0
// (which would sort it ahead of everything already there).
export async function nextStandaloneInstanceSortOrder(db: SupabaseClient, priority: Priority): Promise<number> {
  const { data } = await db
    .from('task_instances')
    .select('sort_order')
    .is('checklist_name', null)
    .eq('status', 'open')
    .eq('priority', priority)
    .order('sort_order', { ascending: false })
    .limit(1)
  return (data?.[0]?.sort_order ?? 0) + 1
}

// Same idea for a new standalone (non-checklist) recurring template.
export async function nextStandaloneTemplateSortOrder(db: SupabaseClient, priority: Priority): Promise<number> {
  const { data } = await db
    .from('task_templates')
    .select('sort_order')
    .is('checklist_name', null)
    .eq('priority', priority)
    .order('sort_order', { ascending: false })
    .limit(1)
  return (data?.[0]?.sort_order ?? 0) + 1
}

// Swaps a standalone task with its neighbor within the same priority tier
// (today's + overdue open standalone instances only) — never crosses tiers;
// use setInstancePriority for that. Renumbers the whole tier afterward, same
// reasoning as moveChecklistItem: simpler and more robust than incremental
// shifting, and self-heals the common case where everything still shares the
// sort_order=0 default from before anyone ever reordered.
export async function moveStandaloneItem(db: SupabaseClient, instanceId: string, direction: 'up' | 'down'): Promise<TaskWriteResult> {
  const { data: target, error: targetError } = await db.from('task_instances').select('*').eq('id', instanceId).maybeSingle()
  if (targetError) return { ok: false, error: targetError.message, status: 500 }
  if (!target) return { ok: false, error: 'Task not found', status: 404 }
  if (target.checklist_name !== null) {
    return { ok: false, error: 'This task is part of a checklist — reorder it from the Repeating tab instead', status: 400 }
  }
  if (target.status !== 'open') return { ok: false, error: 'Only open tasks can be reordered', status: 400 }

  const today = todayInTZ()
  const { data: tierRaw, error: fetchError } = await db
    .from('task_instances')
    .select('*')
    .is('checklist_name', null)
    .eq('status', 'open')
    .eq('priority', target.priority)
    .lte('due_date', today)
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }

  const tier = ((tierRaw ?? []) as TaskInstance[]).sort(
    (a, b) => a.sort_order - b.sort_order || a.due_date.localeCompare(b.due_date) || a.created_at.localeCompare(b.created_at)
  )
  const index = tier.findIndex((t) => t.id === instanceId)
  if (index === -1) return { ok: false, error: "Task not found in today's list", status: 404 }
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= tier.length) {
    return { ok: false, error: direction === 'up' ? 'Already at the top' : 'Already at the bottom', status: 400 }
  }
  ;[tier[index], tier[swapWith]] = [tier[swapWith], tier[index]]

  const results = await Promise.all(tier.map((t, i) => db.from('task_instances').update({ sort_order: i + 1 }).eq('id', t.id)))
  const failed = results.find((r) => r.error)
  if (failed?.error) return { ok: false, error: failed.error.message, status: 500 }
  return { ok: true }
}

// Changes a single standalone instance's priority (today's card only — see note
// above). Appends it to the end of its new tier so it doesn't land at a stale
// numeric position left over from its old tier.
export async function setInstancePriority(db: SupabaseClient, instanceId: string, priority: Priority): Promise<TaskWriteResult> {
  const { data: task, error: fetchError } = await db.from('task_instances').select('*').eq('id', instanceId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!task) return { ok: false, error: 'Task not found', status: 404 }
  if (task.checklist_name !== null) return { ok: false, error: 'Checklist items do not use priority', status: 400 }
  if (task.status !== 'open') return { ok: false, error: 'Only open tasks can have their priority changed', status: 400 }

  const sortOrder = await nextStandaloneInstanceSortOrder(db, priority)
  const { error } = await db.from('task_instances').update({ priority, sort_order: sortOrder }).eq('id', instanceId)
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true }
}

// Undoes a completion — same calendar day (Pacific) only, enforced server-side
// as a data-integrity rule, not a permission check (who's allowed to click the
// button is a client-side UI concern, same trust model as the rest of the app).
// Clears status/completed_by/completed_at and the photo (file included).
export async function undoCompletion(db: SupabaseClient, instanceId: string): Promise<TaskWriteResult> {
  const { data: task, error: fetchError } = await db.from('task_instances').select('*').eq('id', instanceId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!task) return { ok: false, error: 'Task not found', status: 404 }
  if (task.status !== 'done') return { ok: false, error: 'This task is not completed', status: 400 }
  if (!task.completed_at || todayInTZ(new Date(task.completed_at)) !== todayInTZ()) {
    return { ok: false, error: 'Can only undo on the same day it was completed', status: 400 }
  }

  const { error } = await db
    .from('task_instances')
    .update({ status: 'open', completed_by: null, completed_at: null, photo_url: null })
    .eq('id', instanceId)
    .eq('status', 'done')
  if (error) return { ok: false, error: error.message, status: 500 }

  await removeTaskPhotos(db, [task.photo_url])
  return { ok: true }
}
