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

import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

/** A lead, as the organization-level list carries it. */
export interface OrgLeadRow extends DocumentData {
  /**
   * The grid's row id, which is the lead's own document id.
   *
   * It used to be `{hostId}/{leadId}`, because a lead lived under its site
   * and the same person on two sites was two documents with the SAME id —
   * so the id alone could not key a list spanning sites. AGL-3275 made that
   * one document, and the compound key went with it.
   */
  $id: string
  /** `orgs/{orgId}/leads/{leadId}` — the document id, a person key. */
  leadId: string
}

export interface OrgLeadsResult {
  /** The window, ordered newest-seen first. */
  data: OrgLeadRow[]
  /** `loading` until the listener has answered once; `error` when it refused. */
  status: 'loading' | 'success' | 'error'
  /** There are leads beyond the window this list is showing. */
  truncated: boolean
}

/**
 * THE ORGANIZATION'S LEADS, in one listener (AGL-3275).
 *
 * This opened one listener PER SITE and merged the answers, because a lead
 * lived at `hosts/{hostId}/leads` — host-scoped by path, with no org-level
 * collection to listen to, no `orgId` on the document to group by, and no
 * rule admitting a collection-group read. All three of those are now false:
 * the collection is `orgs/{orgId}/leads` and a lead says who may see it.
 *
 * So the fan-out is gone, and with it the merge that had to cut each site's
 * window at `windowSize + 1` and the whole list again, so that a site with a
 * thousand leads could not crowd out a site with ten. One ordered query needs
 * neither: `truncated` is simply "the window came back full".
 *
 * `visibleTo` is the caller's, and `null` means "ask for everything" — which
 * is what an org-wide member's listeners do, since the rules short-circuit on
 * `isOrgWideMember()` and a clause would only narrow what they may already
 * read. A scoped member passes their tokens. See `crmVisibleToClause`, which
 * builds the same clause for every other CRM listener.
 */
export function useOrgLeads(options: {
  orgId: string | null | undefined
  /** The scope clause, or `null` for an unscoped org-wide read. */
  visibleTo: readonly string[] | null
  windowSize: number
}): OrgLeadsResult {
  const { orgId, visibleTo, windowSize } = options
  const firestore = useFirestore()
  const scopeKey = visibleTo ? visibleTo.join('\n') : null
  const [answer, setAnswer] = useState<
    { rows: OrgLeadRow[]; truncated: boolean } | 'error' | null
  >(null)

  useEffect(() => {
    setAnswer(null)
    if (!orgId) return undefined
    // An `array-contains-any` over nothing is a query Firestore refuses, so a
    // scoped member with no tokens lists nothing rather than asking.
    const tokens = scopeKey === null ? null : scopeKey ? scopeKey.split('\n') : []
    if (tokens && !tokens.length) {
      setAnswer({ rows: [], truncated: false })
      return undefined
    }
    const clauses: QueryConstraint[] = tokens
      ? [where('visibleTo', 'array-contains-any', tokens)]
      : []
    return onSnapshot(
      query(
        collection(firestore, 'orgs', orgId, 'leads'),
        ...clauses,
        orderBy('lastSeenAtMs', 'desc'),
        limit(windowSize + 1),
      ),
      (snapshot) => {
        const rows = snapshot.docs.map((entry) => ({
          ...(entry.data() as DocumentData),
          $id: entry.id,
          leadId: entry.id,
        }))
        setAnswer({
          rows: rows.slice(0, windowSize),
          truncated: rows.length > windowSize,
        })
      },
      (error) => {
        console.error(error)
        setAnswer('error')
      },
    )
  }, [firestore, orgId, scopeKey, windowSize])

  return useMemo(() => {
    if (answer === 'error') {
      return { data: [], status: 'error' as const, truncated: false }
    }
    if (!answer) return { data: [], status: 'loading' as const, truncated: false }
    return {
      data: answer.rows,
      status: 'success' as const,
      truncated: answer.truncated,
    }
  }, [answer])
}

export default useOrgLeads
