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
'use client'

import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useState } from 'react'

interface TokenUser {
  uid?: string
  getIdTokenResult?: (
    forceRefresh?: boolean,
  ) => Promise<{ claims?: Record<string, unknown> } | undefined>
}

/**
 * One forced token refresh per signed-in user per page load, shared by every
 * mounted consumer (AGL-955).
 *
 * Custom claims are baked into the ID token at mint time, so a cached read
 * reflects the claims as of the last mint — up to an hour stale. That cuts
 * both ways: a freshly granted staff member gets an unexplained 404, and a
 * freshly DEMOTED one keeps seeing staff chrome. Server-side enforcement is
 * unaffected either way (`/api/admin/*` and the Firestore rules verify the
 * decoded token per request), but the UI should not confidently assert a
 * claim the user no longer holds.
 *
 * Keyed by uid so switching accounts reconciles again, and shared at module
 * scope because StaffGuard, the user menu and the secondary nav all mount at
 * once — one network round trip, not three.
 */
let reconciliation: {
  uid: string
  claims: Promise<Record<string, unknown>>
} | null = null

function reconcileClaims(
  user: TokenUser,
): Promise<Record<string, unknown> | null> {
  const uid = user.uid ?? ''
  if (reconciliation?.uid === uid) return reconciliation.claims
  const entry: {
    uid: string
    claims: Promise<Record<string, unknown> | null>
  } = {
    uid,
    claims: Promise.resolve(user.getIdTokenResult?.(true))
      .then((result) => result?.claims ?? {})
      /*
       * `null` is "could not read", which is NOT the empty claim set.
       *
       * This answered `{}` — indistinguishable from a token that genuinely
       * carries no `staff` claim — and then MEMOISED it. A tab left open on
       * an admin page refreshes its token roughly hourly, a backgrounded tab
       * is exactly when that fails, and the cached refusal was handed to
       * every later mount for the life of the page: `StaffGuard` rendered
       * `notFound()` and no amount of navigating got back off it.
       *
       * Failing closed is still the rule and is unchanged — `null` leaves
       * the guards holding their spinner, which renders no admin chrome. It
       * just stops an unreachable network from being reported as a verdict
       * about who this person is. Dropping the slot lets the next attempt
       * genuinely retry.
       */
      .catch(() => {
        if (reconciliation === entry) reconciliation = null
        return null
      }),
  }
  reconciliation = entry
  return entry.claims
}

function reconcileStaffClaim(user: TokenUser): Promise<boolean | null> {
  return reconcileClaims(user).then((claims) =>
    claims === null ? null : Boolean(claims.staff),
  )
}

/**
 * Coming back to an idle tab is when retrying is both wanted and free.
 *
 * A successful reconciliation is memoised, so this bumps only while there is
 * nothing cached — i.e. only when the last attempt did not land. Without it
 * the recovery path is a manual reload, which is what the reader was left
 * with.
 */
function useClaimAttempt(): number {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const retry = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      if (reconciliation) return
      setAttempt((count) => count + 1)
    }
    document.addEventListener('visibilitychange', retry)
    window.addEventListener('online', retry)
    return () => {
      document.removeEventListener('visibilitychange', retry)
      window.removeEventListener('online', retry)
    }
  }, [])
  return attempt
}

/**
 * Whether the signed-in user carries the staff claim (AGL-760).
 *
 * `null` while the token is still being read — distinct from `false`, and the
 * distinction matters: rendering a "staff only" refusal during that window
 * would flash at every staff member on every admin page load.
 *
 * Reads the CACHED token first so the common path costs nothing, then
 * reconciles against a forced refresh (AGL-955) — see `reconcileStaffClaim`.
 * The forced result is applied after the cached one for this mount, so a
 * slow cached read can never overwrite fresh truth.
 *
 * This is a UI gate, not the security boundary. Firestore rules and the
 * `/api/admin/*` handlers enforce the claim server-side; this exists so a
 * page says why it is empty instead of silently failing its reads.
 */
export function useIsStaff(): boolean | null {
  const { data: user } = useUser()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const attempt = useClaimAttempt()

  useEffect(() => {
    let active = true
    const account = user as TokenUser | undefined
    if (!account?.getIdTokenResult) return
    void Promise.resolve(account.getIdTokenResult())
      .then((result) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      // An unreadable token says nothing about who this is, so nothing is
      // recorded: the verdict stays whatever it already was, and `null` — the
      // guards' spinner — is where it starts.
      .catch(() => undefined)
      .then(() => reconcileStaffClaim(account))
      .then((claim) => {
        if (active && claim !== null) setIsStaff(claim)
      })
    return () => {
      active = false
    }
  }, [user, attempt])

  return isStaff
}

/**
 * The staff member's ROLE, or `null` while it is still being read and for
 * anyone who is not staff (AGL-1687).
 *
 * A second axis from {@link useIsStaff}, not a replacement: `staff` opens
 * the admin area, `staffRole` decides who may pull a trigger inside it.
 * Support can read every panel; `super` is the bar for a lockdown and for a
 * takedown, and `/api/admin/*` enforces that server-side per request.
 *
 * Missing means `support`, matching the routes — they read
 * `String(decoded['staffRole'] ?? 'support')` and fail closed to the
 * least-privileged role on a missing claim (AGL-495). A UI that guessed
 * `super` on an absent claim would offer a button whose request is refused.
 *
 * Shares the one forced refresh {@link useIsStaff} already performs, so
 * mounting both costs the same single round trip.
 */
export function useStaffRole(): string | null {
  const { data: user } = useUser()
  const [role, setRole] = useState<string | null>(null)
  const attempt = useClaimAttempt()

  useEffect(() => {
    let active = true
    const account = user as TokenUser | undefined
    if (!account?.getIdTokenResult) return
    const read = (claims: Record<string, unknown> | undefined) =>
      claims?.staff ? String(claims.staffRole ?? 'support') : null
    void Promise.resolve(account.getIdTokenResult())
      .then((result) => {
        if (active) setRole(read(result?.claims))
      })
      .catch(() => undefined)
      .then(() => reconcileClaims(account))
      .then((claims) => {
        // Same rule as the staff claim: an unread token is not a demotion.
        if (active && claims !== null) setRole(read(claims))
      })
    return () => {
      active = false
    }
  }, [user, attempt])

  return role
}

/** Test seam: drops the shared refresh so each case starts clean. */
export function resetStaffClaimReconciliation(): void {
  reconciliation = null
}

export default useIsStaff
