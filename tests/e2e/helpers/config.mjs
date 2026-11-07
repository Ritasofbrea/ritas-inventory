// Central env-var access for the e2e suite. No secrets are hardcoded
// anywhere in tests/e2e/ -- every value comes from process.env, populated
// by running with `node --env-file=.env.local` (see ../README.md) or real
// exported env vars. Throws immediately, with the exact var name, if
// something required is missing.

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

export function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var ${name}. Set it in .env.local and run with --env-file=.env.local -- see tests/e2e/README.md.`)
  }
  return value
}
