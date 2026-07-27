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
let reconciliation: { uid: string; claim: Promise<boolean> } | null = null

function reconcileStaffClaim(user: TokenUser): Promise<boolean> {
  const uid = user.uid ?? ''
  if (reconciliation?.uid === uid) return reconciliation.claim
  const claim = Promise.resolve(user.getIdTokenResult?.(true))
    .then((result) => Boolean(result?.claims?.staff))
    // A token we cannot refresh is not a staff token. Deliberately does not
    // fall back to the cached verdict: failing closed on the UI costs a
    // staff member one reload, while failing open shows admin chrome on a
    // token we could not confirm.
    .catch(() => false)
  reconciliation = { uid, claim }
  return claim
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

/** Test seam: drops the shared refresh so each case starts clean. */
export function resetStaffClaimReconciliation(): void {
  reconciliation = null
}

export default useIsStaff
