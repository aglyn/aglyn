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

/**
 * Signed access to a PRIVATE media asset (AGL-1051).
 *
 * The rest of this project controls *discovery and use* — `visibleTo` says
 * which sites may reference an asset. It cannot control secrecy, because
 * the CDN route is unauthenticated by necessity (it serves images to
 * anonymous visitors) and a URL, once shared, is a bearer capability with
 * no revocation. An asset marked `private` opts out of that model: it gets
 * no `cdnPath`, and the only way to fetch it is a signature that expires.
 *
 * Signed with the shared, fail-closed `TOKEN_SIGNING_SECRET`
 * (docs/COMMERCE_TOKEN_SIGNING.md) rather than a new secret — it is already
 * provisioned as one team-level variable on both the console and tenant
 * projects, and a second secret would be a second thing to keep in step
 * across two apps, which is the failure mode that doc exists to describe.
 * The `media:` prefix namespaces this payload so a token minted here can
 * never be replayed as a download or stream token.
 */
export function tokenSigningSecret(): string {
  const secret = process.env['TOKEN_SIGNING_SECRET']
  // No fallback, deliberately. AGL-509 was `STRIPE_SECRET_KEY ?? 'aglyn'`:
  // every payload is built from public identifiers, so a default key makes
  // signatures forgeable on any deploy missing the real one.
  if (!secret) throw new Error('TOKEN_SIGNING_SECRET is not configured')
  return secret
}

/**
 * Fifteen minutes, matching the gated-video stream token.
 *
 * The TTL is the only revocation this scheme has, so it is deliberately
 * short: long enough to open a link and download the file, too short for a
 * URL pasted into a chat to stay useful. Console previews re-mint per view.
 */
export const MEDIA_SIGNATURE_TTL_MS = 15 * 60 * 1000

/**
 * The signature over one asset at one expiry.
 *
 * `scope` is inside the payload, not just alongside it. Without it a
 * signature minted for `org:{orgId}` would verify against
 * `hosts/{hostId}` — different documents, same id space — so a caller
 * authorized for one library could read the other's asset of the same id.
 */
export function signMediaAccess(
  scope: string,
  mediaId: string,
  expiresAtMs: number,
): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`media:${scope}:${mediaId}:${expiresAtMs}`)
    .digest('hex')
    .slice(0, 32)
}

export interface MediaSignature {
  exp: number
  sig: string
}

/**
 * Whether a presented signature authorizes this asset right now.
 *
 * Compared with `timingSafeEqual` on equal-length buffers. The candidate is
 * length-checked first because `timingSafeEqual` THROWS on a length
 * mismatch, and an attacker controls that length — an exception here would
 * be a 500 where a 403 belongs.
 */
export function verifyMediaAccess(
  scope: string,
  mediaId: string,
  presented: Partial<MediaSignature> | undefined,
  nowMs: number = Date.now(),
): boolean {
  const exp = Number(presented?.exp ?? 0)
  const sig = String(presented?.sig ?? '')
  if (!Number.isFinite(exp) || exp <= nowMs) return false
  let expected: string
  try {
    expected = signMediaAccess(scope, mediaId, exp)
  } catch {
    // Secret missing — fail closed rather than serving the bytes.
    return false
  }
  if (sig.length !== expected.length) return false
  return timingSafeEqual(
    new Uint8Array(Buffer.from(sig)),
    new Uint8Array(Buffer.from(expected)),
  )
}

/** The query string that carries a signature on a CDN URL. */
export function mediaSignatureQuery(signature: MediaSignature): string {
  return `exp=${signature.exp}&sig=${encodeURIComponent(signature.sig)}`
}

/** Mints a signature valid for {@link MEDIA_SIGNATURE_TTL_MS} from now. */
export function mintMediaSignature(
  scope: string,
  mediaId: string,
  nowMs: number = Date.now(),
): MediaSignature {
  const exp = nowMs + MEDIA_SIGNATURE_TTL_MS
  return { exp, sig: signMediaAccess(scope, mediaId, exp) }
}
