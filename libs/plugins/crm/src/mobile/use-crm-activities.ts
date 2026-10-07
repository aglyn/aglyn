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

import { CRM_COLLECTIONS, type CrmActivityRow } from '@aglyn/aglyn/app-utils/crm'
import {
  collection,
  type Firestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import type { CrmNoteLink } from './crm-writes'

/** Rows the record's log shows at a time; one more is read to say there are more. */
export const CRM_ACTIVITY_PAGE = 25

/**
 * The query a record's Activity card reads (`useActivityWindow`): the
 * reader's scope clause, the record's link, newest first — the console's
 * own constraints, so the same composite serves it and the rules prove it.
 */
export function crmActivityConstraints(
  link: CrmNoteLink,
  readTokens: readonly string[] | null,
  rows: number,
): QueryConstraint[] {
  const [field, id] = Object.entries(link)[0] as [string, string]
  return [
    ...(readTokens ? [where('visibleTo', 'array-contains-any', [...readTokens])] : []),
    where(field, '==', id),
    orderBy('atMs', 'desc'),
    limit(rows + 1),
  ]
}

export interface CrmActivities {
  rows: CrmActivityRow[]
  ready: boolean
  error: boolean
  hasMore: boolean
  showMore: () => void
}

/** A record's activity log, live. `readTokens` undefined holds the read until the scope is known. */
export function useCrmActivities(
  firestore: unknown,
  orgId: string | null,
  link: CrmNoteLink | null,
  readTokens: readonly string[] | null | undefined,
): CrmActivities {
  const [pages, setPages] = useState(1)
  const [state, setState] = useState<{ rows: CrmActivityRow[]; ready: boolean; error: boolean }>({
    rows: [],
    ready: false,
    error: false,
  })
  const linkKey = link ? JSON.stringify(link) : null
  const tokensKey = readTokens === undefined ? null : JSON.stringify(readTokens)
  useEffect(() => setPages(1), [linkKey, tokensKey])
  useEffect(() => {
    setState((prior) => ({ ...prior, ready: false, error: false }))
    if (!orgId || !linkKey || tokensKey === null || !firestore) return
    const parsedLink = JSON.parse(linkKey) as CrmNoteLink
    const tokens = JSON.parse(tokensKey) as readonly string[] | null
    if (tokens && !tokens.length) return
    return onSnapshot(
      query(
        collection(firestore as Firestore, 'orgs', orgId, CRM_COLLECTIONS.activities),
        ...crmActivityConstraints(parsedLink, tokens, pages * CRM_ACTIVITY_PAGE),
      ),
      (snapshot) =>
        setState({
          rows: snapshot.docs.map((row) => ({ ...(row.data() as object), $id: row.id }) as CrmActivityRow),
          ready: true,
          error: false,
        }),
      () => setState({ rows: [], ready: true, error: true }),
    )
  }, [firestore, orgId, linkKey, tokensKey, pages])
  const shown = pages * CRM_ACTIVITY_PAGE
  const hasMore = state.rows.length > shown
  const showMore = useCallback(() => {
    if (hasMore) setPages((current) => current + 1)
  }, [hasMore])
  return { rows: state.rows.slice(0, shown), ready: state.ready, error: state.error, hasMore, showMore }
}
