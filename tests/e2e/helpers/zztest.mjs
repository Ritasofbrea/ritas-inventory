// Shared ZZTEST naming convention + cleanup sweep for role-checks.mjs and
// step-checks.mjs (both only create checklists/task_templates/task_instances
// fixtures -- logout-race.mjs doesn't write any test data). Run standalone
// via cleanup.mjs if a suite ever crashes mid-run and leaves fixtures behind.
import { rest } from './rest.mjs'

export const ZZTEST = 'ZZTEST'

// Hard-deleting a template detaches (doesn't delete) its done/missed
// instances -- same reasoning as the patch 36 hard-delete cleanup this is
// adapted from -- so the final orphan sweep by title/checklist_name below
// catches those too. task_instance_step_checks has no migration file in
// supabase/ (see CLAUDE.md's gotchas) -- not swept explicitly here; it's
// expected to cascade away with its instance/step the normal way a
// check-tracking join table would, but if a future run ever leaves orphaned
// rows there, that assumption needs re-verifying.
export async function sweepZztestFixtures() {
  const byList = await rest('task_templates?checklist_name=ilike.zztest*&select=id')
  const byTitle = await rest('task_templates?title=ilike.zztest*&select=id')
  const ids = Array.from(new Set([...byList, ...byTitle].map((t) => t.id)))

  if (ids.length > 0) {
    const idList = ids.join(',')
    await rest(`task_instances?template_id=in.(${idList})`, { method: 'DELETE' })
    await rest(`task_template_steps?template_id=in.(${idList})`, { method: 'DELETE' })
    await rest(`task_templates?id=in.(${idList})`, { method: 'DELETE' })
  }

  await rest('checklists?name=ilike.zztest*', { method: 'DELETE' })
  // Orphaned (detached, template_id=null) instances left behind by a hard
  // delete, caught by title or checklist_name snapshot.
  await rest('task_instances?or=(title.ilike.zztest*,checklist_name.ilike.zztest*)', { method: 'DELETE' })

  // notification-linking-checks.mjs's fake push subscription fixture
  // (endpoint contains "zztest.example.com") — normally cleaned up in its
  // own try/finally, this only matters if that run crashed first.
  await rest('push_subscriptions?endpoint=ilike.*zztest*', { method: 'DELETE' })

  // vendor-week-switch-checks.mjs's 'ZZTEST Vendor' fixture — same
  // reasoning; the log sweep is best-effort since that table may not
  // exist yet (supabase/add-vendor-week-status-log.sql not run).
  await rest('vendor_week_status?vendor=eq.ZZTEST%20Vendor', { method: 'DELETE' })
  await rest('vendor_week_status_log?vendor=eq.ZZTEST%20Vendor', { method: 'DELETE' }).catch(() => {})

  // item-category-checks.mjs's and item-flavor-link-checks.mjs's item
  // fixtures — normally deleted in their own try/finally, this only
  // matters if a run crashed first.
  await rest('items?name=ilike.zztest*', { method: 'DELETE' })

  // item-flavor-link-checks.mjs's flavor fixture — same reasoning.
  await rest('flavors?name=ilike.zztest*', { method: 'DELETE' })

  // order-history-paging-checks.mjs's fixtures — tagged via notes since
  // order_history_items.item_id only SETs NULL (doesn't cascade) when its
  // ZZTEST item is deleted, so a crashed run could otherwise leave orphan
  // order_history rows behind even after the items sweep above runs.
  // Deleting by notes cascades order_history_items automatically.
  await rest('order_history?notes=ilike.*zztest*', { method: 'DELETE' })
}
