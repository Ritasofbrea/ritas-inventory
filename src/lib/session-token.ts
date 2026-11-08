// Pure HMAC session-token signing/verification, split out of session.ts
// (patch 39 follow-up) so it has NO Next.js import -- session.ts pulls in
// `next/server`, which only resolves inside Next's own module resolution,
// not under plain Node. That made it impossible for tests/e2e scripts to
// mint a real, production-signed session token directly (the whole point
// of replacing PIN-based e2e login with a locally-minted cookie). This file
// only imports Node's `crypto`, so it loads fine either way. session.ts
// re-exports everything here unchanged -- this is a mechanical split, not a
// behavior change.
import { createHmac, timingSafeEqual } from 'crypto'

export type SessionRole = 'owner' | 'shift_lead' | 'staff'

export interface SessionPayload {
  role: SessionRole
  name: string | null
  iat: number // unix seconds
  exp: number // unix seconds
}

export const OWNER_SHIFT_LEAD_MAX_AGE_DAYS = 30
export const STAFF_MAX_AGE_DAYS = 365

function getSecret(): string | null {
  const s = process.env.SESSION_SECRET
  return s && s.length > 0 ? s : null
}

// No SESSION_SECRET configured -> every signing/verification call below
// fails closed (createSessionToken returns null, verifySessionToken returns
// null), so login refuses and every requireRole call returns 401.
export function sessionSecretConfigured(): boolean {
  return getSecret() !== null
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url')
}

export function createSessionToken(role: SessionRole, name: string | null, maxAgeDays?: number): { token: string; maxAgeSeconds: number } | null {
  const secret = getSecret()
  if (!secret) return null
  const days = maxAgeDays ?? (role === 'staff' ? STAFF_MAX_AGE_DAYS : OWNER_SHIFT_LEAD_MAX_AGE_DAYS)
  const maxAgeSeconds = days * 24 * 60 * 60
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { role, name, iat: now, exp: now + maxAgeSeconds }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = sign(payloadB64, secret)
  return { token: `${payloadB64}.${sig}`, maxAgeSeconds }
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  const secret = getSecret()
  if (!secret || !token) return null
  const dot = token.indexOf('.')
  if (dot < 0) return null
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payloadB64, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
    if (payload.role !== 'owner' && payload.role !== 'shift_lead' && payload.role !== 'staff') return null
    return payload
  } catch {
    return null
  }
}
