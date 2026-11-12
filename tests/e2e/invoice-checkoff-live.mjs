// Patch 68: ONE live end-to-end check -- read a real page, build lines,
// match them against the real catalog. SPENDS MONEY (about $0.04-0.05 with
// Opus 5.5), so it never runs by default and is NOT in run-all.mjs:
//   npm run test:e2e:invoice-checkoff-live
// against `npm run dev` WITH the real ANTHROPIC_API_KEY.
// Uses Balford invoice 24168404 (test-invoices/IMG_6996.HEIC, gitignored).
// Expected after patch 66's codes: 302446, 302447, 307050 match by vendor
// code; Hershey's dark fudge (34944) has no Balford item, so it stays
// unmatched. Read-only against real items. The ZZTEST draft and its photo
// are removed by id at the end.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginAsOwner, apiFetch } from './helpers/auth.mjs'
import { createDraftWithPages, deleteInvoiceById, getInvoice } from './helpers/invoices.mjs'

if (process.env.INVOICE_CHECKOFF_LIVE !== '1') {
  console.log('SKIP  invoice-checkoff-live: set INVOICE_CHECKOFF_LIVE=1 to run (spends real API money).')
  process.exit(0)
}

let failures = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'invoice-checkoff-live-'))
let invoiceId = null
let cost = 0

async function main() {
  const owner = loginAsOwner()
  const out = join(tmp, 'p1.jpg')
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '2400', join(ROOT, 'test-invoices', 'IMG_6996.HEIC'), '--out', out], { stdio: 'ignore' })
  const inv = await createDraftWithPages(owner.cookie, 'balford', [readFileSync(out)])
  invoiceId = inv.id

  const t0 = Date.now()
  const r = await apiFetch('/api/invoices/read', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id, page: 1 }) })
  const body = await r.json()
  check('real read through the route -> 200', r.ok, JSON.stringify(body))
  if (!r.ok) return
  const usage = (await getInvoice(inv.id)).raw_extraction.pages['1'].usage
  cost = (usage.input_tokens * 4 + usage.output_tokens * 20) / 1e6
  console.log(`      ${((Date.now() - t0) / 1000).toFixed(1)}s, in=${usage.input_tokens} out=${usage.output_tokens}, $${cost.toFixed(4)}`)
  check('read route built the lines', body.lines_built === 4, `${body.lines_built}`)

  const view = await (await apiFetch(`/api/invoices/lines?invoice_id=${inv.id}`, owner.cookie)).json()
  const by = (code) => view.lines.find((l) => l.vendor_code === code)
  for (const [code, name] of [['302446', 'Vanilla Custard Bags'], ['302447', 'Chocolate Custard Bags'], ['307050', 'Chocolate Chips']])
    check(`${code} -> ${name} by vendor code`, by(code)?.match_method === 'vendor_code' && by(code)?.item?.name === name, JSON.stringify(by(code)?.item))
  check("34944 (Hershey's dark fudge) stays unmatched", by('34944')?.needs_pick === true && !by('34944')?.item)
  check('header filled: invoice 24168404, dated 11/07/26', view.invoice.invoice_number === '24168404' && view.invoice.printed_date === '11/07/26')
  console.log(`      totals check: ${JSON.stringify(view.totals_check)}`)
}

main()
  .catch((e) => { console.error('FAIL  crashed:', e?.message ?? e); failures++ })
  .finally(async () => {
    if (invoiceId) {
      const left = await deleteInvoiceById(invoiceId).catch(() => ({ photosLeft: -1, rowLeft: true }))
      console.log(`cleanup ${invoiceId}: photos left ${left.photosLeft}, row left ${left.rowLeft}`)
      if (left.photosLeft || left.rowLeft) failures++
    }
    rmSync(tmp, { recursive: true, force: true })
    console.log(`\nlive test cost: $${cost.toFixed(4)}`)
    console.log(failures ? `${failures} check(s) failed` : 'all live check-off checks passed')
    process.exit(failures ? 1 : 0)
  })
