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

import {
  CRM_COLLECTIONS,
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmPicklist,
  effectiveCrmLeadSourcePicklist,
  normalizeCrmPicklist,
} from '@aglyn/aglyn'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'

export interface LeadSourcePicklistResult {
  /** The list every picker offers — the org's own, or the starter set. */
  picklist: CrmPicklist
  /** The org has written its own list; false while it reads the starter set. */
  stored: boolean
  /** The server has answered, so the list is the org's and not a placeholder. */
  ready: boolean
  /** The document has not been confirmed by the server — `writeGuardedBySeed`'s input. */
  fromCache: boolean
}

/**
 * The org's lead source values (AGL-3298), for every surface that offers
 * or manages them: the lead page's select, the New lead drawer, the
 * contact's card, the leads list's filter and the Fields page.
 *
 * One document listen, shared by the Firestore SDK across every mount that
 * asks for the same org, so a page with the list and a drawer open pays
 * for it once. `orgId` null issues no read and answers the starter set,
 * unready.
 */
export function useLeadSourcePicklist(orgId: string | null | undefined): LeadSourcePicklistResult {
  const firestore = useFirestore()
  const { data, status, fromCache } = useFirestoreDoc<Record<string, unknown>>(
    () =>
      orgId
        ? doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.picklists, CRM_LEAD_SOURCE_PICKLIST)
        : null,
    [firestore, orgId],
  )
  return useMemo(
    () => ({
      picklist: effectiveCrmLeadSourcePicklist(data),
      stored: normalizeCrmPicklist(data) !== null,
      ready: Boolean(orgId) && status !== 'loading',
      fromCache,
    }),
    [data, orgId, status, fromCache],
  )
}

export default useLeadSourcePicklist
