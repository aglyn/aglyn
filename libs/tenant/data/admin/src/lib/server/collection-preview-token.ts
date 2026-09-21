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
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'

/**
 * A capability to see ONE not-yet-live collection entry on the LIVE site
 * (AGL-3205).
 *
 * The console is `app.aglyn.com`; a tenant is `aglyn.com`, `{sub}.aglyn.app`
 * and every customer's own domain. A console session does not carry to any of
 * them — different registrable domains, storage-partitioned — so "I am logged
 * in, let me see the draft" cannot be answered by a session at all. What DOES
 * carry is a URL, so the capability travels as a signed query parameter and is
 * verified by the tenant server before it loads anything withheld.
 *
 * ## What the signature is over, and why each part is in it
 *
 * `{hostId}:{collectionSlug}:{entrySlug}:{exp}`, under the
 * `collection-preview:` context prefix.
 *
 * - `hostId` — a token minted for one site must not work on another. The
 *   tenant compares it against the host it RESOLVED from the request, never
 *   against anything the URL says, so presenting `aglyn.com`'s token to
 *   another customer's domain fails on the host it actually reached.
 * - `collectionSlug` + `entrySlug` — the scope is one post, not "previews are
 *   on for this site". The verifier is handed the slugs parsed from the route
 *   and refuses a mismatch, so a token for `/blog/post-a` cannot be edited
 *   into `/blog/post-b` or into `/news/post-a` and reveal either.
 * - `exp` — inside the payload, so nobody without the secret can stretch it.
 *
 * ## The secret
 *
 * `TOKEN_SIGNING_SECRET`, the shared fail-closed secret the media, download,
 * stream, edit-hint and form-binding signatures already use — for the reason
 * `media-signing.ts` gives about not adding a second thing to keep in step
 * across two apps. The `collection-preview:` prefix domain-separates it from
 * every one of those, so none of them can be replayed as a preview grant and
 * a preview grant cannot be replayed as any of them.
 *
 * ## What it is NOT
 *
 * It is not an edit session, it names no user, and it grants nothing but
 * "render this one entry as though it were live". The render it authorizes
 * writes nothing: a preview never publishes a due schedule and never records
 * a refusal, because nothing but a PUBLIC render may move a content entry's
 * state (see `flipDueEntry`).
 */

/**
 * Two hours.
 *
 * The request this was built for is "send me their preview links" — the link
 * is meant to leave the console, ride a chat message and be opened on whatever
 * device is to hand, so a window measured in minutes fails at the only job it
 * has. Two hours covers a sitting: read three posts, come back after a call.
 *
 * It stays hours and not days because a URL is a bearer capability with no
 * revocation, and because URLs are LOGGED — by the platform, by proxies, by
 * whatever chat client carried it. The same property keeps the media
 * signature at fifteen minutes, the gated-video session at four hours and the
 * edit-hint bounce at sixty seconds. Past one sitting the right answer is to
 * ask the console for another link, which re-checks that the person may still
 * edit that site before it signs anything.
 */
export const COLLECTION_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000

/**
 * The longest lifetime any preview token may claim, enforced by the VERIFIER
 * as well as the minter — the guard `MEDIA_SIGNATURE_MAX_TTL_MS` describes.
 * `exp` is signed, so this bounds OUR mistakes rather than an attacker's: a
 * minter that one day passes a day where it meant two hours hands out links
 * nothing downstream would otherwise question.
 */
export const COLLECTION_PREVIEW_MAX_TTL_MS = COLLECTION_PREVIEW_TTL_MS

/**
 * Allowance for the minting and verifying machines disagreeing about the
 * time. The console signs and the tenant verifies, on different instances —
 * the same minute `media-signing.ts` allows itself.
 */
const CLOCK_SKEW_MS = 60 * 1000

/** Version tag, mirroring the edit-hint token's debuggability rationale. */
const TOKEN_PREFIX = 'aglyn-entry-preview-v1'

/** The longest token this verifier will even look at. */
const TOKEN_MAX_LENGTH = 4096

export interface CollectionPreviewScope {
  /** The host the entry belongs to — the resolved one, never a claimed one. */
  hostId: string
  /** The collection's public slug, as the route spells it. */
  collectionSlug: string
  /** The entry's public slug, as the route spells it. */
  entrySlug: string
}

export interface CollectionPreviewClaims extends CollectionPreviewScope {
  /** Expiry, epoch ms. */
  exp: number
}

export interface MintedCollectionPreviewToken {
  token: string
  expiresAtMs: number
}

function signPayload(payloadB64: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`collection-preview:${payloadB64}`)
    .digest('base64url')
}

/**
 * Mints a preview grant for a scope the caller has ALREADY authorized. The
 * mint itself checks nothing but its own arguments — the console route around
 * it proves the caller may edit this site's content before it calls.
 */
export function mintCollectionPreviewToken(
  scope: CollectionPreviewScope,
  nowMs: number = Date.now(),
): MintedCollectionPreviewToken {
  const { hostId, collectionSlug, entrySlug } = scope
  if (!hostId || !collectionSlug || !entrySlug) {
    throw new Error('hostId, collectionSlug and entrySlug are required')
  }
  const exp = nowMs + COLLECTION_PREVIEW_TTL_MS
  const claims: CollectionPreviewClaims = { hostId, collectionSlug, entrySlug, exp }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  )
  return { token: `${TOKEN_PREFIX}.${payload}.${signPayload(payload)}`, expiresAtMs: exp }
}

/**
 * Whether this presented token authorizes THIS scope right now.
 *
 * Answers a boolean rather than the claims, deliberately: the only thing a
 * caller may do with a verified preview token is reveal the entry the ROUTE
 * already named, so handing back a decoded `entrySlug` would invite a caller
 * to trust the token's spelling over the route's and re-open the substitution
 * this scoping exists to close.
 *
 * Refuses — with no distinction the caller can act on — a token that is
 * malformed, the wrong version, tampered with, expired, claiming a lifetime
 * past {@link COLLECTION_PREVIEW_MAX_TTL_MS}, minted for another host, or
 * minted for another collection or entry. A deploy with no signing secret
 * refuses too, like every signature in this family.
 */
export function verifyCollectionPreviewToken(
  token: unknown,
  scope: CollectionPreviewScope,
  nowMs: number = Date.now(),
): boolean {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > TOKEN_MAX_LENGTH
  ) {
    return false
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return false
  const [, payload, sig] = parts
  let expected: string
  try {
    expected = signPayload(payload)
  } catch {
    // Secret missing — refuse rather than trusting anything.
    return false
  }
  // `safeEqual`, not a bare `===`: constant-time on equal-length input and
  // length-checked first, because `timingSafeEqual` throws on the length an
  // attacker controls.
  if (!safeEqual(sig, expected)) return false

  let claims: CollectionPreviewClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  const exp = Number(claims?.exp)
  if (!Number.isFinite(exp)) return false
  if (exp <= nowMs) return false
  // The platform-mistake bound. Skew is allowed on the FLOOR of the window
  // (the two clocks disagreeing) and not added to the ceiling, so a token that
  // claims more than the maximum is refused however the clocks read.
  if (exp - nowMs > COLLECTION_PREVIEW_MAX_TTL_MS + CLOCK_SKEW_MS) return false

  // Every part of the scope, and all three compared against what the REQUEST
  // resolved rather than what the token says about itself.
  return (
    claims.hostId === scope.hostId &&
    claims.collectionSlug === scope.collectionSlug &&
    claims.entrySlug === scope.entrySlug
  )
}
