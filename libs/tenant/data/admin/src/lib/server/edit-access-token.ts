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

import { createHmac, timingSafeEqual } from 'crypto'
import { tokenSigningSecret } from './media-signing'

/**
 * Edit-access tokens for the tenant admin bar (admin edit bar, AGL-1302
 * follow-on).
 *
 * The console session lives first-party on app.aglyn.com; published sites
 * live on aglyn.app subdomains and customer domains, and with third-party
 * cookies gone an embedded console frame cannot see its own session. So the
 * console VERIFIES edit access server-side (the same host `memberRoles`
 * admin/editor or org-role-above-viewer gate the presence broker applies for
 * co-editing) and bakes the verdict into a short-lived token the tenant can
 * check without asking anyone: `{hostId, uid, exp}` HMAC-signed with the
 * shared, fail-closed `TOKEN_SIGNING_SECRET` (docs/COMMERCE_TOKEN_SIGNING.md)
 * — already provisioned on both the console and tenant projects, which is the
 * whole reason to reuse it rather than mint a second secret to keep in step.
 *
 * Deliberately NOT an auth system: the token grants nothing but the admin
 * bar's convenience UI plus a read of routing facts the page HTML already
 * carries. It is scoped to ONE host, expires in {@link
 * EDIT_ACCESS_TOKEN_TTL_MS}, and revocation is the `release_edit_bar` flag —
 * flipping it off makes every outstanding token useless at the verify site.
 * The `edit-bar:` context string domain-separates the signature so a token
 * minted here can never replay as a media or commerce signature (they share
 * the secret, so the namespace is the isolation).
 */

/** 30 minutes — well under the ≤1h ceiling; reconnecting is one click. */
export const EDIT_ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000

/**
 * Version tag on the wire so a future claim change can reject old tokens by
 * shape instead of by signature failure (clearer to debug).
 */
const TOKEN_PREFIX = 'aglyn-edit-bar-v1'

export interface EditAccessClaims {
  /** The ONE host the console proved the caller may edit. */
  hostId: string
  uid: string
  /** Expiry, epoch ms. */
  exp: number
}

function signPayload(payloadB64: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`edit-bar:${payloadB64}`)
    .digest('base64url')
}

export interface MintedEditAccessToken {
  token: string
  expiresAtMs: number
}

/**
 * Mints a token asserting "this uid may edit this host, until exp". Only the
 * console's `/api/edit-access/token` route calls this, AFTER verifying the
 * caller's Firebase ID token and membership — the mint itself checks nothing,
 * which is why it must never be reachable from unverified input.
 */
export function mintEditAccessToken(
  hostId: string,
  uid: string,
  nowMs: number = Date.now(),
): MintedEditAccessToken {
  if (!hostId || !uid) throw new Error('hostId and uid are required')
  const exp = nowMs + EDIT_ACCESS_TOKEN_TTL_MS
  const claims: EditAccessClaims = { hostId, uid, exp }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  )
  // The signature covers the ENCODED payload, so there is exactly one byte
  // string being signed and verified — no re-serialization ambiguity.
  return {
    token: `${TOKEN_PREFIX}.${payload}.${signPayload(payload)}`,
    expiresAtMs: exp,
  }
}

/**
 * Verifies a presented token and returns its claims, or `null` for anything
 * else — expired, tampered, malformed, wrong version, or a deploy with no
 * signing secret (fail closed, like the media signatures). Callers must still
 * check `claims.hostId` against the host actually being served.
 */
export function verifyEditAccessToken(
  token: unknown,
  nowMs: number = Date.now(),
): EditAccessClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payload, sig] = parts
  let expected: string
  try {
    expected = signPayload(payload)
  } catch {
    // Secret missing — refuse rather than trusting anything.
    return null
  }
  // Length-checked before timingSafeEqual, which THROWS on mismatched
  // lengths an attacker controls — a 500 where a 401 belongs.
  if (sig.length !== expected.length) return null
  if (
    !timingSafeEqual(
      new Uint8Array(Buffer.from(sig)),
      new Uint8Array(Buffer.from(expected)),
    )
  ) {
    return null
  }
  let claims: EditAccessClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const exp = Number(claims?.exp)
  if (!Number.isFinite(exp) || exp <= nowMs) return null
  if (typeof claims.hostId !== 'string' || !claims.hostId) return null
  if (typeof claims.uid !== 'string' || !claims.uid) return null
  return { hostId: claims.hostId, uid: claims.uid, exp }
}
