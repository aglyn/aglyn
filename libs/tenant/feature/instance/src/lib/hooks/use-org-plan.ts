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

import { doc } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore } from './firebase/firebase-services'
import { useFirestoreDoc } from './use-firestore-doc'
import { useHostOrgIdState } from './use-host-org-id'

export interface OrgPlanState {
  /** The owning org's doc, once it has arrived. */
  org: Record<string, unknown> | undefined
  /**
   * Whether `org` is trustworthy. FALSE means the answer is still in
   * flight — hold rather than resolve entitlements, because an absent org
   * is indistinguishable from the free tier to every `Aglyn.checkQuota` /
   * `checkEntitlement` call.
   */
  ready: boolean
}

/**
 * A host's owning org doc, for plan quotas and entitlements, with an honest
 * `ready` flag (AGL-1064).
 *
 * This existed as a copy-pasted pair in five commerce console cards:
 *
 * ```ts
 * const orgId = useHostOrgId(hostId)
 * const { data: org } = useFirestoreDoc(
 *   () => doc(firestore, 'orgs', orgId ?? '-pending-'), [firestore, orgId])
 * const quota = Aglyn.checkQuota(org, 'posRegisters', registers.length)
 * ```
 *
 * `useHostOrgId` returns null while the `hostIndex` lookup is in flight, so
 * `org` is undefined for the first render or two of every mount — and
 * `checkQuota(undefined, …)` does not mean "unknown", it resolves the FREE
 * tier (`posRegisters: 0`, `productsPerHost: 0`, `inventoryLocations: 1`).
 * A paying customer clicking Add inside that window was told their plan does
 * not include what they bought.
 *
 * Same defect shape as {@link useOrgDataScope} (AGL-1061) and
 * `useScopeTokens` (AGL-1047): a hook handing out a resolved-looking value
 * before it has resolved. Callers gate their controls on `ready` rather than
 * letting an absent org answer a billing question.
 *
 * The `'-pending-'` sentinel goes with it. Addressing `orgs/-pending-` was a
 * guaranteed-denied read on every mount; this holds the ref at null instead,
 * so no query is issued until there is a real org to ask about.
 *
 * Not to be confused with the console's `useOrgPlans` (plural), which reads
 * the plan of every org the user belongs to for the switcher. This one is
 * the single owning org of a HOST.
 */
export function useOrgPlan(hostId: string | undefined): OrgPlanState {
  const firestore = useFirestore()
  const { orgId, loaded } = useHostOrgIdState(hostId)
  const { data: org, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (orgId ? doc(firestore, 'orgs', orgId) : null),
    [firestore, orgId],
  )
  return useMemo(
    () => ({
      org,
      // A host with no owning org is SETTLED, not pending — there is no
      // org doc coming, and holding forever would leave the card
      // permanently disabled. `status` only moves off 'loading' once a
      // ref exists, so it cannot answer that case.
      ready: loaded && (!orgId || status !== 'loading'),
    }),
    [org, loaded, orgId, status],
  )
}

export default useOrgPlan
