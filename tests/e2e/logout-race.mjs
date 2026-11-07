// Home/Switch logout race regression (SessionGuard.tsx / Navigation.tsx):
// a deliberate Home/Switch tap calls POST /api/logout then navigates to
// /login. If that call fails or hangs, /login's own "returning staff
// device" auto-skip check could otherwise send the device straight back to
// /todo, making a deliberate exit look like it did nothing. The fix is
// SKIP_LOGIN_AUTOSKIP_KEY in sessionStorage, set right before navigating.
// This is the one suite in tests/e2e/ that needs a real browser (route
// interception + a button click), hence the only one requiring Playwright.
import { chromium } from 'playwright'
import { BASE_URL } from './helpers/config.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

async function run() {
  const browser = await chromium.launch()

  // --- A: failed logout request (aborted/network error) ---
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.goto(`${BASE_URL}/login`)
    await page.getByRole('button', { name: 'To-Do List' }).click()
    await page.waitForURL('**/todo')

    await page.route('**/api/logout', (route) => route.abort('failed'))

    const t0 = Date.now()
    await page.getByRole('button', { name: /Home|Switch/ }).click()
    await page.waitForURL('**/login', { timeout: 6000 })
    const elapsed = Date.now() - t0

    const hasThreeButtons = await page.getByRole('button', { name: "I'm an Owner" }).isVisible()
    check(`A (failed logout request): reached /login with three buttons (${elapsed}ms)`, hasThreeButtons)
    check(`A: failed fast, not hung (${elapsed}ms < 3500ms)`, elapsed < 3500)
    await ctx.close()
  }

  // --- B: hung logout request (never resolves) ---
  {
    const ctx = await browser.newContext({ serviceWorkers: 'block' })
    const page = await ctx.newPage()
    await page.goto(`${BASE_URL}/login`)
    await page.getByRole('button', { name: 'To-Do List' }).click()
    await page.waitForURL('**/todo')

    await page.route('**/api/logout', () => {
      // Intentionally never fulfill/abort -- simulates a hung server/network.
    })

    const t0 = Date.now()
    await page.getByRole('button', { name: /Home|Switch/ }).click()
    await page.waitForURL('**/login', { timeout: 6000 })
    const elapsed = Date.now() - t0

    const hasThreeButtons = await page.getByRole('button', { name: "I'm an Owner" }).isVisible()
    check(`B (hung logout request): reached /login with three buttons (${elapsed}ms)`, hasThreeButtons)
    check(`B: timed out at ~3s as designed (2900-4000ms), got ${elapsed}ms`, elapsed >= 2900 && elapsed <= 4000)
    await ctx.close()
  }

  await browser.close()
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
