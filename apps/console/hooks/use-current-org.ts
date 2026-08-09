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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useConfirmedDoc from './use-confirmed-doc'
import useOrgScope from './use-org-scope'

/**
 * The org workspace's billing doc — the entitlement source the signed-in
 * user acts under (AGL-238). Formerly `useCurrentTenant` (alias removed
 * in AGL-444; the uid-keyed `tenantId` return leg retired with the Stripe
 * `metadata[tenantId]` wire key in AGL-445).
 *
 * The listen itself is `useConfirmedDoc` (AGL-928) — the shared
 * retry-with-backoff + server-confirm-on-cache-miss contract this hook
 * originally learned the hard way (AGL-216 transient permission-denied,
 * AGL-887 a stale noDocument tombstone rendering a Business workspace as
 * Free). State clears whenever the org scope changes (AGL-591).
 */
export function useCurrentOrg(): {
  org: Partial<AglynOrgBilling> | undefined
  /** The org the billing data came from, once orgs carry it (AGL-237). */
  orgId: string | undefined
  /**
   * True once an answer for the CURRENT org is trustworthy (AGL-887).
   * `org === undefined` conflates "still loading / read failing" with "no
   * org doc" — plan-dependent UI must not render a fallback tier (or an
   * Upgrade CTA) until this is true, or a failed read masquerades as Free.
   */
  ready: boolean
  /**
   * The entitlements came from the local cache and the server has not
   * confirmed them (AGL-1066). Deliberately NOT folded into `ready`: a
   * transient blip must not blank plan-dependent UI or bounce anyone to an
   * Upgrade CTA. Use it to hold back an irreversible, entitlement-priced
   * action, not to decide what to render.
   */
  entitlementsFromCache: boolean
} {
  const firestore = useFirestore()
  const { currentOrg, loading: orgsLoading } = useOrgScope()
  // AGL-238 cutover: the org doc is the ONLY entitlement source (plan
  // mirrored by backfill + webhook). Accounts without an org yet (fresh
  // signups pre first host) resolve undefined, which the entitlement
  // helpers treat as the pre-billing fail-open, same as before.
  const orgId = currentOrg?.$id
  const {
    data: org,
    ready,
    fromCache,
  } = useConfirmedDoc<Partial<AglynOrgBilling>>(
    firestore,
    orgsLoading || !orgId ? null : ['orgs', orgId],
    // The one document in the console where a cache-served HIT is worth a
    // server read (AGL-1066): this is the sole entitlement source, so a copy
    // held from before a plan change renders the org at the wrong tier.
    // AGL-887 closed the tombstone direction of this; that left the
    // stale-exists direction, which the base contract trusts on sight.
    { confirmCachedHit: true },
  )
  return { org, orgId, ready, entitlementsFromCache: fromCache }
}

export default useCurrentOrg
