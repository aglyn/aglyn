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
 * Per-device session revocation (AGL-1959).
 *
 * AGL-2318 shipped the device LIST and said outright why it stopped there:
 * "REVOCATION IS DELIBERATELY ABSENT. It needs session invalidation, which is
 * a larger piece … a 'sign out everywhere' button that did not actually sign
 * anyone out would be worse than no button." This is that piece.
 *
 * ## What actually invalidates, and what only looks like it
 *
 * Deleting the `users/{uid}/devices/{deviceId}` row would hide the row and
 * revoke nothing: the browser still holds a 14-day `__session` cookie and a
 * Firebase refresh token, and it would also make the device read as NEW on its
 * next sign-in, re-alerting the owner about the stranger they just tried to
 * evict. So the row is kept and stamped instead.
 *
 * Three gates, in the order they bite:
 *
 * 1. **`revokeRefreshTokens(uid)` in the owning pool.** The only lever that
 *    reaches the refresh token sitting in the other browser's IndexedDB.
 *    Firebase has no per-device refresh-token revocation, so this ends every
 *    session on the account — the UI says so rather than implying otherwise.
 *    It must be called on the pool the uid actually lives in: AGL-2005 found a
 *    `revokeRefreshTokens` landing on a project-pool ghost while the real SSO
 *    account's `tokensValidAfterTime` never moved.
 * 2. **`checkRevoked` on the session boundary.** `verifySessionCookie(c, true)`
 *    already passed it; the MINT did not, so an ID token issued up to an hour
 *    before the revoke could still buy a fresh 14-day cookie and undo gate 1
 *    entirely. Both halves check it now.
 * 3. **This epoch.** A per-device `revokedAt`, compared against the time the
 *    presented credential was ISSUED — the session cookie's `iat` on the
 *    exchange, the ID token's `auth_time` on the mint. Independent of
 *    Firebase's own bookkeeping, so the refusal survives a future change that
 *    stops passing `checkRevoked`, and it is what lets the device row say
 *    "signed out" instead of vanishing.
 *
 * ## Why `auth_time`, and why this cannot brick a browser
 *
 * The comparison is against when the credential was ISSUED, never against
 * "this device id is banned". A person who revokes the device they are sitting
 * at — the likeliest mistake, since it is the row at the top of the list —
 * signs in again and their new ID token carries a NEWER `auth_time`, so the
 * same device is admitted with no support ticket and no second mechanism.
 * AGL-1888 is a live, permanent lockout on this account; nothing here may add
 * another one.
 *
 * An attacker holding only cookies and a refresh token cannot produce a newer
 * `auth_time` — that claim moves only when someone actually authenticates.
 *
 * ## The residual, stated rather than glossed
 *
 * A revoked device keeps a valid Firebase ID token for up to an hour, and
 * Firestore security rules key on that token and not on our cookie. So direct
 * client reads from a tab that is already open survive until the token
 * expires; it cannot refresh past that, because gate 1 killed the refresh
 * token. The honest bound is "≤1 hour for an open tab, immediately for
 * everything that goes through our server", and the card says that in those
 * words. Closing the last hour would mean a Firestore rules change asserting
 * `request.auth.token.auth_time`, which is a hand-deployed change outside the
 * git pipeline and is not part of this.
 */

/** Field written on the device document when a session is revoked. */
export const DEVICE_REVOKED_AT = 'revokedAt'

/**
 * Does a device revocation refuse this credential?
 *
 * @param revokedAtMs - epoch ms from the device document, 0/absent when live
 * @param credentialIssuedAtMs - when the presented credential was issued —
 *   `iat * 1000` for a session cookie, `auth_time * 1000` for an ID token
 */
export function deviceRevocationRefuses(
  revokedAtMs: number | null | undefined,
  credentialIssuedAtMs: number | null | undefined,
): boolean {
  const revokedAt = Number(revokedAtMs ?? 0)
  if (!Number.isFinite(revokedAt) || revokedAt <= 0) return false
  const issuedAt = Number(credentialIssuedAtMs ?? 0)
  // An undateable credential cannot be shown to postdate the revocation, and
  // the safe direction for a security control is to refuse it. This is the
  // opposite of the tombstone's "heal when undateable", and deliberately so:
  // a tombstone denying a session nobody asked it to deny is the failure
  // there, while here the failure is admitting one somebody asked us to end.
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return true
  return issuedAt < revokedAt
}

/** Seconds-since-epoch claim to epoch ms, tolerating absence. */
export function claimSecondsToMs(
  seconds: number | null | undefined,
): number | null {
  const value = Number(seconds ?? 0)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.floor(value * 1000)
}
