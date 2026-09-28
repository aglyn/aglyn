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

import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  type ListQueryRefusal,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  collection,
  documentId,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  LICENCE_LISTING_MATCH_CAP,
  LISTING_NAME_LOOKUP,
} from '../model/listing-query'

export interface ListingNameLookup {
  /**
   * The listings a search names, for a `listingId in [...]` clause; `null`
   * when nothing is searched, so the list is not narrowed at all.
   */
  ids: string[] | null
  /** Still asking which listings the word names. */
  pending: boolean
  /** The search, refused — too many listings share the word. */
  refused: ListQueryRefusal[]
  /** Said about what was searched, e.g. one word of two. */
  notices: string[]
}

/**
 * The listings whose NAME holds a typed word (AGL-3321).
 *
 * A license row names its listing by id, and the name lives on the listing,
 * where the publisher can change it. So a license search asks the listings
 * first — `nameTokens array-contains` the word, the key every listing writer
 * stamps — and the license query then asks for those listing ids. Nothing is
 * matched over rows already loaded.
 *
 * Firestore takes at most thirty values in one `in`, so a word naming more
 * than thirty listings is refused by name rather than answered with thirty of
 * them.
 */
export function useListingNameLookup(words: readonly string[]): ListingNameLookup {
  const firestore = useFirestore()
  const plan = useMemo(
    () =>
      planListQuery(LISTING_NAME_LOOKUP, { clauses: [], search: words }, nameSearchNormalizers),
    // The words are data; their text is their identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words.join(' ')],
  )
  const read = useFirestoreCollection<{ $id: string }>(
    () =>
      plan.searched
        ? query(
            collection(firestore, 'marketplaceListings'),
            ...listQueryConstraints(plan),
            limit(LICENCE_LISTING_MATCH_CAP + 1),
          )
        : null,
    [firestore, plan.searched],
    { idField: '$id' },
  )
  if (!plan.searched) {
    return { ids: null, pending: false, refused: plan.refused, notices: [] }
  }
  if (read.status !== 'success') {
    return { ids: null, pending: true, refused: [], notices: plan.notices }
  }
  const ids = (read.data ?? []).map((row) => row.$id)
  if (ids.length > LICENCE_LISTING_MATCH_CAP) {
    return {
      ids: null,
      pending: false,
      refused: [
        {
          clause: 'search',
          reason:
            `more than ${LICENCE_LISTING_MATCH_CAP} listings have a name ` +
            'with that word — type more of it',
        },
      ],
      notices: [],
    }
  }
  return { ids, pending: false, refused: [], notices: plan.notices }
}

/**
 * Listing id → display name, for the rows on screen: read BY ID, thirty at a
 * time, so a license always names its listing however large the catalog is.
 * A listing that cannot be read keeps its id as its label.
 */
export function useListingNames(ids: readonly string[]): Record<string, string> {
  const firestore = useFirestore()
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const wanted = key ? key.split(',') : []
    if (!wanted.length) return
    let active = true
    const chunks: string[][] = []
    for (let at = 0; at < wanted.length; at += LICENCE_LISTING_MATCH_CAP) {
      chunks.push(wanted.slice(at, at + LICENCE_LISTING_MATCH_CAP))
    }
    void Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(
            collection(firestore, 'marketplaceListings'),
            where(documentId(), 'in', chunk),
          ),
        ).catch(() => null),
      ),
    ).then((snapshots) => {
      if (!active) return
      const found: Record<string, string> = {}
      for (const snapshot of snapshots) {
        for (const listing of snapshot?.docs ?? []) {
          const name = listing.get('displayName')
          if (typeof name === 'string' && name) found[listing.id] = name
        }
      }
      setNames((previous) =>
        Object.entries(found).every(([id, name]) => previous[id] === name)
          ? previous
          : { ...previous, ...found },
      )
    })
    return () => {
      active = false
    }
  }, [firestore, key])
  return names
}
