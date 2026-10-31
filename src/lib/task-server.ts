// Server-only helpers for the To-Do feature.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  templateMatchesDate,
  todayInTZ,
  TaskTemplate,
  TaskTemplateStep,
  TaskInstance,
  Checklist,
  Recurrence,
  Priority,
  PhotoSetting,
  StepStyle,
  photoFlags,
  EVERYONE,
  TASK_CREATORS,
} from './tasks'

import { TASK_PHOTO_BUCKET } from './task-constants'
export { TASK_PHOTO_BUCKET }

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/

// Validates an optional due_time field from a request body. null/undefined/''
// all mean "no due time" (clears an existing override, or sets none for a new row).
export function parseDueTime(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  if (typeof value !== 'string' || !TIME_RE.test(value)) return { ok: false, error: 'Invalid due time' }
  return { ok: true, value }
}

// Flips any task_instances row still 'open' with a due_date before today to
// 'missed' — run before generating anything new, so an old open instance never
// lingers in Today's Tasks once its day has passed. Returns the number swept.
export async function sweepMissedInstances(db: SupabaseClient, today: string): Promise<number> {
  const { data, error } = await db
    .from('task_instances')
    .update({ status: 'missed' })
    .eq('status', 'open')
    .lt('due_date', today)
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

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

  const [{ data: existing, error: existingError }, { data: checklistsRaw, error: checklistsError }] = await Promise.all([
    db.from('task_instances').select('template_id').eq('due_date', dateStr).in('template_id', matching.map((t) => t.id)),
    db.from('checklists').select('name, due_time'),
  ])
  if (existingError) throw new Error(existingError.message)
  if (checklistsError) throw new Error(checklistsError.message)

  // Effective due time = the item's own due_time, else its checklist's current
  // default, else none — resolved now and copied onto the instance, so a later
  // change to the checklist default doesn't retroactively change this instance.
  const checklistDueTimes = new Map(((checklistsRaw ?? []) as Checklist[]).map((c) => [c.name, c.due_time]))

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
      due_time: t.due_time ?? (t.checklist_name ? checklistDueTimes.get(t.checklist_name) ?? null : null),
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

// Clears photo_url (and deletes the file from storage) for any task whose
// completion is more than 90 days old — hit nightly by the cleanup-photos
// cron. Everything else on the row (title, completed_by, completed_at, …)
// is left exactly as it was; the task stays in History, just without its
// photo. `completed_at` is only ever set by actually completing a task, so
// filtering on it already excludes still-open tasks that merely have a
// photo attached (photo_url can be set before completion too) — no separate
// status check needed. The cutoff is a plain 90*24h-ago instant rather than
// a Pacific calendar-day boundary (unlike due_date/weekday logic elsewhere)
// since being off by an hour across a twice-a-year DST shift doesn't matter
// for a 90-day retention window. Returns how many rows were cleaned up.
export async function cleanupOldTaskPhotos(db: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await db
    .from('task_instances')
    .select('id, photo_url')
    .not('photo_url', 'is', null)
    .lt('completed_at', cutoff)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) return 0

  await removeTaskPhotos(db, data.map((row) => row.photo_url))

  const { error: updateError } = await db
    .from('task_instances')
    .update({ photo_url: null })
    .in('id', data.map((row) => row.id))
  if (updateError) throw new Error(updateError.message)

  return data.length
}

// Carries a template's new assigned_to / created_by / due_time onto its tasks
// that aren't done yet (today's and overdue copies). Completed tasks are
// history and are left untouched. Returns an error message, or null on success.
export async function syncOpenInstanceOwnership(
  db: SupabaseClient,
  templateId: string,
  ownership: Record<string, string | null>
): Promise<string | null> {
  if (Object.keys(ownership).length === 0) return null
  const { error } = await db.from('task_instances').update(ownership).eq('template_id', templateId).eq('status', 'open')
  return error ? error.message : null
}

// Deactivating a template is supposed to make it disappear immediately, not
// linger for the rest of the day and then show up in Missed tomorrow looking
// like it "came back" — so remove today's still-open instance (if one was
// already generated) the moment the template goes inactive. A completed
// instance is left alone; it's already history. Reactivating later just
// resumes normal generation going forward — nothing skipped gets backfilled.
export async function removeOpenInstanceForDeactivatedTemplate(db: SupabaseClient, templateId: string): Promise<string | null> {
  const { data, error: fetchError } = await db
    .from('task_instances')
    .select('id, photo_url')
    .eq('template_id', templateId)
    .eq('status', 'open')
    .eq('due_date', todayInTZ())
  if (fetchError) return fetchError.message
  if (!data || data.length === 0) return null

  const { error } = await db
    .from('task_instances')
    .delete()
    .eq('template_id', templateId)
    .eq('status', 'open')
    .eq('due_date', todayInTZ())
  if (error) return error.message
  await removeTaskPhotos(db, data.map((row) => row.photo_url))
  return null
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

// Adds a new line item to an existing (checklist_name, section), or to a
// brand-new section — appended at the very end of the checklist, after every
// existing section — if that (checklist_name, section) pair doesn't exist yet.
// recurrence/weekday/custom_days are per-item, same as any other template —
// the caller (AddChecklistItemModal) pre-fills them from an existing sibling
// in that section as a convenience default, but sends its own explicit values
// here, so a one-off exception (e.g. this one item only on Sundays) is
// possible. Placed at the end of its section, everything renumbered to stay
// contiguous.
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
    due_time?: string | null
    recurrence: Recurrence
    weekday: number | null
    custom_days: number[] | null
  }
): Promise<TaskWriteResult<{ template: TaskTemplate }>> {
  const { data: siblingsRaw, error: fetchError } = await db
    .from('task_templates')
    .select('*')
    .eq('checklist_name', params.checklist_name)
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  const siblings = (siblingsRaw ?? []) as TaskTemplate[]
  if (siblings.length === 0) return { ok: false, error: 'That checklist was not found', status: 400 }
  const sibling = siblings.find((t) => t.section === params.section)

  const { data: inserted, error: insertError } = await db
    .from('task_templates')
    .insert({
      title: params.title,
      description: params.description,
      recurrence: params.recurrence,
      weekday: params.weekday,
      custom_days: params.custom_days,
      checklist_name: params.checklist_name,
      section: params.section,
      sort_order: 0, // placeholder — overwritten by the renumber below
      assigned_to: params.assigned_to,
      created_by: params.created_by,
      photo_required: params.photo_required,
      photo_allowed: params.photo_allowed,
      due_time: params.due_time ?? null,
    })
    .select()
    .single()
  if (insertError) return { ok: false, error: insertError.message, status: 500 }

  const existingOrdered = canonicalOrder(siblings)
  let insertAt = existingOrdered.length
  if (sibling) {
    for (let i = existingOrdered.length - 1; i >= 0; i--) {
      if (existingOrdered[i].section === params.section) {
        insertAt = i + 1
        break
      }
    }
  }
  // else: brand-new section — insertAt stays at the end of the whole checklist.
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
    .eq('due_date', todayInTZ())
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
// (today's open standalone instances only) — never crosses tiers; use
// setInstancePriority for that. Renumbers the whole tier afterward, same
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
    .eq('due_date', today)
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

// Full edit of a one-off standalone task (today's card only — same scope as
// move/priority above). Checklist items and copies of a repeating template
// are edited through their template instead (Repeating tab); this never
// checks who added the task — owner access is the only gate, enforced
// client-side same as the rest of the app, and it applies no matter who
// created it.
export async function editOneOffTask(
  db: SupabaseClient,
  instanceId: string,
  body: {
    title?: unknown
    description?: unknown
    assigned_to?: unknown
    created_by?: unknown
    photo_setting?: unknown
    due_time?: unknown
    priority?: unknown
  }
): Promise<TaskWriteResult<{ task: TaskInstance }>> {
  const { data: task, error: fetchError } = await db.from('task_instances').select('*').eq('id', instanceId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!task) return { ok: false, error: 'Task not found', status: 404 }
  if (task.template_id !== null) {
    return { ok: false, error: 'This task is part of a checklist or repeating task — edit it from the Repeating tab instead', status: 400 }
  }
  if (task.status !== 'open') return { ok: false, error: 'Only open tasks can be edited', status: 400 }

  const updates: Record<string, string | boolean | number | null> = {}

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { ok: false, error: 'Title cannot be empty', status: 400 }
    }
    updates.title = body.title.trim()
  }
  if (body.description !== undefined) {
    updates.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  }
  if (body.assigned_to !== undefined) {
    if (!(await isValidAssignee(db, body.assigned_to))) {
      return { ok: false, error: 'Pick who this is assigned to', status: 400 }
    }
    updates.assigned_to = body.assigned_to as string
  }
  if (body.created_by !== undefined) {
    if (!isValidCreator(body.created_by)) {
      return { ok: false, error: 'Pick who added this task', status: 400 }
    }
    updates.created_by = body.created_by as string
  }
  if (body.due_time !== undefined) {
    const dueTimeResult = parseDueTime(body.due_time)
    if (!dueTimeResult.ok) return { ok: false, error: dueTimeResult.error, status: 400 }
    updates.due_time = dueTimeResult.value
  }
  if (body.photo_setting !== undefined) {
    if (typeof body.photo_setting !== 'string' || !['off', 'optional', 'required'].includes(body.photo_setting)) {
      return { ok: false, error: 'Invalid photo setting', status: 400 }
    }
    Object.assign(updates, photoFlags(body.photo_setting as PhotoSetting))
  }
  if (body.priority !== undefined) {
    if (body.priority !== 'normal' && body.priority !== 'high') {
      return { ok: false, error: 'priority must be "normal" or "high"', status: 400 }
    }
    if (body.priority !== task.priority) {
      updates.priority = body.priority
      updates.sort_order = await nextStandaloneInstanceSortOrder(db, body.priority as Priority)
    }
  }

  if (Object.keys(updates).length === 0) return { ok: false, error: 'Nothing to update', status: 400 }

  const { data, error } = await db.from('task_instances').update(updates).eq('id', instanceId).select().single()
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true, task: data as TaskInstance }
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

  // Step checks (task_instance_step_checks) are deliberately left alone — they
  // represent physical work already done, same treatment as the task's title/
  // description/etc. Only completion metadata and the photo (tied to the
  // completion moment, may need retaking) are cleared. Reopening a checklist
  // task via undo shows it fully checked, same as it was right before it was
  // marked done, rather than forcing every step to be re-tapped.
  await removeTaskPhotos(db, [task.photo_url])
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Task steps (patch 28): reference text (reuses `description`) or checkable
// sub-steps hanging off a template, checked per-instance in
// task_instance_step_checks. See tasks.ts StepStyle.
// ---------------------------------------------------------------------------

export function isValidStepStyle(value: unknown): value is StepStyle {
  return value === 'none' || value === 'reference' || value === 'checklist'
}

// Attaches each instance's live step_style/steps/checked_step_ids, read from
// its owning template — never snapshotted onto the instance, so editing a
// template's steps mid-day changes what an already-generated instance shows
// (accepted; see patch 28 notes). Instances with no template_id (one-off
// tasks) always get step_style 'none' and empty arrays.
export async function attachStepsToInstances<T extends TaskInstance>(db: SupabaseClient, instances: T[]): Promise<T[]> {
  const templateIds = Array.from(new Set(instances.map((i) => i.template_id).filter((id): id is string => id !== null)))
  if (templateIds.length === 0) {
    return instances.map((i) => ({ ...i, step_style: 'none' as StepStyle, steps: [], checked_step_ids: [] }))
  }

  const [{ data: templatesRaw, error: templatesError }, { data: stepsRaw, error: stepsError }, { data: checksRaw, error: checksError }] =
    await Promise.all([
      db.from('task_templates').select('id, step_style').in('id', templateIds),
      db.from('task_template_steps').select('*').in('template_id', templateIds).order('sort_order', { ascending: true }),
      db.from('task_instance_step_checks').select('instance_id, step_id').in('instance_id', instances.map((i) => i.id)),
    ])
  if (templatesError) throw new Error(templatesError.message)
  if (stepsError) throw new Error(stepsError.message)
  if (checksError) throw new Error(checksError.message)

  const styleByTemplate = new Map(((templatesRaw ?? []) as { id: string; step_style: StepStyle }[]).map((t) => [t.id, t.step_style]))
  const stepsByTemplate = new Map<string, TaskTemplateStep[]>()
  for (const step of (stepsRaw ?? []) as TaskTemplateStep[]) {
    const list = stepsByTemplate.get(step.template_id) ?? []
    list.push(step)
    stepsByTemplate.set(step.template_id, list)
  }
  const checkedByInstance = new Map<string, string[]>()
  for (const row of (checksRaw ?? []) as { instance_id: string; step_id: string }[]) {
    const list = checkedByInstance.get(row.instance_id) ?? []
    list.push(row.step_id)
    checkedByInstance.set(row.instance_id, list)
  }

  return instances.map((i) => ({
    ...i,
    step_style: (i.template_id && styleByTemplate.get(i.template_id)) || 'none',
    steps: (i.template_id && stepsByTemplate.get(i.template_id)) || [],
    checked_step_ids: checkedByInstance.get(i.id) ?? [],
  }))
}

// Gate enforced on the server (not just the UI) so a stale page or a direct
// API call can't mark a checklist task done with unchecked steps. A
// 'checklist'-style template with zero steps defined yet is treated as
// satisfied (nothing to block on) rather than permanently uncompletable.
export async function canCompleteInstance(db: SupabaseClient, instance: TaskInstance): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!instance.template_id) return { ok: true }
  const { data: template, error: templateError } = await db
    .from('task_templates')
    .select('step_style')
    .eq('id', instance.template_id)
    .maybeSingle()
  if (templateError) return { ok: false, error: templateError.message }
  if (!template || template.step_style !== 'checklist') return { ok: true }

  const [{ count: totalCount, error: totalError }, { count: checkedCount, error: checkedError }] = await Promise.all([
    db.from('task_template_steps').select('id', { count: 'exact', head: true }).eq('template_id', instance.template_id),
    db.from('task_instance_step_checks').select('id', { count: 'exact', head: true }).eq('instance_id', instance.id),
  ])
  if (totalError) return { ok: false, error: totalError.message }
  if (checkedError) return { ok: false, error: checkedError.message }
  if ((totalCount ?? 0) > 0 && (checkedCount ?? 0) < (totalCount ?? 0)) {
    return { ok: false, error: 'All steps must be checked off before this task can be completed' }
  }
  return { ok: true }
}

// Checking a step inserts a row (with checked_by); unchecking deletes it.
// Both validate the step actually belongs to the instance's own template —
// defense against a stale page or a crafted call checking a step that
// belongs to some other task entirely.
async function loadInstanceAndStep(
  db: SupabaseClient,
  instanceId: string,
  stepId: string
): Promise<{ ok: true; instance: TaskInstance } | { ok: false; error: string; status: number }> {
  const { data: instance, error: instanceError } = await db.from('task_instances').select('*').eq('id', instanceId).maybeSingle()
  if (instanceError) return { ok: false, error: instanceError.message, status: 500 }
  if (!instance) return { ok: false, error: 'Task not found', status: 404 }
  if (!instance.template_id) return { ok: false, error: 'This task has no steps', status: 400 }

  const { data: step, error: stepError } = await db.from('task_template_steps').select('id, template_id').eq('id', stepId).maybeSingle()
  if (stepError) return { ok: false, error: stepError.message, status: 500 }
  if (!step || step.template_id !== instance.template_id) {
    return { ok: false, error: 'This step does not belong to this task', status: 400 }
  }
  return { ok: true, instance: instance as TaskInstance }
}

export async function checkStep(db: SupabaseClient, instanceId: string, stepId: string, checkedBy: unknown): Promise<TaskWriteResult> {
  const loaded = await loadInstanceAndStep(db, instanceId, stepId)
  if (!loaded.ok) return loaded
  if (!(await isActiveStaff(db, checkedBy))) return { ok: false, error: 'Pick your name from the list', status: 400 }

  const { error } = await db
    .from('task_instance_step_checks')
    .upsert({ instance_id: instanceId, step_id: stepId, checked_by: checkedBy }, { onConflict: 'instance_id,step_id', ignoreDuplicates: true })
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true }
}

export async function uncheckStep(db: SupabaseClient, instanceId: string, stepId: string): Promise<TaskWriteResult> {
  const loaded = await loadInstanceAndStep(db, instanceId, stepId)
  if (!loaded.ok) return loaded
  const { error } = await db.from('task_instance_step_checks').delete().eq('instance_id', instanceId).eq('step_id', stepId)
  if (error) return { ok: false, error: error.message, status: 500 }
  return { ok: true }
}

async function renumberSteps(db: SupabaseClient, templateId: string): Promise<TaskTemplateStep[] | { error: string }> {
  const { data, error } = await db
    .from('task_template_steps')
    .select('*')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true })
  if (error) return { error: error.message }
  const ordered = (data ?? []) as TaskTemplateStep[]
  const results = await Promise.all(
    ordered.map((s, i) => db.from('task_template_steps').update({ sort_order: i + 1 }).eq('id', s.id))
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) return { error: failed.error.message }
  return ordered.map((s, i) => ({ ...s, sort_order: i + 1 }))
}

export async function addTemplateStep(db: SupabaseClient, templateId: string, content: string): Promise<TaskWriteResult<{ steps: TaskTemplateStep[] }>> {
  const trimmed = content.trim()
  if (!trimmed) return { ok: false, error: "Step text can't be empty", status: 400 }
  const { data: existing, error: countError } = await db
    .from('task_template_steps')
    .select('sort_order')
    .eq('template_id', templateId)
    .order('sort_order', { ascending: false })
    .limit(1)
  if (countError) return { ok: false, error: countError.message, status: 500 }
  const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1
  const { error: insertError } = await db
    .from('task_template_steps')
    .insert({ template_id: templateId, content: trimmed, sort_order: nextOrder })
  if (insertError) return { ok: false, error: insertError.message, status: 500 }

  const steps = await renumberSteps(db, templateId)
  if ('error' in steps) return { ok: false, error: steps.error, status: 500 }
  return { ok: true, steps }
}

export async function updateTemplateStepContent(db: SupabaseClient, stepId: string, content: string): Promise<TaskWriteResult<{ steps: TaskTemplateStep[] }>> {
  const trimmed = content.trim()
  if (!trimmed) return { ok: false, error: "Step text can't be empty", status: 400 }
  const { data: step, error: fetchError } = await db.from('task_template_steps').select('template_id').eq('id', stepId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!step) return { ok: false, error: 'Step not found', status: 404 }

  const { error } = await db.from('task_template_steps').update({ content: trimmed }).eq('id', stepId)
  if (error) return { ok: false, error: error.message, status: 500 }

  const { data: all, error: listError } = await db
    .from('task_template_steps')
    .select('*')
    .eq('template_id', step.template_id)
    .order('sort_order', { ascending: true })
  if (listError) return { ok: false, error: listError.message, status: 500 }
  return { ok: true, steps: (all ?? []) as TaskTemplateStep[] }
}

export async function deleteTemplateStep(db: SupabaseClient, stepId: string): Promise<TaskWriteResult<{ steps: TaskTemplateStep[] }>> {
  const { data: step, error: fetchError } = await db.from('task_template_steps').select('template_id').eq('id', stepId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!step) return { ok: false, error: 'Step not found', status: 404 }

  // Cascades to task_instance_step_checks automatically (FK on delete cascade).
  const { error } = await db.from('task_template_steps').delete().eq('id', stepId)
  if (error) return { ok: false, error: error.message, status: 500 }

  const steps = await renumberSteps(db, step.template_id)
  if ('error' in steps) return { ok: false, error: steps.error, status: 500 }
  return { ok: true, steps }
}

export async function moveTemplateStep(db: SupabaseClient, stepId: string, direction: 'up' | 'down'): Promise<TaskWriteResult<{ steps: TaskTemplateStep[] }>> {
  const { data: step, error: fetchError } = await db.from('task_template_steps').select('template_id').eq('id', stepId).maybeSingle()
  if (fetchError) return { ok: false, error: fetchError.message, status: 500 }
  if (!step) return { ok: false, error: 'Step not found', status: 404 }

  const { data: siblingsRaw, error: listError } = await db
    .from('task_template_steps')
    .select('*')
    .eq('template_id', step.template_id)
    .order('sort_order', { ascending: true })
  if (listError) return { ok: false, error: listError.message, status: 500 }
  const siblings = (siblingsRaw ?? []) as TaskTemplateStep[]
  const index = siblings.findIndex((s) => s.id === stepId)
  if (index === -1) return { ok: false, error: 'Step not found', status: 404 }
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= siblings.length) {
    return { ok: false, error: direction === 'up' ? 'Already at the top' : 'Already at the bottom', status: 400 }
  }
  ;[siblings[index], siblings[swapWith]] = [siblings[swapWith], siblings[index]]

  const results = await Promise.all(siblings.map((s, i) => db.from('task_template_steps').update({ sort_order: i + 1 }).eq('id', s.id)))
  const failed = results.find((r) => r.error)
  if (failed?.error) return { ok: false, error: failed.error.message, status: 500 }
  return { ok: true, steps: siblings.map((s, i) => ({ ...s, sort_order: i + 1 })) }
}
