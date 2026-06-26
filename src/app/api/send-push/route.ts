import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { getServerSupabase } from '@/lib/supabase'

const vapidEmail = process.env.VAPID_EMAIL ?? ''
webpush.setVapidDetails(
  vapidEmail.startsWith('mailto:') ? vapidEmail : `mailto:${vapidEmail}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

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
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(async (err) => {
        console.error('push send error:', err.statusCode, err.body, err.message)
        if (err.statusCode === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        throw new Error(`HTTP ${err.statusCode ?? '?'}: ${err.body ?? err.message}`)
      })
    )
  )

  const failures = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.message)
  const sent = results.filter((r) => r.status === 'fulfilled').length
  console.log(`push: ${sent}/${subs.length} sent`, failures.length ? failures : '')
  return NextResponse.json({ sent, total: subs.length, failures })
}
