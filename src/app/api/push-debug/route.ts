import { NextResponse } from 'next/server'
import { generateVAPIDKeys } from 'web-push'

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const SUBJECT = process.env.VAPID_EMAIL ?? ''

export async function GET() {
  const pubBytes = PUBLIC_KEY ? Buffer.from(PUBLIC_KEY, 'base64url') : null
  const privBytes = PRIVATE_KEY ? Buffer.from(PRIVATE_KEY, 'base64url') : null

  // Verify we can import the private key and derive a public key to compare
  let keyPairValid = false
  let derivedPublicKey = ''
  let importError = ''

  try {
    const jwk = {
      kty: 'EC', crv: 'P-256',
      x: pubBytes!.subarray(1, 33).toString('base64url'),
      y: pubBytes!.subarray(33, 65).toString('base64url'),
      d: privBytes!.toString('base64url'),
    }

    // Import private key
    const privateKey = await crypto.subtle.importKey(
      'jwk', { kty: 'EC', crv: 'P-256', d: jwk.d, x: jwk.x, y: jwk.y },
      { name: 'ECDH', namedCurve: 'P-256' },
      true, ['deriveKey']
    )

    // Export it back to get derived public x,y
    const exported = await crypto.subtle.exportKey('jwk', privateKey)
    derivedPublicKey = `04${Buffer.from(exported.x!, 'base64url').toString('hex')}${Buffer.from(exported.y!, 'base64url').toString('hex')}`

    const expectedPublicKey = pubBytes ? pubBytes.toString('hex') : ''
    keyPairValid = derivedPublicKey === expectedPublicKey
  } catch (e: unknown) {
    importError = e instanceof Error ? e.message : String(e)
  }

  // Generate a sample JWT for inspection
  let sampleJwt = ''
  let sampleJwtDecoded = null
  try {
    const pubB = Buffer.from(PUBLIC_KEY, 'base64url')
    const privB = Buffer.from(PRIVATE_KEY, 'base64url')
    const jwk = {
      kty: 'EC', crv: 'P-256',
      x: pubB.subarray(1, 33).toString('base64url'),
      y: pubB.subarray(33, 65).toString('base64url'),
      d: privB.toString('base64url'),
    }
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
    )
    const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      aud: 'https://web.push.apple.com',
      exp: Math.floor(Date.now() / 1000) + 43200,
      sub: SUBJECT.startsWith('mailto:') ? SUBJECT : `mailto:${SUBJECT}`,
    })).toString('base64url')
    const data = `${header}.${payload}`
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(data))
    sampleJwt = `${data}.${Buffer.from(sig).toString('base64url')}`
    sampleJwtDecoded = {
      header: JSON.parse(Buffer.from(header, 'base64url').toString()),
      payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
      sigLengthBytes: Buffer.from(sig).length,
    }
  } catch (e: unknown) {
    sampleJwt = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // Generate fresh key pair for comparison
  const freshKeys = generateVAPIDKeys()

  return NextResponse.json({
    envVars: {
      PUBLIC_KEY_SET: !!PUBLIC_KEY,
      PUBLIC_KEY_LENGTH_BYTES: pubBytes?.length ?? 0,
      PUBLIC_KEY_FIRST_BYTE_HEX: pubBytes ? pubBytes[0].toString(16) : 'n/a',
      PRIVATE_KEY_SET: !!PRIVATE_KEY,
      PRIVATE_KEY_LENGTH_BYTES: privBytes?.length ?? 0,
      SUBJECT,
    },
    keyPairValid,
    derivedPublicKeyHex: derivedPublicKey,
    storedPublicKeyHex: pubBytes?.toString('hex') ?? '',
    importError: importError || null,
    sampleJwt,
    sampleJwtDecoded,
    freshKeysForReplacement: freshKeys,
  })
}
