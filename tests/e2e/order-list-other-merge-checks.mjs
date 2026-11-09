// Patch 46: regression for a bug where an item with no distributor
// (null) showed up TWICE on the Order List, under two separate "Other"
// section headers. `byDistributor['other']` was built from
// `i.distributor ?? 'other'` (which already folded null into 'other'),
// while a SEPARATE `unmapped` list ALSO caught `!i.distributor` — so a
// null-distributor item matched both. Fixed by vendorKeyForItem()
// (src/lib/vendor-schedule.ts), the one shared key function every
// place that groups Order List items by vendor now uses. This is a
// pure-logic regression (no DB, no dev server) that directly exercises
// that function plus the exact bucket-construction shape order-
// list/page.tsx builds from it.
import { vendorKeyForItem } from '../../src/lib/vendor-schedule.ts'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

check("vendorKeyForItem(null) -> 'other'", vendorKeyForItem(null) === 'other')
check("vendorKeyForItem(undefined) -> 'other'", vendorKeyForItem(undefined) === 'other')
check("vendorKeyForItem('other') -> 'other' (same key as null)", vendorKeyForItem('other') === 'other')
check("vendorKeyForItem('bunzl') -> 'bunzl' (untouched)", vendorKeyForItem('bunzl') === 'bunzl')
check("vendorKeyForItem('balford') -> 'balford' (untouched)", vendorKeyForItem('balford') === 'balford')
check("vendorKeyForItem('seasonal') -> 'seasonal' (untouched)", vendorKeyForItem('seasonal') === 'seasonal')

// Mirrors order-list/page.tsx's byDistributor construction exactly: one
// filter pass, one key per item -- the actual shape that was broken
// (two separate filters with an overlapping predicate) before this fix.
const DISTRIBUTOR_ORDER = ['bunzl', 'balford', 'other', 'seasonal', 'discontinued']
const fakeItems = [
  { id: 'a', distributor: null },
  { id: 'b', distributor: 'other' },
  { id: 'c', distributor: 'bunzl' },
  { id: 'd', distributor: 'balford' },
]
const byDistributor = DISTRIBUTOR_ORDER.reduce((acc, d) => {
  acc[d] = fakeItems.filter((i) => vendorKeyForItem(i.distributor) === d)
  return acc
}, {})

check('a null-distributor item lands in the "other" bucket', byDistributor.other.some((i) => i.id === 'a'))
check('a literal "other"-distributor item lands in the SAME "other" bucket', byDistributor.other.some((i) => i.id === 'b'))
check('the "other" bucket has exactly 2 items (a and b), not duplicated', byDistributor.other.length === 2)

const totalBucketed = DISTRIBUTOR_ORDER.reduce((sum, d) => sum + byDistributor[d].length, 0)
check('every item appears in exactly ONE bucket total (sum of bucket sizes == input length)', totalBucketed === fakeItems.length)

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
