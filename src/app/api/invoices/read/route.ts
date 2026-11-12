import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { UUID_RE } from '@/lib/invoice-constants'
import { runInvoicePageRead } from '@/lib/invoice-read-server'
import { buildInvoiceLines, pagesWithCrewEntries } from '@/lib/invoice-lines-server'

// Patch 65: read ONE page of a scanned invoice with the Anthropic API.
// POST { invoice_id, page, confirm_replace? } -> { result, totals_check, reads_left, status, lines_built, ... }
// Owners and shift leads only. All the read rules (draft/read only, page
// must be in photo_paths, per-page and app-wide read caps, retry once when
// the API is busy, saving into raw_extraction) live in runInvoicePageRead.
// The photo and the API key never leave the server.
//
// Patch 68: after a successful read, that page's invoice_lines are
// (re)built. If the page already has crew entries (received qty, checked,
// a pick or skip), the read is refused BEFORE any API call with 409
// code 'crew_entries' unless confirm_replace is true -- crew work is never
// silently replaced, and a refused read costs nothing.

// 60s fits Vercel Hobby either way: 60s is the Hobby cap without Fluid
// compute, 300s with it. The reader stops by READ_DEADLINE_MS (50s) so
// there's time left to save. Opus 5.5 took up to 35s on a page in testing.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : ''
  const page = Number(body.page)
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: 'Bad invoice id' }, { status: 400 })

  if (body.confirm_replace !== true && Number.isInteger(page)) {
    const touched = await pagesWithCrewEntries(db, invoiceId, [page])
    if (touched === null) return NextResponse.json({ error: 'Could not check for saved progress.' }, { status: 500 })
    if (touched.length > 0)
      return NextResponse.json(
        { error: `Page ${page} already has checked-off lines. Reading it again will clear what was entered on that page.`, code: 'crew_entries', pages: touched },
        { status: 409 }
      )
  }

  const out = await runInvoicePageRead(db, { invoiceId, page })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })

  // The crew-entry check above already passed (or was confirmed).
  const built = await buildInvoiceLines(db, invoiceId, { pages: [page], confirmReplace: true })
  return NextResponse.json({ ...out, lines_built: built.ok ? built.built : null })
}
