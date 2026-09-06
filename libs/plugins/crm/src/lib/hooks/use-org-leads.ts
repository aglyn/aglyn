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
  type DocumentData,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'

/** One site's lead, as the organization-level list carries it. */
export interface OrgLeadRow extends DocumentData {
  /**
   * The grid's row id: `{hostId}/{leadId}`. A lead's own id is a PERSON
   * KEY — the same person on two sites has the same id on both — so the
   * document id alone cannot key a list that spans sites.
   */
  $id: string
  /** `hosts/{hostId}/leads/{leadId}` — the document id. */
  leadId: string
  /** The site the lead lives under; what every write and link names. */
  hostId: string
}

export interface OrgLeadsResult {
  /** Every site's window, merged and ordered newest-seen first, cut to the window. */
  data: OrgLeadRow[]
  /** `loading` until every site has answered once; `error` when any refused. */
  status: 'loading' | 'success' | 'error'
  /** Some site had more than its window — there are leads this list is not showing. */
  truncated: boolean
}

/**
 * THE ORGANIZATION'S LEADS, read a site at a time (AGL-2630).
 *
 * A lead lives under its site — `hosts/{hostId}/leads`, host-scoped by
 * PATH — and there is no org-level collection to listen to, no `orgId` on
 * the document to group by, and no rule admitting a collection-group read.
 * So the org hub opens one listener per site the org has, each the exact
 * query the site's own Leads section runs, and merges the answers. An
 * org-wide member is a member of every site, which is what admits each
 * listener under the rules the site section already relies on; an org has
 * a handful of sites and at most thirty in a consent group, so the fan-out
 * is bounded by the org, not by the data.
 *
 * Each site's window is cut at `windowSize + 1`, the way the site section
 * cuts its own, and the merged list is cut again at `windowSize`: the list
 * is "the most recently seen across the org", and a site with a thousand
 * leads must not crowd out a site with ten. `truncated` says some site had
 * more, so the caption beneath the table can say the window is not the
 * whole collection.
 *
 * The listeners are torn down together when the site list changes — a site
 * added or removed re-opens the set — and nothing opens for an empty list,
 * which is also how the hook stays quiet under a site, where the section
 * hands it no sites at all.
 */
export function useOrgLeads(options: {
  /** The org's sites, by document id; empty opens nothing. */
  hostIds: readonly string[]
  windowSize: number
}): OrgLeadsResult {
  const { hostIds, windowSize } = options
  const firestore = useFirestore()
  const key = hostIds.join('\n')
  const [bySite, setBySite] = useState<
    Record<string, { rows: OrgLeadRow[]; truncated: boolean } | 'error'>
  >({})

  useEffect(() => {
    setBySite({})
    const sites = key ? key.split('\n') : []
    if (!sites.length) return undefined
    const stops = sites.map((hostId) =>
      onSnapshot(
        query(
          collection(firestore, 'hosts', hostId, 'leads'),
          orderBy('lastSeenAtMs', 'desc'),
          limit(windowSize + 1),
        ),
        (snapshot) => {
          const rows = snapshot.docs.map((entry) => ({
            ...(entry.data() as DocumentData),
            $id: `${hostId}/${entry.id}`,
            leadId: entry.id,
            hostId,
          }))
          setBySite((current) => ({
            ...current,
            [hostId]: {
              rows: rows.slice(0, windowSize),
              truncated: rows.length > windowSize,
            },
          }))
        },
        (error) => {
          console.error(error)
          setBySite((current) => ({ ...current, [hostId]: 'error' }))
        },
      ),
    )
    return () => {
      for (const stop of stops) stop()
    }
  }, [firestore, key, windowSize])

  return useMemo(() => {
    const sites = key ? key.split('\n') : []
    const answers = sites.map((hostId) => bySite[hostId])
    if (answers.some((answer) => answer === 'error')) {
      return { data: [], status: 'error' as const, truncated: false }
    }
    if (!sites.length || answers.some((answer) => !answer)) {
      return { data: [], status: 'loading' as const, truncated: false }
    }
    const merged = answers
      .flatMap((answer) => (answer === 'error' || !answer ? [] : answer.rows))
      .sort(
        (a, b) =>
          Number(b['lastSeenAtMs'] ?? 0) - Number(a['lastSeenAtMs'] ?? 0),
      )
    return {
      data: merged.slice(0, windowSize),
      status: 'success' as const,
      truncated:
        merged.length > windowSize ||
        answers.some((answer) => answer !== 'error' && answer?.truncated),
    }
  }, [bySite, key, windowSize])
}

export default useOrgLeads
