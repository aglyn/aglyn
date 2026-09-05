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

import * as Aglyn from '@aglyn/aglyn'
import type { AglynOrgBilling, CrmActivityRow } from '@aglyn/aglyn'
import {
  useFirestore,
  useOrgDataScope,
  usePagedCollection,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  collection,
  limit,
  orderBy,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { useCallback, useMemo } from 'react'

/** The org document as the shell passes it: partial, and possibly absent. */
export type CrmOrg = Partial<AglynOrgBilling> | null | undefined

/**
 * Which record an activity surface is about. Exactly one of the three is set
 * by a record page; a feed across the CRM sets none.
 */
export interface ActivityRecordLink {
  contactId?: string
  companyId?: string
  dealId?: string
}

/**
 * Everything an activity surface needs to know about WHERE it is reading
 * and writing (AGL-2600), resolved once from the two props the shell hands
 * every CRM page.
 *
 * Four surfaces read activities — a record card, a contact's timeline, the
 * recent feed and the dialog that writes them — and each of them would
 * otherwise resolve the same org, the same consent group and the same token
 * set from the same two inputs. Resolved here so that a surface cannot read
 * with one group and write with another, which is the shape of leak the
 * contacts list closed (a listener with no `where` at all).
 *
 * Pure of Firestore reads: the org document is the one the shell already
 * loaded, so the group and the tokens cost nothing, and the data scope is
 * the memoized `['orgs', orgId]` tuple every host-scoped card builds.
 */
export function useActivityScope(hostId: string, org: CrmOrg) {
  const firestore = useFirestore()
  const { scope: dataScope, orgId } = useOrgDataScope({ hostId })
  /*
   * The controller this surface is showing — the sites declared to be one
   * sender, or this site alone — read from the org document the shell
   * passed. The contacts list resolves its group the same way, so an
   * activity logged from a contact's page lands in the scope that contact
   * is read under.
   */
  const consentGroup = useMemo(
    () => Aglyn.consentGroupForHost(org as Record<string, unknown>, hostId),
    [org, hostId],
  )
  /** The tokens a listener asks for — `'org'` first, then the group's sites. */
  const readTokens = useMemo(
    () => Aglyn.crmReadTokens(consentGroup),
    [consentGroup],
  )
  /** The tokens a creator stamps — the contact create path's own expression. */
  const writeTokens = useMemo(
    () => Aglyn.crmScopeTokens(org as Record<string, unknown>, consentGroup),
    [org, consentGroup],
  )
  return useMemo(
    () => ({
      firestore,
      dataScope,
      orgId,
      hostId,
      consentGroup,
      readTokens,
      writeTokens,
    }),
    [firestore, dataScope, orgId, hostId, consentGroup, readTokens, writeTokens],
  )
}

export type ActivityScope = ReturnType<typeof useActivityScope>

/**
 * Whether the signed-in user may EDIT or DELETE a given activity (AGL-2600).
 *
 * The author may, and so may an org-wide member — the person who administers
 * the org can correct or remove anything logged in it. Nobody else: a scoped
 * colleague may read a call log they did not write, and may not rewrite it.
 *
 * ⚠️ This is a UI verdict, not an enforced one. The Firestore rules on
 * `crmActivities` admit any member who may write scoped org data, and they
 * do not distinguish the author from anybody else — there is no `byUid`
 * clause in them. The controls are hidden here so that the console does not
 * offer a colleague's log for editing, and a caller who bypasses the console
 * is a caller the rules already admit. Tightening the rules to the author is
 * a decision about what the API permits, not something a card takes on its
 * own.
 *
 * `useScopeTokens` answers org-wide while it loads, so the verdict for a
 * NON-author waits for `loaded` — a scoped colleague must not see edit
 * controls flash on for one paint and then vanish.
 */
export function useCanEditActivity(orgId: string | undefined) {
  const { data: user } = useUser()
  const uid = user?.uid
  const membership = useScopeTokens(orgId)
  return useCallback(
    (activity: Pick<CrmActivityRow, 'byUid'>): boolean => {
      if (!uid) return false
      if (activity.byUid === uid) return true
      return membership.loaded && membership.orgWide
    },
    [uid, membership.loaded, membership.orgWide],
  )
}

/** How many rows a "show more" step adds, and how many the first paint reads. */
export const ACTIVITY_PAGE_SIZE = 100

/**
 * The activities filed against one record, or across the CRM, newest-first
 * and bounded (AGL-2600).
 *
 * The window is the query. `usePagedCollection` widens the listener by one
 * page each time the reader asks for more, so a record with three hundred
 * calls costs a hundred documents until somebody wants the next hundred —
 * and `hasMore` is a fact from the probe row, not a guess from the length.
 * The rows handed back are the WHOLE window so far, not the last page alone,
 * because a log reads as one list that grows at the bottom rather than as
 * numbered pages.
 *
 * Filtered by `array-contains-any` over the reader's tokens, which is the
 * predicate the rules evaluate with `hasAny`: a filtered query is provable
 * per document, and an unfiltered one is refused outright rather than
 * quietly returning everything. The record filter is one equality on top of
 * it — the three indexes `(visibleTo, contactId|companyId|dealId, atMs DESC)`
 * exist for exactly these queries, and `(visibleTo, atMs DESC)` for the feed
 * that names no record.
 */
export function useActivityWindow(
  scope: ActivityScope,
  link: ActivityRecordLink,
  pageSize: number = ACTIVITY_PAGE_SIZE,
) {
  const { firestore, dataScope, readTokens } = scope
  const { contactId, companyId, dealId } = link
  const paged = usePagedCollection<CrmActivityRow>(
    (pageLimit) => {
      if (!dataScope) return null
      const record: QueryConstraint[] = contactId
        ? [where('contactId', '==', contactId)]
        : companyId
          ? [where('companyId', '==', companyId)]
          : dealId
            ? [where('dealId', '==', dealId)]
            : []
      return query(
        collection(
          firestore,
          dataScope[0],
          dataScope[1],
          Aglyn.CRM_COLLECTIONS.activities,
        ),
        where('visibleTo', 'array-contains-any', readTokens),
        ...record,
        orderBy('atMs', 'desc'),
        limit(pageLimit),
      )
    },
    [firestore, dataScope, readTokens, contactId, companyId, dealId],
    { idField: '$id', pageSize },
  )
  const windowSize = paged.pageSize * (paged.page + 1)
  // The probe row is the one past the window; it says "more exists" and is
  // never shown.
  const rows = useMemo(
    () => (paged.data ?? []).slice(0, windowSize),
    [paged.data, windowSize],
  )
  const showMore = useCallback(
    () => paged.setPage(paged.page + 1),
    [paged],
  )
  return {
    rows,
    hasMore: paged.hasMore,
    showMore,
    status: paged.status,
    /** Whether the listener has a scope to read at all. */
    ready: Boolean(dataScope),
  }
}
