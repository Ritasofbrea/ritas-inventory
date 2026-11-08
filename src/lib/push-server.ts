// Patch 44: push helpers for the new per-owner reminder/receipt-note alert
// paths. Deliberately NOT shared with src/app/api/send-push/route.ts (that
// route broadcasts to every subscription and is used today by count/
// receive-order/todo — left completely untouched). This is a small,
// separate sender for a pre-filtered subscription list.
import webPush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!
const SUBJECT = (process.env.VAPID_EMAIL ?? '').trim()

let vapidConfigured = false
function ensureVapid() {
  if (vapidConfigured) return
  webPush.setVapidDetails(SUBJECT.startsWith('mailto:') ? SUBJECT : `mailto:${SUBJECT}`, PUBLIC_KEY, PRIVATE_KEY)
  vapidConfigured = true
}

interface PushSub {
  endpoint: string
  p256dh: string
  auth: string
}

// Sends one payload to an already-filtered list of subscriptions. Deletes a
// subscription on 410/404 (expired at the push service), same cleanup
// /api/send-push does.
export async function sendPushToSubs(db: SupabaseClient, subs: PushSub[], payload: { title: string; body: string }): Promise<{ sent: number }> {
  if (subs.length === 0) return { sent: 0 }
  ensureVapid()
  const json = JSON.stringify(payload)
  const results = await Promise.allSettled(
    subs.map((sub) =>
      webPush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, json, { TTL: 86400 })
        .catch(async (err: Error) => {
          const msg = err.message ?? String(err)
          if (msg.includes('410') || msg.includes('404')) {
            await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
          throw err
        })
    )
  )
  return { sent: results.filter((r) => r.status === 'fulfilled').length }
}

// Subscriptions belonging to active owners who have the given alert switch
// on. An owner with the switch off, or who hasn't re-tapped "Enable
// Notifications" since push_subscriptions.owner_name was added, gets
// nothing — same as any other missing-subscription case today.
export async function subsForOwnersWithAlert(
  db: SupabaseClient,
  alertColumn: 'order_alerts_enabled' | 'receipt_note_alerts_enabled'
): Promise<PushSub[]> {
  const { data: owners } = await db.from('owners').select('name').eq('active', true).eq(alertColumn, true)
  const names = (owners ?? []).map((o: { name: string }) => o.name)
  if (names.length === 0) return []
  const { data: subs } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').in('owner_name', names)
  return (subs ?? []) as PushSub[]
}
