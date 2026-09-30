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
 * The account /signin created and stood down for consent (AGL-1497), carried
 * to /signup so its sign-up there is treated as the sign-up it is (AGL-3424).
 *
 * "Sign in with Google" on /signin creates an account when the Google
 * identity is new, and the page signs it straight back out and sends the
 * person to /signup to accept the Terms. When they do, Firebase has known the
 * account since /signin, so the /signup credential says it is NOT new — and
 * every door there gated its workspace on that flag, because an existing
 * customer clicking Google on /signup must not be handed a second workspace.
 * The bounced account therefore landed in the empty workspace chooser, the
 * exact landing AGL-1115 and AGL-1942 were built to remove.
 *
 * Only /signin knows the account is new, so /signin says so, here, keyed by
 * the account's uid. /signup reads it for the credential in hand and nothing
 * else: a marker for one account can never make another account's sign-in
 * look new. Local, not session, storage: the person may close the tab and
 * come back to /signup later, which is the case the per-uid key keeps safe.
 * Consumed on read, so it answers once.
 */

const KEY = 'aglyn:consent-bounce'

/**
 * How long a bounced account's return still counts as its sign-up. Matches
 * how long the sign-up workspace hold waits for the same account.
 */
export const CONSENT_BOUNCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** /signin: this account was created here and sent to /signup for consent. */
export function markConsentBounce(uid: string | null | undefined): void {
  if (!uid) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ uid, atMs: Date.now() }))
  } catch {
    // Storage refused: the account lands in the workspace chooser, which
    // still offers workspace creation — the old behaviour, not a new failure.
  }
}

/**
 * /signup: whether THIS account was bounced here from /signin for consent.
 * Clears the marker whenever it answers for this account or has gone stale;
 * one for a different account is left for that account.
 */
export function consumeConsentBounce(
  uid: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!uid) return false
  let parsed: { uid?: unknown; atMs?: unknown } | null
  try {
    const raw = window.localStorage.getItem(KEY)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  if (!parsed) return false
  const atMs = Number(parsed.atMs)
  const fresh = Number.isFinite(atMs) && nowMs - atMs <= CONSENT_BOUNCE_MAX_AGE_MS
  const mine = parsed.uid === uid
  if (mine || !fresh) {
    try {
      window.localStorage.removeItem(KEY)
    } catch {
      /* nothing to clean up if it could not be read either */
    }
  }
  return mine && fresh
}
