import { NextRequest, NextResponse } from 'next/server'
import { encrypt } from 'web-push'
import { getServerSupabase } from '@/lib/supabase'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!
const SUBJECT = process.env.VAPID_EMAIL!

// Generate ES256 VAPID JWT using Web Crypto API (avoids jwa/ecdsa-sig-formatter issues)
async function makeVapidJWT(endpoint: string): Promise<string> {
  const origin = new URL(endpoint).origin
  const sub = SUBJECT.startsWith('mailto:') ? SUBJECT : `mailto:${SUBJECT}`

  const pubBytes = Buffer.from(PUBLIC_KEY, 'base64url')
  const privBytes = Buffer.from(PRIVATE_KEY, 'base64url')

  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: pubBytes.subarray(1, 33).toString('base64url'),
    y: pubBytes.subarray(33, 65).toString('base64url'),
    d: privBytes.toString('base64url'),
  }

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )

  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub,
  })).toString('base64url')

  const data = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(data)
  )

  return `${data}.${Buffer.from(sig).toString('base64url')}`
}

async function sendToPushService(sub: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  const encrypted = encrypt(sub.p256dh, sub.auth, payload, 'aes128gcm')
  const jwt = await makeVapidJWT(sub.endpoint)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${PUBLIC_KEY}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
    },
    body: new Uint8Array(encrypted.cipherText),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
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
      sendToPushService(sub, payload).catch(async (err) => {
        // Remove expired subscriptions
        if (err.message.includes('HTTP 410')) {
          await db.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
        throw err
      })
    )
  )

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason?.message)
  const sent = results.filter((r) => r.status === 'fulfilled').length

  console.log(`push: ${sent}/${subs.length} sent`, failures.length ? failures : '')
  return NextResponse.json({ sent, total: subs.length, failures })
}
