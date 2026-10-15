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

import { createHash, randomBytes } from 'crypto'
import firebaseAdmin from './firebase-admin'
import { consumeOnce } from './consume-once'
import { safeEqual } from './safe-equal'

/**
 * The native apps' console hand-off (AGL-3816): a sign-in finished in the
 * console, in the system browser or the platform's auth session, handed back
 * to the app that asked for it.
 *
 * ## Why the apps need it
 *
 * Three doors cannot be done natively. Workspace single sign-on runs the
 * workspace's SAML or OIDC provider through the console's `/sso` page. The
 * Windows build has no App Check attestation, so it cannot call Identity
 * Toolkit itself and signs in and up through the console instead (Zach,
 * 2026-10-15). And in all three the console page is the one place the
 * person's identity provider, consent and verification rules already run.
 *
 * ## The exchange
 *
 * 1. The app makes a PKCE pair (RFC 7636) and opens
 *    `/auth/native?challenge=…&redirect_uri=…&state=…`. The verifier never
 *    leaves the app.
 * 2. The person signs in there however the console offers. The page shows
 *    who they are signed in as and asks before continuing, so a sign-in
 *    already in the browser is never handed over silently (AGL-1415).
 * 3. {@link authorizeNativeHandoff}: the signed-in browser's ID token buys
 *    a one-time code, stored only as its SHA-256 with the uid, the identity
 *    pool, the challenge and the redirect it may be delivered to.
 * 4. The page navigates to the redirect with the code and the app's `state`.
 * 5. {@link redeemNativeHandoff}: the app presents the code, its verifier and
 *    the same redirect. The record is consumed in one transaction (single use
 *    is a property, {@link consumeOnce}) and a Firebase custom token is
 *    minted in the pool the account lives in.
 *
 * ## What refuses what
 *
 * - **A leaked code** (browser history, a shoulder): useless without the
 *   verifier, which only the app that started the flow holds.
 * - **A replayed code**: the record is consumed by the first redemption,
 *   whatever its outcome; two concurrent redemptions cannot both commit.
 * - **A late code**: 120 seconds, the time one navigation and one POST take.
 * - **A code sent elsewhere**: the redirect is fixed at authorization to the
 *   apps' own schemes or the desktop's loopback listener, and redemption must
 *   name the same one.
 * - **A support session handed to a device**: refused at authorization, as is
 *   an address nobody has confirmed (the console's routes refuse one anyway).
 */

/** Where the records live. Server-only: the rules deny every client. */
export const NATIVE_HANDOFFS_COLLECTION = 'nativeHandoffs'

/** How long a code stays redeemable. */
export const NATIVE_HANDOFF_TTL_MS = 120_000

/**
 * The apps' own return addresses: the Aglyn app's and Aglyn POS's URL schemes
 * (the platform's auth session hands the return straight to the app that
 * opened it), and on the desktop a listener on the loopback address (RFC 8252
 * §7.3) on a port the app chose.
 */
export const NATIVE_HANDOFF_APP_REDIRECTS: readonly string[] = [
  'aglyn://auth/handoff',
  'aglyn-pos://auth/handoff',
]

const LOOPBACK_REDIRECT = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):(\d{4,5})\/handoff$/

/** Whether `value` is a return address a hand-off may be delivered to. */
export function isNativeHandoffRedirect(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (NATIVE_HANDOFF_APP_REDIRECTS.includes(value)) return true
  const loopback = LOOPBACK_REDIRECT.exec(value)
  if (!loopback) return false
  const port = Number(loopback[1])
  return port >= 1024 && port <= 65535
}

/** An S256 PKCE challenge: 32 bytes of SHA-256, base64url without padding. */
export function isPkceChallenge(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

/** A PKCE verifier (RFC 7636 §4.1). */
export function isPkceVerifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value)
}

/** The S256 challenge for a verifier. */
export function pkceChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url')
}

/** The stored key for a code: its SHA-256, so the collection holds nothing redeemable. */
export function nativeHandoffKey(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

interface StoredNativeHandoff {
  uid: string
  tenantId: string | null
  challenge: string
  redirectUri: string
  expiresAtMs: number
}

/**
 * Mint a one-time code for the signed-in account. The caller has verified
 * the ID token and the redirect and challenge shapes.
 */
export async function authorizeNativeHandoff(input: {
  uid: string
  tenantId: string | null
  challenge: string
  redirectUri: string
  nowMs?: number
  firestore?: FirebaseFirestore.Firestore
}): Promise<{ code: string; expiresAtMs: number }> {
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  const code = randomBytes(32).toString('base64url')
  const expiresAtMs = (input.nowMs ?? Date.now()) + NATIVE_HANDOFF_TTL_MS
  const record: StoredNativeHandoff = {
    uid: input.uid,
    tenantId: input.tenantId ?? null,
    challenge: input.challenge,
    redirectUri: input.redirectUri,
    expiresAtMs,
  }
  await firestore
    .collection(NATIVE_HANDOFFS_COLLECTION)
    .doc(nativeHandoffKey(code))
    // `expiresAt` is the TTL policy's field (tools/scripts/lib/ttl-policies.mjs);
    // `expiresAtMs` is what redemption checks, so expiry never waits on TTL.
    .create({ ...record, expiresAt: new Date(expiresAtMs) })
  return { code, expiresAtMs }
}

/** Why a redemption was refused. */
export type NativeHandoffRefusal =
  | 'absent'
  | 'expired'
  | 'verifier'
  | 'redirect'

/**
 * Redeem a code, once. The record is deleted by the first redemption whatever
 * it decides, so a code that was presented with the wrong verifier cannot be
 * tried again with another.
 */
export async function redeemNativeHandoff(input: {
  code: string
  verifier: string
  redirectUri: string
  nowMs?: number
  firestore?: FirebaseFirestore.Firestore
}): Promise<
  | { ok: true; uid: string; tenantId: string | null }
  | { ok: false; reason: NativeHandoffRefusal }
> {
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = input.nowMs ?? Date.now()
  const ref = firestore
    .collection(NATIVE_HANDOFFS_COLLECTION)
    .doc(nativeHandoffKey(input.code))
  const result = await consumeOnce(firestore, ref, (data) => {
    const stored = data as Partial<StoredNativeHandoff>
    if (typeof stored.expiresAtMs !== 'number' || nowMs > stored.expiresAtMs) {
      return { accept: false, reason: 'expired', remove: true }
    }
    if (!safeEqual(pkceChallengeFor(input.verifier), stored.challenge)) {
      return { accept: false, reason: 'verifier', remove: true }
    }
    if (!safeEqual(input.redirectUri, stored.redirectUri)) {
      return { accept: false, reason: 'redirect', remove: true }
    }
    return {
      accept: true,
      remove: true,
      value: { uid: String(stored.uid ?? ''), tenantId: stored.tenantId ?? null },
    }
  })
  // Read structurally: `strictNullChecks` is off repo-wide (see consumeOnce).
  const outcome = result as {
    ok: boolean
    value: { uid: string; tenantId: string | null } | null
    reason: string | null
  }
  if (!outcome.ok || !outcome.value?.uid) {
    return { ok: false, reason: (outcome.reason ?? 'absent') as NativeHandoffRefusal }
  }
  return { ok: true, uid: outcome.value.uid, tenantId: outcome.value.tenantId }
}
