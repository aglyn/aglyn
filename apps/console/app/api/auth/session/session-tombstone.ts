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
 * Sign-out tombstone encoding for the cross-subdomain `__session` cookie
 * (AGL-463/AGL-624). Kept dependency-free (no Admin SDK) so it is unit
 * testable and shared by the session route and — in spirit — the client.
 *
 * A DELETE writes a tombstone rather than clearing the cookie so other
 * subdomains can distinguish "signed out elsewhere" from "never minted".
 * The tombstone carries the sign-out timestamp (`signed-out:<ms>`) so a
 * restoring client can tell a REAL remote sign-out (newer than its own
 * last sign-in) from a STALE tombstone left by an earlier sign-out whose
 * subsequent re-login mint failed or raced a navigation — the latter must
 * heal (re-mint), never force a logout on a plain refresh.
 */

export const SESSION_SIGNED_OUT = 'signed-out'

/**
 * How long a sign-out tombstone stays meaningful (AGL-1142).
 *
 * It used to inherit the session cookie's own 14-day lifetime, which is far
 * longer than it can possibly be useful. Measured on production 2026-07-31:
 * a `__session` cookie holding a tombstone from **nine days earlier**, on an
 * account that had signed in interactively since. Every cross-subdomain
 * silent sign-in was answered `401 signed-out` for those nine days, and the
 * only reason it was not reported as broken is that the console falls back to
 * Firebase's own client persistence and looks fine.
 *
 * A day is generous for what this actually does. The tombstone exists to tell
 * OTHER subdomains that a sign-out happened, and the console idle-signs-out
 * after an hour — so any tab still alive a day later has been in active use,
 * which means it has already asked. Past that, all a tombstone can do is
 * deny a session nobody asked it to deny.
 *
 * Deliberately not "until the sign-out is older than the client's last
 * sign-in": that comparison already exists in `tombstoneEndsSession`, it is
 * made client-side, and it is not reached when the cookie value IS the
 * tombstone — which is the exact case that broke.
 */
export const SESSION_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000

export interface SignedOutTombstone {
  /** Sign-out time in epoch ms; 0 for a legacy untimestamped tombstone. */
  at: number
}

/** Encodes a timestamped sign-out tombstone value. */
export function signedOutTombstone(nowMs: number): string {
  return `${SESSION_SIGNED_OUT}:${nowMs}`
}

/**
 * Parses a cookie value into a tombstone, or null when it is not one.
 * Accepts the legacy bare `signed-out` (treated as `at: 0`, i.e. oldest
 * possible, so it always reads as stale and heals) and `signed-out:<ms>`.
 */
export function parseSignedOut(
  cookieValue: string | undefined,
): SignedOutTombstone | null {
  if (!cookieValue) return null
  if (cookieValue === SESSION_SIGNED_OUT) return { at: 0 }
  const prefix = `${SESSION_SIGNED_OUT}:`
  if (cookieValue.startsWith(prefix)) {
    const at = Number.parseInt(cookieValue.slice(prefix.length), 10)
    return { at: Number.isFinite(at) && at > 0 ? at : 0 }
  }
  return null
}

/**
 * Decides whether a restoring client should sign out in response to a
 * `signed-out` tombstone. Only a sign-out that happened AFTER this
 * session's last sign-in is a genuine "signed out elsewhere"; a tombstone
 * at or before the last sign-in predates this login and is stale — heal.
 */
export function tombstoneEndsSession(
  signedOutAtMs: number,
  lastSignInMs: number,
): boolean {
  if (!Number.isFinite(signedOutAtMs) || signedOutAtMs <= 0) return false
  return signedOutAtMs > (Number.isFinite(lastSignInMs) ? lastSignInMs : 0)
}

/**
 * Has this tombstone outlived its usefulness? (AGL-1142)
 *
 * Enforced on the SERVER as well as by the cookie's own `Max-Age`, and that
 * is the half that matters: shortening the cookie only helps tombstones
 * written from now on. Browsers are already holding ones with a 14-day
 * lifetime, and those heal only if the server stops honouring them.
 *
 * A legacy untimestamped tombstone (`at: 0`) is treated as expired. It
 * carries no date, so it cannot be shown to be recent, and the whole point of
 * the timestamp was that an undateable tombstone should heal rather than
 * deny — `tombstoneEndsSession` already treats it that way.
 */
export function tombstoneIsExpired(
  signedOutAtMs: number,
  nowMs: number,
  ttlMs: number = SESSION_TOMBSTONE_TTL_MS,
): boolean {
  if (!Number.isFinite(signedOutAtMs) || signedOutAtMs <= 0) return true
  return nowMs - signedOutAtMs > ttlMs
}
