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
 * Editor-presence HINT tokens for the tenant admin bar on `*.aglyn.app`
 * (AGL-1842, the cross-site half AGL-1829 could not reach).
 *
 * The console session lives on `app.aglyn.com`; `*.aglyn.app` is a different
 * registrable domain, so neither the AGL-1829 hint cookie nor the silent
 * iframe probe can cross over — storage partitioning keeps the two worlds
 * apart, correctly. What CAN cross is a top-level navigation: at console
 * sign-in the browser is bounced once through
 * `https://console.aglyn.app/api/edit-hint/set?sig=<bounce token>` and back,
 * and in that first-party moment the tenant app plants a signed hint cookie
 * on `Domain=.aglyn.app` that every tenant subdomain can present to its own
 * server afterwards.
 *
 * Two kinds, deliberately non-interchangeable:
 *
 * - `bounce` — rides the redirect URL once. URLs are logged and shareable,
 *   so its TTL is seconds ({@link EDIT_HINT_BOUNCE_TTL_MS}).
 * - `cookie` — the planted `aglyn_edit_hint` value, HttpOnly, living the
 *   {@link EDIT_HINT_COOKIE_TTL_MS} window between console visits.
 *
 * The kind is INSIDE the signed context string, so a leaked 60-second bounce
 * URL can never be replayed as a week-long cookie, and a stolen cookie value
 * can never be planted elsewhere through the bounce endpoint. The `edit-hint:`
 * prefix domain-separates both from the `edit-bar:`/`media:`/commerce
 * signatures sharing `TOKEN_SIGNING_SECRET`.
 *
 * A hint is NOT edit access: it names a uid and nothing else. Everything
 * real happens server-side at the tenant's `/api/edit-access/exchange`,
 * which re-authorizes that uid against the specific host being viewed with
 * the same membership gate the console's token mint applies. A forged,
 * expired, or stale hint costs one refused POST.
 */

/** Seconds, not minutes: the bounce URL is single-use inside one redirect. */
export const EDIT_HINT_BOUNCE_TTL_MS = 60 * 1000

/** 7 days — matches the AGL-1829 marker cookie's refresh cadence. */
export const EDIT_HINT_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The HttpOnly signed hint cookie on `Domain=.aglyn.app`. Sibling of the
 * JS-visible `aglyn_editor=1` marker (`EDITOR_HINT_COOKIE`), which the
 * admin-bar stub reads to arm; this one only ever travels back to the
 * tenant's own exchange route, where it is verified server-side.
 */
export const EDIT_HINT_COOKIE = 'aglyn_edit_hint'

/** Version tag, mirroring the edit-access token's debuggability rationale. */
const TOKEN_PREFIX = 'aglyn-edit-hint-v1'

export type EditHintKind = 'bounce' | 'cookie'

export interface EditHintClaims {
  uid: string
  /** Expiry, epoch ms. */
  exp: number
}

function signPayload(kind: EditHintKind, payloadB64: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`edit-hint:${kind}:${payloadB64}`)
    .digest('base64url')
}

export interface MintedEditHintToken {
  token: string
  expiresAtMs: number
}

/**
 * Mints a hint of the given kind for a uid the caller has ALREADY verified
 * (the console route verifies a Firebase ID token; the bounce endpoint
 * verifies a `bounce` hint). The mint itself checks nothing.
 */
export function mintEditHintToken(
  kind: EditHintKind,
  uid: string,
  nowMs: number = Date.now(),
): MintedEditHintToken {
  if (!uid) throw new Error('uid is required')
  const exp =
    nowMs +
    (kind === 'bounce' ? EDIT_HINT_BOUNCE_TTL_MS : EDIT_HINT_COOKIE_TTL_MS)
  const claims: EditHintClaims = { uid, exp }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  )
  return {
    token: `${TOKEN_PREFIX}.${payload}.${signPayload(kind, payload)}`,
    expiresAtMs: exp,
  }
}

/**
 * Verifies a presented hint AS the stated kind and returns its claims, or
 * `null` for anything else — expired, tampered, malformed, wrong version,
 * wrong KIND (the replay wall), or a deploy with no signing secret (fail
 * closed, like every signature in this family).
 */
export function verifyEditHintToken(
  kind: EditHintKind,
  token: unknown,
  nowMs: number = Date.now(),
): EditHintClaims | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payload, sig] = parts
  let expected: string
  try {
    expected = signPayload(kind, payload)
  } catch {
    // Secret missing — refuse rather than trusting anything.
    return null
  }
  // Length-checked before timingSafeEqual, which THROWS on attacker-length
  // input — a 500 where a refusal belongs (same note as edit-access-token).
  if (sig.length !== expected.length) return null
  if (
    !timingSafeEqual(
      new Uint8Array(Buffer.from(sig)),
      new Uint8Array(Buffer.from(expected)),
    )
  ) {
    return null
  }
  let claims: EditHintClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const exp = Number(claims?.exp)
  if (!Number.isFinite(exp) || exp <= nowMs) return null
  if (typeof claims.uid !== 'string' || !claims.uid) return null
  return { uid: claims.uid, exp }
}
