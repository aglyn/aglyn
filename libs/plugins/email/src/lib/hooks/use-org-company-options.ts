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

/**
 * The org's companies, as a SEARCH rather than a list (AGL-2603).
 *
 * A picker over every company an org has is the unbounded read this console
 * refuses, and a company list is exactly the collection that grows past any
 * dropdown. So the control is a search box: what the merchant types becomes
 * a prefix range on `nameLower`, the key `nameSearchFields` writes beside
 * every company name, bounded to one screen of hits. Nothing is read until
 * something is typed.
 *
 * ## The chosen ids keep their names
 *
 * A rule stores company IDS, and a chip reading `co_8f2a…` tells the reader
 * nothing. The hook keeps a name for every id it has ever seen — from a hit,
 * or from a keyed read of a stored id the search never touched — so a rule
 * reopened months later still names the company it filters on. A keyed
 * `getDoc` rather than an `in` query, because an `in` on document ids cannot
 * be combined with the `array-contains-any` a scoped viewer's query needs,
 * and a document read is evaluated by the rules per document either way.
 *
 * ## Scoped like the contacts themselves
 *
 * The same viewer-token narrowing every CRM read applies; an org-wide member
 * searches without a filter.
 */

import { CRM_COLLECTIONS, nameSearchKey } from '@aglyn/aglyn'
import {
  collection,
  doc,
  endAt,
  getDoc,
  limit,
  orderBy,
  query,
  startAt,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useScopeTokens,
} from '@aglyn/tenant-feature-instance'

/** One company, as much of it as a picker needs. */
export interface OrgCompanyOption {
  id: string
  label: string
}

/** How many hits one typed prefix returns. */
export const COMPANY_SEARCH_LIMIT = 20

/** How many stored ids a reopened rule resolves names for, by keyed read. */
const COMPANY_NAME_RESOLUTION_CAP = 30

export function useOrgCompanyOptions(options: {
  scope: readonly [string, string]
  /** What the merchant has typed. Empty reads nothing. */
  search: string
  /** The ids the rule already names, whose names the chips need. */
  selectedIds: readonly string[]
}): {
  hits: OrgCompanyOption[]
  /** Every name known, by id — hits and resolved selections alike. */
  names: Record<string, string>
  searching: boolean
} {
  const { scope, search, selectedIds } = options
  const firestore = useFirestore()
  const { tokens, orgWide, loaded } = useScopeTokens(scope[1])
  const key = nameSearchKey(search)

  const { data, status } = useFirestoreCollection<{
    $id: string
    name?: string
  }>(
    () =>
      key && loaded
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies),
            ...(orgWide ? [] : [where('visibleTo', 'array-contains-any', tokens)]),
            orderBy('nameLower'),
            startAt(key),
            endAt(key + ''),
            limit(COMPANY_SEARCH_LIMIT),
          )
        : null,
    [firestore, scope[0], scope[1], key, loaded, orgWide, tokens],
    { idField: '$id' },
  )

  /*
   * Names accumulate and are never forgotten within the form's life: a hit
   * that scrolls out of the current search is still the company a chip
   * names. Keyed by id, and only ever ADDED to, so a stored id resolved once
   * is not resolved again on every keystroke.
   */
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const hitNames = useMemo(
    () =>
      Object.fromEntries(
        (data ?? []).map((row) => [row.$id, String(row.name ?? row.$id)]),
      ),
    [data],
  )
  const unresolved = useMemo(
    () =>
      selectedIds
        .filter((id) => !(id in resolved) && !(id in hitNames))
        .slice(0, COMPANY_NAME_RESOLUTION_CAP),
    [selectedIds, resolved, hitNames],
  )
  useEffect(() => {
    if (!unresolved.length) return
    let active = true
    void Promise.all(
      unresolved.map(async (id) => {
        try {
          const snapshot = await getDoc(
            doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies, id),
          )
          return [id, String(snapshot.get('name') ?? id)] as const
        } catch {
          // A company the viewer may not read, or one that was deleted,
          // keeps its id as its name rather than blocking the others.
          return [id, id] as const
        }
      }),
    ).then((entries) => {
      if (active) {
        setResolved((held) => ({ ...held, ...Object.fromEntries(entries) }))
      }
    })
    return () => {
      active = false
    }
  }, [unresolved, firestore, scope])

  return useMemo(
    () => ({
      hits: (data ?? []).map((row) => ({
        id: row.$id,
        label: String(row.name ?? row.$id),
      })),
      names: { ...resolved, ...hitNames },
      searching: Boolean(key) && status === 'loading',
    }),
    [data, resolved, hitNames, key, status],
  )
}

export default useOrgCompanyOptions
