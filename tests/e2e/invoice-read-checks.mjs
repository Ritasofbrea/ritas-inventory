// Patch 65: invoice reader checks. NEVER calls the real Anthropic API.
//   Part A (HTTP, against `npm run dev`): every request here is one the route
//   must reject BEFORE any API call -- wrong role, bad page, finished
//   invoice, read cap. Run the dev server with ANTHROPIC_API_KEY= (blank) as
//   a backstop: if a guard ever broke, the reader would answer "not set up"
//   instead of spending money (and the check would fail loudly).
//   Part B (direct): runInvoicePageRead with a FAKE Anthropic client --
//   success, blank page, overloaded then retry succeeds, overloaded twice,
//   totals mismatch warning, daily cap, per-page cap.
//   Part C (HTTP): DELETE keeps a read draft as 'discarded' (photos removed),
//   still hard-deletes an unread draft.
// Fixtures: ZZTEST-created invoices with a 1x1 JPEG, removed by id at the end.
import { APIError } from '@anthropic-ai/sdk'
import { loginAsOwner, loginAsShiftLead, loginAsStaff, apiFetch } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import {
  TINY_JPEG,
  createDraftWithPages,
  deleteInvoiceById,
  getInvoice,
  listInvoicePhotos,
  sweepZztestInvoices,
} from './helpers/invoices.mjs'
import { getServerSupabase } from '../../src/lib/supabase.ts'
import { runInvoicePageRead } from '../../src/lib/invoice-read-server.ts'
import { readInvoicePage, READER_BUSY_MESSAGE, INVOICE_PAGE_SCHEMA } from '../../src/lib/invoice-reader.ts'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}

const created = []
async function draft(cookie, vendor, pageCount) {
  const inv = await createDraftWithPages(cookie, vendor, Array.from({ length: pageCount }, () => TINY_JPEG))
  created.push(inv.id)
  return inv
}

// ---- fake Anthropic client ------------------------------------------------
const line = (code, ordered, shipped) => ({
  vendor_code: code, item_number: null, description: `ZZTEST ${code}`, invoice_unit: 'CS',
  qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null,
})
const totals = (over = {}) => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null, ...over })
const pageResult = (over = {}) => ({
  vendor: 'bunzl', invoice_number: 'ZZTEST1', invoice_date: '11/11/26', page_number: 1, page_count: 1,
  has_no_items: false, lines: [], printed_totals: totals(), page_notes: null, ...over,
})
const message = (result) => ({
  id: 'msg_zztest', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
  usage: { input_tokens: 6000, output_tokens: 900 },
  content: [{ type: 'text', text: JSON.stringify(result) }],
})
const overloaded = () =>
  APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers())

function fakeClient(script) {
  const state = { calls: 0 }
  return {
    state,
    messages: {
      create: async () => {
        const next = script[state.calls++]
        if (next === undefined) throw new Error('fake client: unexpected extra call')
        if (next instanceof Error) throw next
        return next
      },
    },
  }
}

function deps(client, extra = {}) {
  const sleeps = []
  return {
    sleeps,
    deps: {
      model: 'claude-opus-5-5',
      reader: (input) => readInvoicePage(input, { client, model: 'claude-opus-5-5', sleep: async (ms) => { sleeps.push(ms) } }),
      ...extra,
    },
  }
}

async function main() {
  const swept = await sweepZztestInvoices()
  if (swept) console.log(`(swept ${swept} leftover ZZTEST invoices first)`)
  const owner = loginAsOwner()
  const lead = loginAsShiftLead()
  const staff = await loginAsStaff()
  const db = getServerSupabase()

  // The API rejects (400) a structured-output schema with more than 16
  // nullable/union-typed fields -- found the hard way in the live test.
  const unions = []
  ;(function walk(node, path) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node.type) || node.anyOf) unions.push(path)
    for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, `${path}.${k}`)
    if (node.items) walk(node.items, `${path}[]`)
  })(INVOICE_PAGE_SCHEMA, '$')
  check(`schema has <= 16 nullable fields (has ${unions.length})`, unions.length <= 16, unions.join(', '))

  // ===== Part A: HTTP guards (no API call can happen) =====
  const a = await draft(owner.cookie, 'bunzl', 1)
  const post = (cookie, body) => apiFetch('/api/invoices/read', cookie, { method: 'POST', body: JSON.stringify(body) })

  let r = await post(null, { invoice_id: a.id, page: 1 })
  check('no session -> 401', r.status === 401, `got ${r.status}`)
  r = await post(staff.cookie, { invoice_id: a.id, page: 1 })
  check('staff (wrong role) -> 403', r.status === 403, `got ${r.status}`)
  r = await post(owner.cookie, { invoice_id: 'not-a-uuid', page: 1 })
  check('bad invoice id -> 400', r.status === 400, `got ${r.status}`)
  r = await post(owner.cookie, { invoice_id: a.id, page: 2 })
  check('page not in photo_paths -> 400', r.status === 400, `got ${r.status}`)
  r = await post(lead.cookie, { invoice_id: a.id, page: 0 })
  check('shift lead allowed in; page 0 -> 400', r.status === 400, `got ${r.status}`)
  r = await post(owner.cookie, { invoice_id: a.id, page: 11 })
  check('page 11 (over the 10-page limit) -> 400', r.status === 400, `got ${r.status}`)

  // Over the per-page read cap: two counted attempts already on page 1.
  const at = new Date().toISOString()
  await rest(`invoices?id=eq.${a.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      raw_extraction: { model: null, rev: 1, last_attempt_at: at, pages: {}, attempts: [
        { page: 1, at, model: 'claude-opus-5-5', outcome: 'failed' },
        { page: 1, at, model: 'claude-opus-5-5', outcome: 'failed' },
      ] },
    }),
  })
  r = await post(owner.cookie, { invoice_id: a.id, page: 1 })
  const capBody = await r.json()
  check('over the per-page read cap -> 429', r.status === 429, `got ${r.status} ${JSON.stringify(capBody)}`)

  // Finished invoice.
  const f = await draft(owner.cookie, 'balford', 1)
  await rest(`invoices?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'received' }) })
  r = await post(owner.cookie, { invoice_id: f.id, page: 1 })
  check('finished (received) invoice -> 409', r.status === 409, `got ${r.status}`)
  await rest(`invoices?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'discarded' }) })
  r = await post(owner.cookie, { invoice_id: f.id, page: 1 })
  check('discarded invoice -> 409', r.status === 409, `got ${r.status}`)

  // ===== Part B: direct, fake client =====
  // B1 success on a 2-page invoice, page by page.
  const b = await draft(owner.cookie, 'bunzl', 2)
  let fc = fakeClient([message(pageResult({ page_number: 1, page_count: 2, lines: [line('53790032', 1, 1), line('K1700001', 2, 2)] }))])
  let out = await runInvoicePageRead(db, { invoiceId: b.id, page: 1 }, deps(fc).deps)
  let row = await getInvoice(b.id)
  check('success page 1 -> ok', out.ok === true, JSON.stringify(out))
  check('page 1 saved in raw_extraction.pages["1"]', row.raw_extraction?.pages?.['1']?.result?.lines?.length === 2)
  check('status stays draft until every page is read', row.status === 'draft', row.status)
  check('read_model set', row.read_model === 'claude-opus-5-5', row.read_model)
  check('attempt recorded as ok', row.raw_extraction.attempts.length === 1 && row.raw_extraction.attempts[0].outcome === 'ok')
  check('reads_left = 1 after one read', out.ok && out.reads_left === 1, JSON.stringify(out))
  check('no invoice_lines rows written', (await rest(`invoice_lines?invoice_id=eq.${b.id}&select=id`)).length === 0)
  check('page 1 has no printed total -> no_printed_total', out.ok && out.totals_check.status === 'no_printed_total', JSON.stringify(out.totals_check))

  fc = fakeClient([message(pageResult({ page_number: 2, page_count: 2, lines: [line('53790144', 1, 1)], printed_totals: totals({ total_ordered: 4, total_shipped: 4, total_units: 4 }) }))])
  out = await runInvoicePageRead(db, { invoiceId: b.id, page: 2 }, deps(fc).deps)
  row = await getInvoice(b.id)
  check('success page 2 -> ok', out.ok === true, JSON.stringify(out))
  check("status flips to 'read' once every page has a result", row.status === 'read' && out.status === 'read', row.status)
  check('totals across pages match (1+2+1 = 4)', out.ok && out.totals_check.status === 'match' && out.totals_check.lines_total === 4, JSON.stringify(out.totals_check))

  // B2 a re-read is allowed on a 'read' invoice; a third read is blocked.
  fc = fakeClient([message(pageResult({ lines: [line('53790032', 1, 1), line('K1700001', 2, 2)] }))])
  out = await runInvoicePageRead(db, { invoiceId: b.id, page: 1 }, deps(fc).deps)
  check("second read of a page on a 'read' invoice -> ok, reads_left 0", out.ok && out.reads_left === 0, JSON.stringify(out))
  fc = fakeClient([])
  out = await runInvoicePageRead(db, { invoiceId: b.id, page: 1 }, deps(fc).deps)
  check('third read of the same page -> 429, no API call', !out.ok && out.status === 429 && fc.state.calls === 0, JSON.stringify(out))

  // B3 blank page.
  const c = await draft(owner.cookie, 'balford', 1)
  fc = fakeClient([message(pageResult({ vendor: 'balford', has_no_items: true, lines: [] }))])
  out = await runInvoicePageRead(db, { invoiceId: c.id, page: 1 }, deps(fc).deps)
  row = await getInvoice(c.id)
  check('blank page -> ok with has_no_items true', out.ok && out.result.has_no_items === true && out.result.lines.length === 0, JSON.stringify(out))
  check("blank page still counts as read -> status 'read'", row.status === 'read', row.status)

  // B4 overloaded, then the retry succeeds.
  const d = await draft(owner.cookie, 'bunzl', 1)
  fc = fakeClient([overloaded(), message(pageResult({ lines: [line('53790065', 1, 1)] }))])
  let dd = deps(fc)
  out = await runInvoicePageRead(db, { invoiceId: d.id, page: 1 }, dd.deps)
  check('overloaded then retry succeeds -> ok', out.ok === true, JSON.stringify(out))
  check('exactly 2 API calls and one short wait', fc.state.calls === 2 && dd.sleeps.length === 1 && dd.sleeps[0] <= 5000, `calls=${fc.state.calls} sleeps=${dd.sleeps}`)

  // B5 overloaded twice.
  const e = await draft(owner.cookie, 'bunzl', 1)
  fc = fakeClient([overloaded(), overloaded()])
  dd = deps(fc)
  out = await runInvoicePageRead(db, { invoiceId: e.id, page: 1 }, dd.deps)
  row = await getInvoice(e.id)
  check('overloaded twice -> 503 with the friendly busy message', !out.ok && out.status === 503 && out.error === READER_BUSY_MESSAGE, JSON.stringify(out))
  check('busy attempt recorded as busy, nothing saved, still draft',
    row.raw_extraction.attempts.length === 1 && row.raw_extraction.attempts[0].outcome === 'busy' && !row.raw_extraction.pages['1'] && row.status === 'draft',
    JSON.stringify(row.raw_extraction))
  check('error never contains raw API text', !JSON.stringify(out).includes('overloaded_error'))
  fc = fakeClient([message(pageResult({ lines: [line('53790065', 1, 1)] }))])
  out = await runInvoicePageRead(db, { invoiceId: e.id, page: 1 }, deps(fc).deps)
  check("a busy attempt doesn't use up a read (next read ok, reads_left 1)", out.ok && out.reads_left === 1, JSON.stringify(out))

  // B6 totals mismatch is a warning, never an error.
  const g = await draft(owner.cookie, 'balford', 1)
  fc = fakeClient([message(pageResult({ vendor: 'balford', lines: [line('302446', 8, 8), line('302447', 4, 4)], printed_totals: totals({ total_units: 14 }) }))])
  out = await runInvoicePageRead(db, { invoiceId: g.id, page: 1 }, deps(fc).deps)
  check('totals mismatch -> still ok, status mismatch with a warning',
    out.ok && out.totals_check.status === 'mismatch' && out.totals_check.lines_total === 12 && out.totals_check.printed_total === 14 && !!out.totals_check.warning,
    JSON.stringify(out))

  // B7 a blank shipped qty makes the check 'incomplete', not a mismatch.
  const h = await draft(owner.cookie, 'bunzl', 1)
  fc = fakeClient([message(pageResult({ lines: [line('53790092', 1, null)], printed_totals: totals({ total_shipped: 1 }) }))])
  out = await runInvoicePageRead(db, { invoiceId: h.id, page: 1 }, deps(fc).deps)
  check('unreadable qty -> totals incomplete (warning, not error)', out.ok && out.totals_check.status === 'incomplete', JSON.stringify(out.totals_check))

  // B8 daily cap reached -> 429 before any API call.
  const k = await draft(owner.cookie, 'bunzl', 1)
  fc = fakeClient([])
  out = await runInvoicePageRead(db, { invoiceId: k.id, page: 1 }, deps(fc, { dailyCap: 0 }).deps)
  check('daily cap reached -> 429, no API call', !out.ok && out.status === 429 && fc.state.calls === 0, JSON.stringify(out))

  // ===== Part C: DELETE keeps a read draft as discarded =====
  const m = await draft(owner.cookie, 'bunzl', 2)
  fc = fakeClient([message(pageResult({ lines: [line('53790032', 1, 1)] }))])
  await runInvoicePageRead(db, { invoiceId: m.id, page: 1 }, deps(fc).deps) // 1 of 2 pages -> still draft
  r = await apiFetch('/api/invoices', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: m.id }) })
  const delBody = await r.json()
  row = await getInvoice(m.id)
  check("DELETE on a read draft -> row kept as 'discarded'", r.ok && delBody.discarded === true && row?.status === 'discarded', JSON.stringify(delBody))
  check('...its photos are removed from storage', (await listInvoicePhotos(m.id)).length === 0)
  check('...and its read attempts are kept', row?.raw_extraction?.attempts?.length === 1)
  const list = await (await apiFetch('/api/invoices', owner.cookie)).json()
  check('...and it is hidden from the recent list', !list.some((x) => x.id === m.id))

  const n = await draft(owner.cookie, 'bunzl', 1)
  r = await apiFetch('/api/invoices', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: n.id }) })
  check('DELETE on an unread draft -> still hard-deleted', r.ok && !(await getInvoice(n.id)), `status ${r.status}`)
}

async function cleanup() {
  let leftovers = 0
  for (const id of created) {
    const left = await deleteInvoiceById(id)
    if (left.photosLeft || left.rowLeft) leftovers++
  }
  console.log(`cleanup: ${created.length} test invoices removed by id, ${leftovers} with leftovers`)
  if (leftovers) failures++
}

main()
  .catch((err) => {
    console.error('FAIL  suite crashed:', err?.message ?? err)
    failures++
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error('FAIL  cleanup crashed:', err?.message ?? err)
      failures++
    })
    console.log(failures ? `\n${failures} check(s) failed` : '\nall invoice-read checks passed')
    process.exit(failures ? 1 : 0)
  })
