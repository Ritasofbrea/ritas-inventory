import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/session'

// Clears the session cookie. The client still calls clearRole() itself for
// its own localStorage copy (src/lib/auth.ts) — unchanged, this just closes
// the server-side half.
export async function POST() {
  const response = NextResponse.json({ success: true })
  clearSessionCookie(response)
  return response
}
