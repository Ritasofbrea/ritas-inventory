import { NextResponse } from 'next/server'

// Forces this route to actually run on every request rather than being
// statically optimized at build time (it has no dynamic APIs otherwise, so
// Next.js could otherwise cache a single response forever) — needed so
// AUTO_RELOAD_DISABLED is genuinely read fresh per request, not frozen in.
export const dynamic = 'force-dynamic'

// Patch 30: tells an already-open page what build is CURRENTLY running on
// the server, so it can compare against its own baked-in NEXT_PUBLIC_BUILD_ID
// (set at build time, see next.config.ts) and notice when it's stale.
//
// Deliberately public — no requireRole, no cookie read — so a logged-out
// visitor can reach it and it can never produce a 401 that SessionGuard
// would mistake for "your session is invalid, go log in again." No
// secrets, nothing database-backed, nothing that can meaningfully fail;
// kept dead simple on purpose.
//
// AUTO_RELOAD_DISABLED is a plain server env var (not routed through
// next.config's `env` key / NEXT_PUBLIC_ prefix), so this route reads the
// live value on every request rather than a value baked into the bundle at
// build time — but Vercel itself only hands a function a new env var value
// on its NEXT deployment, so flipping this in the dashboard still needs a
// redeploy (no code change required) to actually take effect; see the
// patch 30 report for the exact steps.
export async function GET() {
  const build = process.env.NEXT_PUBLIC_BUILD_ID ?? 'local-dev'
  const autoReload = process.env.AUTO_RELOAD_DISABLED !== '1'
  return NextResponse.json(
    { build, autoReload },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } }
  )
}
