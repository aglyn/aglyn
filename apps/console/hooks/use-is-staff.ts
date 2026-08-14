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

function reconcileClaims(user: TokenUser): Promise<Record<string, unknown>> {
  const uid = user.uid ?? ''
  if (reconciliation?.uid === uid) return reconciliation.claims
  const claims = Promise.resolve(user.getIdTokenResult?.(true))
    .then((result) => result?.claims ?? {})
    // A token we cannot refresh is not a staff token. Deliberately does not
    // fall back to the cached verdict: failing closed on the UI costs a
    // staff member one reload, while failing open shows admin chrome on a
    // token we could not confirm.
    .catch(() => ({}) as Record<string, unknown>)
  reconciliation = { uid, claims }
  return claims
}

function reconcileStaffClaim(user: TokenUser): Promise<boolean> {
  return reconcileClaims(user).then((claims) => Boolean(claims.staff))
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

  useEffect(() => {
    let active = true
    const account = user as TokenUser | undefined
    if (!account?.getIdTokenResult) return
    void Promise.resolve(account.getIdTokenResult())
      .then((result) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        // A token we cannot read is not a staff token.
        if (active) setIsStaff(false)
      })
      .then(() => reconcileStaffClaim(account))
      .then((claim) => {
        if (active) setIsStaff(claim)
      })
    return () => {
      active = false
    }
  }, [user])

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
      .catch(() => {
        if (active) setRole(null)
      })
      .then(() => reconcileClaims(account))
      .then((claims) => {
        if (active) setRole(read(claims))
      })
    return () => {
      active = false
    }
  }, [user])

  return role
}

/** Test seam: drops the shared refresh so each case starts clean. */
export function resetStaffClaimReconciliation(): void {
  reconciliation = null
}

export default useIsStaff
