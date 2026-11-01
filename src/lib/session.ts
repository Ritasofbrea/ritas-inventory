import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// Server-side session concept, separate from the client's localStorage
// 'owner' | 'shift_lead' | null UI-gating role (src/lib/auth.ts, src/lib/types.ts).
// That client role is left untouched everywhere it's already used for
// visual gating (Navigation, canManage, etc.) — this is a parallel,
// cookie-based mechanism the SERVER checks, introduced by patch 29 because
// nothing server-side checked anything before.
export type SessionRole = 'owner' | 'shift_lead' | 'staff'

export interface SessionPayload {
  role: SessionRole
  name: string | null
  iat: number // unix seconds
  exp: number // unix seconds
}

export const SESSION_COOKIE = 'ritas_session'
const OWNER_SHIFT_LEAD_MAX_AGE_DAYS = 30
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

// `next dev` runs with NODE_ENV=development; every Vercel build (both
// Preview and Production use `next build`) runs with NODE_ENV=production.
// A Secure cookie is silently dropped by the browser over plain http, so
// this has to be conditional for local testing to work at all — it's still
// Secure everywhere actually deployed.
const COOKIE_SECURE = process.env.NODE_ENV === 'production'

export function setSessionCookie(response: NextResponse, role: SessionRole, name: string | null, maxAgeDays?: number): boolean {
  const created = createSessionToken(role, name, maxAgeDays)
  if (!created) return false
  response.cookies.set(SESSION_COOKIE, created.token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: created.maxAgeSeconds,
  })
  return true
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, secure: COOKIE_SECURE, sameSite: 'lax', path: '/', maxAge: 0 })
}

type SessionResult = { ok: true; session: SessionPayload } | { ok: false; status: 401; error: string }
type RoleResult = { ok: true; session: SessionPayload } | { ok: false; status: 401 | 403; error: string }

// Revocation (patch 29 B4): a signature- and expiry-valid cookie is still
// rejected if the person it names is no longer active, or if the cookie was
// issued (iat) before their most recent PIN change (owners.updated_at /
// shift_leads.updated_at) — so resetting someone's PIN, or deactivating
// them, kills their existing sessions immediately rather than waiting 30
// days for natural expiry. Staff sessions name no one (the To-Do List
// button is intentionally open to anyone, matching main — see
// src/app/api/session/route.ts) and so have nothing to revoke against;
// they're valid as long as the signature and expiry check out.
export async function getSession(db: SupabaseClient, request: NextRequest): Promise<SessionResult> {
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const payload = verifySessionToken(token)
  if (!payload) return { ok: false, status: 401, error: 'Not logged in' }

  if (payload.role === 'owner' || payload.role === 'shift_lead') {
    const table = payload.role === 'owner' ? 'owners' : 'shift_leads'
    const { data } = await db.from(table).select('active, updated_at').eq('name', payload.name).maybeSingle()
    if (!data || !data.active) return { ok: false, status: 401, error: 'Session no longer valid' }
    if (new Date(data.updated_at).getTime() > payload.iat * 1000) {
      return { ok: false, status: 401, error: 'PIN changed — please log in again' }
    }
  }
  return { ok: true, session: payload }
}

// 401 = no/invalid/expired/revoked session. 403 = valid session, wrong role.
export async function requireRole(db: SupabaseClient, request: NextRequest, roles: SessionRole[]): Promise<RoleResult> {
  const result = await getSession(db, request)
  if (!result.ok) return result
  if (!roles.includes(result.session.role)) return { ok: false, status: 403, error: 'Not allowed for your role' }
  return result
}
