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
  collection,
  type Firestore,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'

/** Firestore caps an `in` at thirty values. */
const IN_LIMIT = 30

type TemplateDoc = Record<string, any> & { $id: string }

/** A starter's live pages in the order its author wrote them. */
const inStarterOrder = (pages: TemplateDoc[]): TemplateDoc[] =>
  pages
    .filter((page) => !page.deletedAt)
    .sort(
      (a, b) =>
        Number(a.source?.starterOrder ?? 0) - Number(b.source?.starterOrder ?? 0),
    )

/**
 * The pages of the STARTERS a list is showing, read by starter id (AGL-3321).
 *
 * The templates library and the gallery list a multi-page starter as ONE row
 * (AGL-696), led by one of its pages (`libraryRow`). The row's page count and
 * its bundle actions need every page, and those are the starter's own small,
 * fixed set — so they are asked for by `source.starterId`, never found by
 * scanning a window of the library.
 *
 * `pagesOf` reads one starter's pages FRESH, for an action: the row may have
 * been drawn before its pages arrived, and a bundle action must never act on
 * a partial set.
 */
export function useStarterPages(
  firestore: Firestore,
  hostId: string,
  starterIds: readonly string[],
  epoch = 0,
): {
  pages: ReadonlyMap<string, TemplateDoc[]>
  pagesOf: (starterId: string) => Promise<TemplateDoc[]>
} {
  const key = useMemo(
    () =>
      [...new Set(starterIds.filter((id) => typeof id === 'string' && id !== ''))]
        .sort()
        .join(','),
    [starterIds],
  )
  const [pages, setPages] = useState<ReadonlyMap<string, TemplateDoc[]>>(new Map())
  useEffect(() => {
    const ids = key ? key.split(',') : []
    if (!ids.length || !hostId) {
      setPages((held) => (held.size ? new Map() : held))
      return
    }
    let active = true
    const chunks: string[][] = []
    for (let at = 0; at < ids.length; at += IN_LIMIT) {
      chunks.push(ids.slice(at, at + IN_LIMIT))
    }
    void Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(
            collection(firestore, 'hosts', hostId, 'templates'),
            where('source.starterId', 'in', chunk),
          ),
        ),
      ),
    )
      .then((snapshots) => {
        if (!active) return
        const byStarter = new Map<string, TemplateDoc[]>()
        for (const snapshot of snapshots) {
          for (const entry of snapshot.docs) {
            const data = { $id: entry.id, ...entry.data() } as TemplateDoc
            const id = String(data.source?.starterId ?? '')
            byStarter.set(id, [...(byStarter.get(id) ?? []), data])
          }
        }
        for (const [id, list] of byStarter) byStarter.set(id, inStarterOrder(list))
        setPages(byStarter)
      })
      .catch((error) => {
        // A row still stands for its lead page; the count and the bundle
        // actions wait for the pages rather than acting on a partial set.
        console.error(error)
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, key, epoch])

  const pagesOf = useCallback(
    async (starterId: string): Promise<TemplateDoc[]> => {
      const snapshot = await getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'templates'),
          where('source.starterId', '==', starterId),
        ),
      )
      return inStarterOrder(
        snapshot.docs.map((entry) => ({ $id: entry.id, ...entry.data() }) as TemplateDoc),
      )
    },
    [firestore, hostId],
  )

  return { pages, pagesOf }
}

export default useStarterPages
