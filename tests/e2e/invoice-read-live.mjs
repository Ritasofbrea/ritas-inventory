// Patch 65: ONE live check of the real invoice reader. SPENDS MONEY (about
// $0.05-0.10 per page with Opus 5.5), so it never runs by default and is
// NOT in run-all.mjs. Run on purpose only:
//   npm run test:e2e:invoice-read-live
// against `npm run dev` WITH the real ANTHROPIC_API_KEY in .env.local.
//
// Reads 2 real pages from test-invoices/ (gitignored, never committed):
// one Balford, one Bunzl. Each goes into its own ZZTEST draft through the
// real scan routes (POST /api/invoices -> photo-upload -> PATCH), then
// through POST /api/invoices/read. Photos are converted the way the app
// does it (2400px long edge, JPEG 0.8) with macOS `sips` into a temp folder
// outside the repo. Both drafts and their photos are removed by id at the end.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loginAsOwner, apiFetch } from './helpers/auth.mjs'
import { createDraftWithPages, deleteInvoiceById, getInvoice } from './helpers/invoices.mjs'

if (process.env.INVOICE_READ_LIVE !== '1') {
  console.log('SKIP  invoice-read-live: set INVOICE_READ_LIVE=1 to run (spends real API money).')
  process.exit(0)
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PHOTOS = join(ROOT, 'test-invoices')
// Opus 5.5 list prices, USD per million tokens (checked 2026-11-11).
const PRICE = { 'claude-opus-5-5': { in: 4, out: 20 }, 'claude-sonnet-5-5': { in: 2, out: 10 } }

const CASES = [
  {
    vendor: 'balford',
    file: 'IMG_6996.HEIC',
    invoice_number: '24168404',
    invoice_date: '11/07/26',
    lines: { '302446': [8, 'CS'], '302447': [4, 'CS'], '34944': [1, 'CS'], '307050': [1, 'CS'] },
  },
  {
    vendor: 'bunzl',
    file: 'IMG_6998.HEIC',
    invoice_number: '70282859',
    invoice_date: '10/30/26',
    lines: {
      '53790032': [1, 'CS'], '53790132': [1, 'CS'], '53790065': [1, 'CS'], '53790138': [1, 'CS'], '75006280': [1, 'CS'],
      K1700001: [1, 'CS'], L6390018: [1, 'CS'], L6390025: [1, 'CS'], J6990048: [1, 'CS'], J6990075: [2, 'CS'],
    },
  },
]

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}

const created = []
const tmp = mkdtempSync(join(tmpdir(), 'invoice-live-'))
let totalCost = 0

async function main() {
  const owner = loginAsOwner()
  for (const c of CASES) {
    const src = join(PHOTOS, c.file)
    if (!existsSync(src)) throw new Error(`missing ${c.file} in test-invoices/`)
    const out = join(tmp, c.file.replace(/\.HEIC$/i, '.jpg'))
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '2400', src, '--out', out], { stdio: 'ignore' })
    const jpeg = readFileSync(out)

    const inv = await createDraftWithPages(owner.cookie, c.vendor, [jpeg])
    created.push(inv.id)
    const t0 = Date.now()
    const res = await apiFetch('/api/invoices/read', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id, page: 1 }) })
    const ms = Date.now() - t0
    const body = await res.json()
    check(`${c.vendor}: route answered 200`, res.status === 200, `${res.status} ${JSON.stringify(body)}`)
    if (!res.ok) continue

    const row = await getInvoice(inv.id)
    const usage = row.raw_extraction?.pages?.['1']?.usage ?? { input_tokens: 0, output_tokens: 0 }
    const price = PRICE[body.model] ?? PRICE['claude-opus-5-5']
    const cost = (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1e6
    totalCost += cost
    console.log(`      ${c.vendor}: ${(ms / 1000).toFixed(1)}s, model ${body.model}, in=${usage.input_tokens} out=${usage.output_tokens}, $${cost.toFixed(4)}`)

    const r = body.result
    check(`${c.vendor}: vendor read as ${c.vendor}`, r.vendor === c.vendor, r.vendor)
    check(`${c.vendor}: invoice number ${c.invoice_number}`, r.invoice_number === c.invoice_number, r.invoice_number)
    check(`${c.vendor}: invoice date ${c.invoice_date}`, r.invoice_date === c.invoice_date, r.invoice_date)
    check(`${c.vendor}: ${Object.keys(c.lines).length} lines`, r.lines.length === Object.keys(c.lines).length, `${r.lines.length}`)
    for (const [code, [qty, unit]] of Object.entries(c.lines)) {
      const l = r.lines.find((x) => x.vendor_code === code)
      check(`${c.vendor}: ${code} = ${qty} ${unit}`, !!l && l.qty_shipped === qty && l.invoice_unit === unit, JSON.stringify(l))
    }
    check(`${c.vendor}: status 'read' (single-page invoice)`, row.status === 'read', row.status)
    check(`${c.vendor}: read_model saved`, row.read_model === body.model, row.read_model)
    console.log(`      ${c.vendor}: totals check -> ${JSON.stringify(body.totals_check)}`)
  }
}

main()
  .catch((err) => {
    console.error('FAIL  live test crashed:', err?.message ?? err)
    failures++
  })
  .finally(async () => {
    for (const id of created) {
      const left = await deleteInvoiceById(id).catch(() => ({ photosLeft: -1, rowLeft: true }))
      console.log(`cleanup ${id}: photos left ${left.photosLeft}, row left ${left.rowLeft}`)
      if (left.photosLeft || left.rowLeft) failures++
    }
    rmSync(tmp, { recursive: true, force: true })
    console.log(`\nlive test cost: $${totalCost.toFixed(4)}`)
    console.log(failures ? `${failures} check(s) failed` : 'all live checks passed')
    process.exit(failures ? 1 : 0)
  })
