import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { UUID_RE } from '@/lib/invoice-constants'
import { buildConfirmPlan, confirmInvoice, fileRecordOnly, setInvoiceNumber } from '@/lib/invoice-confirm-server'

// Patch 69: confirm an invoice delivery. Owners and shift leads only,
// enforced here on every method (the screen hiding a button is not the rule).
//   GET   ?invoice_id=<uuid>   -> the plan: what blocks a confirm, what stock
//                                 each item would get, shorts/overs, codes and
//                                 case sizes that would be remembered. Writes nothing.
//   POST  { invoice_id, mode: 'confirm', fingerprint?, related_order_id?, destinations?, remember_sizes? }
//                              -> adds the stock through saveReceipt, exactly once
//         { invoice_id, mode: 'record_only' }
//                              -> marks it received, adds NO stock
//         400 { code: 'blocked', blockers }   not ready
//         409 { code: 'duplicate', existing_id } / 'already_received' / 'changed' / 'order_gone'
//   PATCH { invoice_id, invoice_number }      -> type the number the reader missed
const ROLES: ('owner' | 'shift_lead')[] = ['owner', 'shift_lead']

// A confirm is many small database writes in a row (one or two per item).
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const id = new URL(request.url).searchParams.get('invoice_id') ?? ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  const out = await buildConfirmPlan(db, auth.session, id)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out.plan)
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })

  if (body.mode === 'record_only') {
    const out = await fileRecordOnly(db, auth.session, id)
    if (!out.ok) return NextResponse.json({ error: out.error, code: out.code, blockers: out.blockers, existing_id: out.existing_id }, { status: out.status })
    return NextResponse.json({ ok: true, record_only: true })
  }
  if (body.mode !== 'confirm') return NextResponse.json({ error: 'Bad mode' }, { status: 400 })

  if (body.related_order_id != null && (typeof body.related_order_id !== 'string' || !UUID_RE.test(body.related_order_id)))
    return NextResponse.json({ error: 'Bad order id' }, { status: 400 })
  const destinations: Record<string, string> = {}
  if (body.destinations && typeof body.destinations === 'object' && !Array.isArray(body.destinations))
    for (const [k, v] of Object.entries(body.destinations)) if (UUID_RE.test(k) && v === 'storage') destinations[k] = 'storage'
  const remember = Array.isArray(body.remember_sizes) ? body.remember_sizes.filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x)) : []

  const out = await confirmInvoice(db, auth.session, id, {
    fingerprint: typeof body.fingerprint === 'string' ? body.fingerprint : null,
    related_order_id: body.related_order_id ?? null,
    destinations,
    remember_sizes: remember,
  })
  if (!out.ok) return NextResponse.json({ error: out.error, code: out.code, blockers: out.blockers, existing_id: out.existing_id }, { status: out.status })
  return NextResponse.json(out)
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ROLES)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => ({}))
  const id = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })
  const out = await setInvoiceNumber(db, id, body.invoice_number)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json(out)
}
