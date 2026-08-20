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
 * ID-token revocation on every server door (AGL-1881).
 *
 * ## The gap this closes
 *
 * `verifyIdToken(token)` checks a signature and an expiry. It does not ask
 * whether the account was locked, disabled, deleted, de-staffed or signed out
 * five seconds ago — that costs a round trip, so the SDK makes it opt-in via
 * `checkRevoked`. The pre-launch audit found the flag set on 3 of 175 call
 * sites: the session MINT, the session EXCHANGE and the device-revoke route.
 * Everything else — 117 console API routes, plus the marketplace, commerce and
 * bookings plugin servers — took a bare `verifyIdToken`.
 *
 * So `revokeRefreshTokens(uid)` stopped the browser getting a NEW token and
 * did nothing about the one it already held. After a panic user-lock, a staff
 * password reset, an SSO offboard, an org-wide lockdown or a "sign out
 * everywhere", the revoked token kept opening every one of those doors for the
 * remainder of its hour. `device-revocation.ts` meanwhile promised the effect
 * was "immediate for everything that goes through our server", which was the
 * defect worth fixing: the sentence was shipped and it was not true.
 *
 * ## Why it is a cached epoch and not just `checkRevoked: true`
 *
 * `checkRevoked` costs one `accounts:lookup` per verification. Measured
 * against production `aglyn-main` (n=40): p50 95.5ms, p95 144ms — statistically
 * indistinguishable from the p50 85.8ms single Firestore `doc().get()` that
 * every one of these routes already performs, on the same connection from the
 * same machine. So the round trip is not expensive; it is just paid too often.
 * Turned on unconditionally it would multiply Identity Toolkit calls by the
 * whole console request volume, against a project quota, to re-answer a
 * question whose answer changes maybe twice a year per account.
 *
 * The answer is therefore CACHED, on exactly the terms AGL-1522 already set
 * for the panic path: `PLATFORM_TTL_MS`, 15 seconds, LRU-bounded, with the
 * acting process invalidating the uid after its own write. Steady state costs
 * nothing; a cold entry costs one Firestore-read-equivalent; the honest window
 * goes from ~3600s to ≤15s, and to zero on the process that did the revoking.
 * A revocation control whose staleness bound matches the lockdown control it
 * sits beside is one bound to explain, not two.
 *
 * ## What is checked, and in which pool
 *
 * Three refusals, mirroring firebase-admin's own `checkRevoked` so the error
 * codes route handlers already catch keep working unchanged:
 *
 *  - `tokensValidAfterTime` after the token's `auth_time` → `id-token-revoked`
 *  - `disabled` → `user-disabled` (a user-scope panic lock sets this, and it
 *    is the half that does not depend on clock agreement)
 *  - the record is GONE → `id-token-revoked` (a deleted account is not a
 *    signed-in one; the SDK's own check treats this as revoked too)
 *
 * The lookup is asked of the auth instance the token was verified with, which
 * is the AGL-2005 rule made structural rather than remembered: a tenant-aware
 * auth asks the tenant pool, and a project-pool lookup for an SSO uid — which
 * would answer "never revoked" about a forged twin — cannot be spelled.
 *
 * ## Failure direction
 *
 * An unreachable Identity Toolkit is an outage, not a revocation, and refusing
 * every request in the console during one would be a self-inflicted lockdown.
 * So a transport failure fails OPEN — and is NOT cached, or a single blip
 * would blind the check for a full TTL. `user-not-found` is not a transport
 * failure and fails closed. This is the opposite direction from
 * `deviceRevocationRefuses`, which refuses an undateable credential, and the
 * split is deliberate: "we could not reach the service" and "the service told
 * us this account is gone" are different answers.
 */

import type { BaseAuth, DecodedIdToken } from 'firebase-admin/auth'

/**
 * Matches `PLATFORM_TTL_MS` in `lockdown.ts`, and deliberately so — see the
 * module note. One number for how stale a panic action may read.
 */
export const TOKEN_REVOCATION_TTL_MS = 15_000

/**
 * Bounded so a scan of uids cannot balloon a warm serverless process. Past
 * this many entries the least-recently-USED is evicted; a cache hit refreshes
 * recency, so an active session is not what a scan pushes out. Same bound and
 * same reasoning as `USER_LOCKDOWN_CACHE_MAX`.
 */
export const TOKEN_REVOCATION_CACHE_MAX = 5000

/** Thrown for a token the account has invalidated. Code matches the SDK's. */
export class IdTokenRevokedError extends Error {
  readonly code = 'auth/id-token-revoked'
  constructor(message = 'The ID token has been revoked.') {
    super(message)
    this.name = 'IdTokenRevokedError'
  }
}

/** Thrown for a token whose account is disabled. Code matches the SDK's. */
export class UserDisabledError extends Error {
  readonly code = 'auth/user-disabled'
  constructor(message = 'The user record is disabled.') {
    super(message)
    this.name = 'UserDisabledError'
  }
}

/** What the check needs off the account record, and nothing else. */
interface AccountState {
  /** `true` when the record could not be found at all. */
  missing: boolean
  disabled: boolean
  /** `tokensValidAfterTime` as epoch ms; null when never revoked. */
  validAfterMs: number | null
}

const cache = new Map<string, { at: number; state: AccountState }>()
const pending = new Map<string, Promise<AccountState | null>>()

/**
 * A uid is only unique WITHIN a pool (AGL-2005), so the pool is part of the
 * key. The separator is a NUL because a tenant id cannot contain one.
 */
function cacheKey(uid: string, tenantId: string | null | undefined): string {
  return `${tenantId ?? ''}\u0000${uid}`
}

/**
 * Drop one account's cached verdict — called by every path that revokes, so
 * the process that took the action refuses on its very next request instead
 * of waiting out its own TTL. Called bare, clears everything.
 */
export function invalidateTokenRevocationCache(
  uid?: string,
  tenantId?: string | null,
): void {
  if (uid === undefined) {
    cache.clear()
    pending.clear()
    return
  }
  // A revoke reaches the account, not one pool's view of it: clear the
  // project-pool key and the named tenant's, so a caller that does not know
  // which pool answered still gets a fresh read.
  for (const key of [cacheKey(uid, null), cacheKey(uid, tenantId)]) {
    cache.delete(key)
    pending.delete(key)
  }
}

/** Full reset, for specs. Production code wants the per-uid form above. */
export function resetTokenRevocationCache(): void {
  cache.clear()
  pending.clear()
}

/**
 * Does this account's revocation epoch refuse this token?
 *
 * Both sides are floored to whole seconds before comparing.
 * `tokensValidAfterTime` is an RFC-1123 string with second granularity and
 * `auth_time` is a whole second, so comparing in milliseconds would let a
 * token minted in the same second as the revoke read as refused on one
 * process and admitted on the next.
 *
 * @param decoded - the verified ID token
 * @param validAfterMs - epoch ms from `tokensValidAfterTime`, null when never
 *   revoked
 */
export function revocationRefuses(
  decoded: DecodedIdToken,
  validAfterMs: number | null | undefined,
): boolean {
  const validAfter = Number(validAfterMs ?? 0)
  if (!Number.isFinite(validAfter) || validAfter <= 0) return false
  // `auth_time` moves only on a real authentication, which is what makes it
  // the right clock: an attacker holding a stolen cookie and refresh token
  // cannot produce a newer one. `iat` is the fallback for the handful of
  // custom-token sign-ins that carry no `auth_time`.
  const issuedSeconds = Number(decoded?.auth_time ?? decoded?.iat ?? 0)
  // An undateable token cannot be shown to postdate the revocation, and the
  // safe direction for a security control is to refuse it.
  if (!Number.isFinite(issuedSeconds) || issuedSeconds <= 0) return true
  return Math.floor(issuedSeconds) < Math.floor(validAfter / 1000)
}

/**
 * Read (and cache) the account state behind a uid.
 *
 * `null` means "could not ask" — an outage, distinct from every answer the
 * service can give, and never cached.
 */
async function readAccountState(
  pool: Pick<BaseAuth, 'getUser'>,
  uid: string,
  key: string,
): Promise<AccountState | null> {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < TOKEN_REVOCATION_TTL_MS) {
    // Re-insert to refresh recency: eviction is least-recently-used, and an
    // ACTIVE session must not be what a uid scan evicts.
    cache.delete(key)
    cache.set(key, cached)
    return cached.state
  }
  let inFlight = pending.get(key)
  if (!inFlight) {
    inFlight = (async () => {
      let state: AccountState | null = null
      try {
        const record = await pool.getUser(uid)
        const validAfterRaw = record?.tokensValidAfterTime
        const parsed = validAfterRaw ? Date.parse(validAfterRaw) : NaN
        state = {
          missing: false,
          disabled: record?.disabled === true,
          validAfterMs: Number.isFinite(parsed) ? parsed : null,
        }
      } catch (error) {
        const code = (error as { code?: string })?.code ?? ''
        if (code === 'auth/user-not-found') {
          state = { missing: true, disabled: false, validAfterMs: null }
        } else {
          // Outage. Fail open, and do NOT cache — one blip must not blind
          // the check for a whole TTL.
          return null
        }
      }
      cache.delete(key)
      cache.set(key, { at: Date.now(), state })
      while (cache.size > TOKEN_REVOCATION_CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return state
    })().finally(() => {
      pending.delete(key)
    })
    pending.set(key, inFlight)
  }
  return inFlight
}

/**
 * Throw if this verified ID token belongs to an account that has since been
 * revoked, disabled or deleted. Resolves silently otherwise, including when
 * the account could not be reached.
 *
 * @param pool - the auth handle the token was verified against; the lookup
 *   MUST go to the same one (AGL-2005), and the parameter is named `pool`
 *   rather than `auth` because that is the contract — `no-project-level-auth-
 *   lookup.spec.ts` reads the receiver name and is right to
 * @param decoded - the token firebase-admin just verified
 */
export async function assertIdTokenNotRevoked(
  pool: Pick<BaseAuth, 'getUser'>,
  decoded: DecodedIdToken,
): Promise<void> {
  const uid = decoded?.uid
  if (!uid) return
  const tenantId = decoded?.firebase?.tenant ?? null
  const state = await readAccountState(pool, uid, cacheKey(uid, tenantId))
  // `=== null`, not `!state`: strictNullChecks is off repo-wide, so the falsy
  // test would not narrow and would also swallow a real state object one
  // refactor from now.
  if (state === null) return
  if (state.missing) {
    throw new IdTokenRevokedError('The user record no longer exists.')
  }
  if (state.disabled) throw new UserDisabledError()
  if (revocationRefuses(decoded, state.validAfterMs)) {
    throw new IdTokenRevokedError()
  }
}
