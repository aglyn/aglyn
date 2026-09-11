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

import { createHmac } from 'crypto'
import { safeEqual } from './safe-equal'

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
 * How long one viewing session of a purchased, gated video stays playable
 * (AGL-2814): four hours.
 *
 * The console's fifteen minutes is the wrong number for playback, because a
 * video is not fetched once. Every seek, every resume after a pause and every
 * buffer refill is another byte-range request under the same URL, so the
 * signature has to outlive the sitting rather than the first request. Four
 * hours covers a feature-length recording plus the breaks people take inside
 * one sitting.
 *
 * It stays hours, not days, because the URL is a bearer capability. Anyone who
 * copies it out of a buyer's network panel holds the whole film until it
 * expires, and past four hours a pause is long enough that asking the stream
 * endpoint again is the right answer anyway: that endpoint re-checks the
 * entitlement before it signs another session, and the gated player asks it
 * again on its own when a request under an expired URL fails.
 */
export const GATED_VIDEO_SESSION_TTL_MS = 4 * 60 * 60 * 1000

/**
 * How long a paid download's link works (AGL-2847): one hour.
 *
 * A download is one transfer rather than a sitting, so it needs far less than
 * a viewing session. It gets more than the console's fifteen minutes because a
 * large file on a slow connection can take longer than that to arrive, and a
 * download manager that resumes a broken transfer asks again under the same
 * URL. A refused resume sends the buyer back to the receipt link, which counts
 * another attempt against the download limit, so the window is sized to make
 * that rare while a forwarded link still dies the same evening.
 */
export const PAID_DOWNLOAD_LINK_TTL_MS = 60 * 60 * 1000

/**
 * The longest lifetime any signature may claim, enforced by the VERIFIER as
 * well as the minter.
 *
 * `exp` is inside the signed payload, so nobody without the secret can stretch
 * it. What this bounds is the platform's own mistakes: a minter that one day
 * passes a day where it meant an hour would otherwise hand out links nothing
 * downstream ever questions.
 */
export const MEDIA_SIGNATURE_MAX_TTL_MS = GATED_VIDEO_SESSION_TTL_MS

/**
 * Allowance for the minting and verifying instances disagreeing about the
 * time. The console signs and the tenant app verifies, on different machines.
 */
const MEDIA_SIGNATURE_CLOCK_SKEW_MS = 60 * 1000

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
 * Compared with `safeEqual`, which is constant-time on equal-length inputs and
 * length-checks first because `timingSafeEqual` THROWS on a length mismatch —
 * and an attacker controls that length, so an exception here would be a 500
 * where a 403 belongs. That dance was hand-written in six files before
 * AGL-1902 lifted it into one.
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
  // Refused whatever the signature says: no minter issues a lifetime this
  // long, so a link that claims one was never meant to exist.
  if (exp - nowMs > MEDIA_SIGNATURE_MAX_TTL_MS + MEDIA_SIGNATURE_CLOCK_SKEW_MS) {
    return false
  }
  let expected: string
  try {
    expected = signMediaAccess(scope, mediaId, exp)
  } catch {
    // Secret missing — fail closed rather than serving the bytes.
    return false
  }
  return safeEqual(sig, expected)
}

/** The query string that carries a signature on a CDN URL. */
export function mediaSignatureQuery(signature: MediaSignature): string {
  return `exp=${signature.exp}&sig=${encodeURIComponent(signature.sig)}`
}

/**
 * Throws unless `ttlMs` is a lifetime the platform issues: positive, and no
 * longer than {@link MEDIA_SIGNATURE_MAX_TTL_MS}.
 *
 * It THROWS rather than clamping. The verifier refuses a longer link, so
 * minting one would hand out a URL that is dead on arrival, and a quiet clamp
 * would hide the caller asking for the wrong thing. Exported for the minters
 * that sign something other than a CDN URL, such as a Storage read, so every
 * expiring link the platform hands out obeys the same bound.
 */
export function assertMediaSignatureTtl(ttlMs: number): void {
  if (!(ttlMs > 0) || ttlMs > MEDIA_SIGNATURE_MAX_TTL_MS) {
    throw new RangeError(
      `A media link lifetime must be between 1 ms and ${MEDIA_SIGNATURE_MAX_TTL_MS} ms`,
    )
  }
}

/**
 * Mints a signature valid for `ttlMs` from now — {@link MEDIA_SIGNATURE_TTL_MS}
 * unless the caller names a longer window, bounded by
 * {@link assertMediaSignatureTtl}.
 */
export function mintMediaSignature(
  scope: string,
  mediaId: string,
  nowMs: number = Date.now(),
  ttlMs: number = MEDIA_SIGNATURE_TTL_MS,
): MediaSignature {
  assertMediaSignatureTtl(ttlMs)
  const exp = nowMs + ttlMs
  return { exp, sig: signMediaAccess(scope, mediaId, exp) }
}
