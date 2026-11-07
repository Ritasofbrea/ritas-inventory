// Direct Supabase REST access using the service-role key, for seeding and
// cleaning up ZZTEST fixtures. The key is read from process.env only --
// never hardcoded, never printed/logged. Run scripts with
// `node --env-file=.env.local` so these are populated from the existing
// (gitignored) .env.local, same file the app itself uses.
import { requiredEnv } from './config.mjs'

export async function rest(path, opts = {}) {
  const SUPABASE_URL = requiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const SERVICE_KEY = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(body)}`)
  return body
}
