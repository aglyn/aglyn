/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The delivery token (AGL-2824): the ONE format both halves share.
 *
 * The platform mints it when it redirects a video request, and the Worker
 * verifies it before it serves a byte. Both import this module, so the two
 * can only disagree about the format by disagreeing about the secret. It uses
 * nothing but Web Crypto and the Web encoding globals, which both runtimes
 * have, and imports nothing, so the Worker bundles it as it stands.
 *
 * ## Shape
 *
 * `{payload}.{signature}`, both base64url. The payload is JSON:
 *
 * | field | meaning |
 * | -- | -- |
 * | `v` | format version, `1` |
 * | `k` | the object key the token is for — the only object it opens |
 * | `e` | expiry, epoch milliseconds |
 * | `o`, `h`, `m`, `s` | org, host, media id and CDN scope, when known |
 *
 * The ids open nothing. They ride inside the signature so that delivered
 * bytes can later be attributed to an organization without a lookup, and so
 * that nobody can reattribute a URL they were handed.
 *
 * The signature is HMAC-SHA256 over a domain-separated string, keyed by the
 * dedicated delivery secret. That secret is never the platform's
 * `TOKEN_SIGNING_SECRET`: it lives in a second runtime, and a leak there must
 * not be able to forge a commerce download or a gated-video link.
 *
 * ## What the verifier refuses
 *
 * A token that does not parse; one whose signature does not match (a changed
 * byte, or another secret); one that has expired; one that claims a lifetime
 * past {@link DELIVERY_TOKEN_MAX_TTL_MS} — no minter issues one, so a token
 * that claims one was never meant to exist; and one minted for a different
 * key than the one requested. The last is reported apart from the others,
 * because the Worker answers it as a missing object rather than a bad token.
 */

/** Format version, in the payload. */
export const DELIVERY_TOKEN_VERSION = 1

/** The query parameter that carries a token on a delivery URL. */
export const DELIVERY_TOKEN_PARAM = 'token'

/**
 * The longest lifetime a token may claim: the same four hours as a gated
 * video's viewing session, which is the longest link the platform issues.
 */
export const DELIVERY_TOKEN_MAX_TTL_MS = 4 * 60 * 60 * 1000

/**
 * Allowance for the minting and verifying clocks disagreeing: the platform
 * mints on one provider's machines and the Worker verifies on another's.
 */
export const DELIVERY_TOKEN_CLOCK_SKEW_MS = 60 * 1000

/**
 * The shortest secret either side accepts. `openssl rand -hex 32` makes 64
 * characters; anything under 32 is a placeholder that was never replaced.
 */
export const DELIVERY_SECRET_MIN_LENGTH = 32

/** Separates this signature from any other HMAC over the same secret. */
const SIGNING_CONTEXT = 'aglyn-media-delivery:v1:'

export interface DeliveryTokenClaims {
  /** The object key the token opens. */
  key: string
  expiresAtMs: number
  orgId: string | null
  hostId: string | null
  mediaId: string | null
  scope: string | null
}

export type DeliveryTokenRefusal =
  /** No secret, or one too short to trust. */
  | 'secret'
  /** Not a token at all. */
  | 'malformed'
  /** Altered, or signed with another secret. */
  | 'signature'
  | 'expired'
  /** Claims a lifetime no minter issues. */
  | 'too-long'
  /** A genuine token for another object. */
  | 'key'

export type DeliveryTokenVerdict =
  | { ok: true; claims: DeliveryTokenClaims }
  | { ok: false; refusal: DeliveryTokenRefusal }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

function usableSecret(secret: unknown): secret is string {
  return typeof secret === 'string' && secret.length >= DELIVERY_SECRET_MIN_LENGTH
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * Mints a token for `claims`. Throws on a secret that is missing or too
 * short, on an empty key, and on a lifetime that has run out or is longer
 * than {@link DELIVERY_TOKEN_MAX_TTL_MS} — the verifier would refuse each of
 * those, so a token minted for one would be dead on arrival.
 */
export async function mintDeliveryToken(
  claims: DeliveryTokenClaims,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!usableSecret(secret)) {
    throw new Error('The media delivery secret is missing or too short')
  }
  if (!claims.key) throw new Error('A delivery token needs an object key')
  const lifetime = claims.expiresAtMs - nowMs
  if (!Number.isFinite(lifetime) || lifetime <= 0) {
    throw new RangeError('A delivery token must expire in the future')
  }
  if (lifetime > DELIVERY_TOKEN_MAX_TTL_MS) {
    throw new RangeError(
      `A delivery token may live at most ${DELIVERY_TOKEN_MAX_TTL_MS} ms`,
    )
  }
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        v: DELIVERY_TOKEN_VERSION,
        k: claims.key,
        e: Math.floor(claims.expiresAtMs),
        ...(claims.orgId ? { o: claims.orgId } : {}),
        ...(claims.hostId ? { h: claims.hostId } : {}),
        ...(claims.mediaId ? { m: claims.mediaId } : {}),
        ...(claims.scope ? { s: claims.scope } : {}),
      }),
    ),
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret, 'sign'),
    encoder.encode(`${SIGNING_CONTEXT}${payload}`),
  )
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`
}

/**
 * Verifies a token for the object `key`. The signature is checked with Web
 * Crypto's own `verify`, which compares in constant time, before anything in
 * the payload is believed.
 */
export async function verifyDeliveryToken(
  token: unknown,
  secret: unknown,
  expected: { key: string; nowMs?: number },
): Promise<DeliveryTokenVerdict> {
  const refuse = (refusal: DeliveryTokenRefusal): DeliveryTokenVerdict => ({
    ok: false,
    refusal,
  })
  if (!usableSecret(secret)) return refuse('secret')
  if (typeof token !== 'string' || token.length > 4096) return refuse('malformed')
  const parts = token.split('.')
  if (parts.length !== 2) return refuse('malformed')
  const [payload, signature] = parts as [string, string]
  const signatureBytes = fromBase64Url(signature)
  if (!payload || !signatureBytes || signatureBytes.length !== 32) {
    return refuse('malformed')
  }
  const genuine = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret, 'verify'),
    signatureBytes,
    encoder.encode(`${SIGNING_CONTEXT}${payload}`),
  )
  if (!genuine) return refuse('signature')

  const payloadBytes = fromBase64Url(payload)
  if (!payloadBytes) return refuse('malformed')
  let body: Record<string, unknown>
  try {
    const parsed = JSON.parse(decoder.decode(payloadBytes))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return refuse('malformed')
    }
    body = parsed as Record<string, unknown>
  } catch {
    return refuse('malformed')
  }
  if (body['v'] !== DELIVERY_TOKEN_VERSION) return refuse('malformed')
  const key = body['k']
  const expiresAtMs = body['e']
  if (typeof key !== 'string' || !key) return refuse('malformed')
  if (typeof expiresAtMs !== 'number' || !Number.isFinite(expiresAtMs)) {
    return refuse('malformed')
  }
  const nowMs = expected.nowMs ?? Date.now()
  if (expiresAtMs <= nowMs) return refuse('expired')
  if (expiresAtMs - nowMs > DELIVERY_TOKEN_MAX_TTL_MS + DELIVERY_TOKEN_CLOCK_SKEW_MS) {
    return refuse('too-long')
  }
  if (key !== expected.key) return refuse('key')
  return {
    ok: true,
    claims: {
      key,
      expiresAtMs,
      orgId: optionalId(body['o']),
      hostId: optionalId(body['h']),
      mediaId: optionalId(body['m']),
      scope: optionalId(body['s']),
    },
  }
}
