import { NextRequest, NextResponse } from 'next/server'
import webPush from 'web-push'
import { getServerSupabase } from '@/lib/supabase'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!
const SUBJECT = process.env.VAPID_EMAIL!

webPush.setVapidDetails(
  SUBJECT.startsWith('mailto:') ? SUBJECT : `mailto:${SUBJECT}`,
  PUBLIC_KEY,
  PRIVATE_KEY,
)

async function sendToPushService(sub: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  await webPush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { TTL: 86400 },
  )
}

export async function POST(request: NextRequest) {
  const { title, body } = await request.json()
  if (!title || !body) return NextResponse.json({ error: 'Missing title or body' }, { status: 400 })

  const db = getServerSupabase()
  const { data: subs, error } = await db.from('push_subscriptions').select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!subs || subs.length === 0) return NextResponse.json({ sent: 0 })

  const payload = JSON.stringify({ title, body })

  const results = await Promise.allSettled(
    subs.map((sub) =>
      sendToPushService(sub, payload).catch(async (err: Error) => {
        const msg = err.message ?? String(err)
        if (msg.includes('410') || msg.includes('404')) {
          await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        throw err
      })
    )
  )

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason?.message ?? String(r.reason))
  const sent = results.filter((r) => r.status === 'fulfilled').length

  console.log(`push: ${sent}/${subs.length} sent`, failures.length ? failures : '')
  return NextResponse.json({ sent, total: subs.length, failures })
}
