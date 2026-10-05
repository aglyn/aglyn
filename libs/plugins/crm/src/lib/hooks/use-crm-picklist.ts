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
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  crmPicklistDefinition,
  effectiveCrmPicklist,
  normalizeCrmPicklist,
} from '@aglyn/aglyn'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { useMemo } from 'react'

export interface CrmPicklistResult {
  /** The field the list belongs to — its standard values, groups and targets. */
  definition: CrmPicklistDefinition
  /** The list every picker offers — the org's own values with every standard value. */
  picklist: CrmPicklist
  /** The org has written its own list; false while it reads the standard values alone. */
  stored: boolean
  /** The server has answered, so the list is the org's and not a placeholder. */
  ready: boolean
  /** The document has not been confirmed by the server — `writeGuardedBySeed`'s input. */
  fromCache: boolean
}

/**
 * An org's values for one of the CRM's standard picklists (AGL-3510), for
 * every surface that offers or manages them: a record's select, a create
 * drawer, a list's filter and the Fields page.
 *
 * One document listen, shared by the Firestore SDK across every mount that
 * asks for the same org and picklist, so a page with the list and a drawer
 * open pays for it once. `orgId` null issues no read and answers the
 * standard values, unready.
 */
export function useCrmPicklist(
  id: CrmPicklistId,
  orgId: string | null | undefined,
): CrmPicklistResult {
  const firestore = useFirestore()
  const { data, status, fromCache } = useFirestoreDoc<Record<string, unknown>>(
    () => (orgId ? doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.picklists, id) : null),
    [firestore, orgId, id],
  )
  return useMemo(
    () => ({
      definition: crmPicklistDefinition(id) as CrmPicklistDefinition,
      picklist: effectiveCrmPicklist(id, data),
      stored: normalizeCrmPicklist(data) !== null,
      ready: Boolean(orgId) && status !== 'loading',
      fromCache,
    }),
    [id, data, orgId, status, fromCache],
  )
}

export default useCrmPicklist
