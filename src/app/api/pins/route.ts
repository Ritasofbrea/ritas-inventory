import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { clientIp, isRateLimited, recordLoginAttempt } from '@/lib/rate-limit'
import { requireRole } from '@/lib/session'

const OWNER_NAMES = ['Josh', 'Gina']

// Lists every PIN's name + when it was last changed — never the value
// itself. Used by the Change PIN screen: an owner can change Josh's or
// Gina's PIN, a shift lead can change their own — both via the same
// self-service flow (current PIN required first).
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const [ownersRes, shiftLeadsRes] = await Promise.all([
    db.from('owners').select('name, updated_at').in('name', OWNER_NAMES),
    db.from('shift_leads').select('name, updated_at').eq('active', true).order('name'),
  ])
  if (ownersRes.error) return NextResponse.json({ error: ownersRes.error.message }, { status: 500 })
  if (shiftLeadsRes.error) return NextResponse.json({ error: shiftLeadsRes.error.message }, { status: 500 })
  // Patch 39 follow-up: ZZTEST Shift Lead is kept permanently active for
  // e2e tests -- it must never show up on the real Change PIN screen.
  const realShiftLeads = shiftLeadsRes.data.filter((s) => !s.name.startsWith('ZZTEST'))
  return NextResponse.json([...ownersRes.data, ...realShiftLeads])
}

// Changes a PIN: requires current_pin to match the stored value first.
// Changing one person's PIN only ever checks their own current PIN, never
// anyone else's — owners and shift leads are each independent rows, in
// `owners` and `shift_leads` respectively (both use a `pin` column, so no
// column-name branching is needed here, unlike the old owners/pins split).
//
// Patch 29 B9: same rate limiter as /api/pins/verify, keyed on the same
// login_attempts table — a current_pin guess here counts the same as a
// login guess, since both are PIN-guessing surfaces against the same
// stored values.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name, current_pin, new_pin } = await request.json()
  if (typeof name !== 'string' || !name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  if (typeof current_pin !== 'string' || !current_pin) {
    return NextResponse.json({ error: 'Enter the current PIN' }, { status: 400 })
  }
  if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin)) {
    return NextResponse.json({ error: 'New PIN must be 4-6 digits' }, { status: 400 })
  }

  const ip = clientIp(request)
  if (await isRateLimited(db, ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })
  }

  const table = OWNER_NAMES.includes(name) ? 'owners' : 'shift_leads'

  const { data: row, error: fetchError } = await db.from(table).select('pin').eq('name', name).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'PIN not found' }, { status: 404 })
  await recordLoginAttempt(db, ip, row.pin === current_pin)
  if (row.pin !== current_pin) {
    // 400, not 401 — this is "wrong input" on an already-logged-in screen,
    // not a session problem. Patch 29's global 401 handler (SessionGuard)
    // treats every 401 as "go log in again", which would be wrong here.
    return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 400 })
  }

  const { error: updateError } = await db
    .from(table)
    .update({ pin: new_pin, updated_at: new Date().toISOString() })
    .eq('name', name)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
