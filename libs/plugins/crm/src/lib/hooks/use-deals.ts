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

import { CRM_COLLECTIONS, type CrmDealStatus } from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  usePagedCollection,
} from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import type { DealDoc } from '../model/deal-board-model'
import { crmScopeListable, crmVisibleToClause } from './use-crm-scope'

/**
 * The most open cards one pipeline draws. A board past this is a board
 * nobody reads column by column; the table is paged and reaches the rest.
 */
export const BOARD_OPEN_LIMIT = 500

/** Closed deals shown per closed column when it is expanded. */
export const BOARD_CLOSED_LIMIT = 50

/** Deals listed on a contact's or a company's page. */
export const LINKED_DEALS_LIMIT = 25

/**
 * The deals of one status in one pipeline, newest activity first (AGL-2598).
 *
 * Every query here carries the viewer's scope tokens and an `orderBy`, and
 * each shape sits on an index the foundation declared:
 * `(visibleTo, pipelineId, status, updatedAt DESC)`. Passing `null` for the
 * pipeline or an EMPTY token list issues nothing, which is how a column
 * stays quiet until the pipeline has loaded and a collapsed Won column
 * costs no read. A `null` token list is the ORGANIZATION level (AGL-2630):
 * the clause is dropped and the query rides the `(pipelineId, status,
 * updatedAt DESC)` twin of that index.
 */
export function useDealsByStatus(
  orgId: string | null,
  readTokens: readonly string[] | null,
  pipelineId: string | null,
  status: CrmDealStatus,
  max: number,
) {
  const firestore = useFirestore()
  return useFirestoreCollection<DealDoc>(
    () =>
      orgId && pipelineId && crmScopeListable(readTokens)
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
            ...crmVisibleToClause(readTokens),
            where('pipelineId', '==', pipelineId),
            where('status', '==', status),
            orderBy('updatedAt', 'desc'),
            limit(max),
          )
        : null,
    [firestore, orgId, readTokens, pipelineId, status, max],
    { idField: '$id' },
  )
}

/**
 * Every deal the viewer may see, paged, optionally narrowed to one status
 * and to one pipeline — the table's read. Four shapes, four indexes:
 * `(visibleTo, updatedAt DESC)`, `(visibleTo, status, updatedAt DESC)`,
 * `(visibleTo, pipelineId, updatedAt DESC)` and
 * `(visibleTo, pipelineId, status, updatedAt DESC)`.
 */
export function usePagedDeals(
  orgId: string | null,
  readTokens: readonly string[] | null,
  status: CrmDealStatus | 'all',
  pipelineId: string | null = null,
) {
  const firestore = useFirestore()
  return usePagedCollection<DealDoc>(
    (pageLimit) =>
      orgId && crmScopeListable(readTokens)
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
            ...crmVisibleToClause(readTokens),
            ...(pipelineId ? [where('pipelineId', '==', pipelineId)] : []),
            ...(status === 'all' ? [] : [where('status', '==', status)]),
            orderBy('updatedAt', 'desc'),
            limit(pageLimit),
          )
        : null,
    [firestore, orgId, readTokens, status, pipelineId],
    { idField: '$id' },
  )
}

/**
 * The deals that name one contact or one company, for the card on that
 * record's page. `(visibleTo, contactId|companyId, updatedAt DESC)`.
 */
export function useLinkedDeals(
  orgId: string | null,
  readTokens: readonly string[] | null,
  link: { contactId: string } | { companyId: string },
) {
  const firestore = useFirestore()
  const field = 'contactId' in link ? 'contactId' : 'companyId'
  const id = 'contactId' in link ? link.contactId : link.companyId
  return useFirestoreCollection<DealDoc>(
    () =>
      orgId && id && crmScopeListable(readTokens)
        ? query(
            collection(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals),
            ...crmVisibleToClause(readTokens),
            where(field, '==', id),
            orderBy('updatedAt', 'desc'),
            limit(LINKED_DEALS_LIMIT),
          )
        : null,
    [firestore, orgId, readTokens, field, id],
    { idField: '$id' },
  )
}

/** One deal, live. `undefined` while loading, and after a delete. */
export function useDeal(orgId: string | null, dealId: string) {
  const firestore = useFirestore()
  return useFirestoreDoc<DealDoc>(
    () =>
      orgId && dealId
        ? doc(firestore, 'orgs', orgId, CRM_COLLECTIONS.deals, dealId)
        : null,
    [firestore, orgId, dealId],
    { idField: '$id' },
  )
}
