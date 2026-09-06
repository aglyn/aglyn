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

import { contactDisplayName, CRM_COLLECTIONS } from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'

export type CrmRecordKind = 'contact' | 'company' | 'deal'

/** The collection each kind of record lives in, under `orgs/{orgId}/`. */
export const CRM_RECORD_COLLECTIONS: Record<CrmRecordKind, string> = {
  contact: 'contacts',
  company: CRM_COLLECTIONS.companies,
  deal: CRM_COLLECTIONS.deals,
}

/**
 * What a record is CALLED, from its document.
 *
 * A contact's name is read through the viewing group's facet, the way the
 * people list reads it, so one business renaming a person does not change
 * what an unrelated business's task list shows; the email stands in for a
 * contact nobody has named. A company has a name and a deal a title.
 */
export function crmRecordName(
  kind: CrmRecordKind,
  data: Record<string, unknown> | undefined,
  groupId: string,
): string {
  if (!data) return ''
  switch (kind) {
    case 'contact':
      return contactDisplayName(data, groupId) || String(data['email'] ?? '')
    case 'company':
      return String(data['name'] ?? '')
    case 'deal':
      return String(data['title'] ?? '')
  }
}

/**
 * Names already read, keyed by `orgId/collection/id`, shared by every
 * mount for the life of the page.
 *
 * A task list names the same handful of records over and over — five tasks
 * about one deal are five rows and one name — and a person moves between the
 * tasks section, a contact's page and the dashboard without the records
 * changing underneath them. `null` records a document that does not exist,
 * so a task pointing at a deleted record costs one read rather than one per
 * render. A rename is picked up on the next page load, which is the right
 * staleness for a label beside a link to the record itself.
 */
const nameCache = new Map<string, string | null>()
const pending = new Map<string, Promise<void>>()

const cacheKey = (orgId: string, kind: CrmRecordKind, id: string) =>
  `${orgId}/${CRM_RECORD_COLLECTIONS[kind]}/${id}`

/** Test seam: forget everything, so a spec's fixtures are what get read. */
export function resetCrmRecordNameCache(): void {
  nameCache.clear()
  pending.clear()
}

/**
 * The names of the records a list of tasks points at, resolved once each.
 *
 * Returns a lookup rather than a map so the caller does not have to know the
 * cache's key shape. An unresolved record answers `undefined` — the cell
 * renders the link with the id until the name lands, which is one render
 * later on a warm cache and one round trip on a cold one.
 */
export function useCrmRecordNames(options: {
  orgId: string | null | undefined
  groupId: string
  records: ReadonlyArray<{ kind: CrmRecordKind; id: string }>
}): (kind: CrmRecordKind, id: string) => string | undefined {
  const { orgId, groupId, records } = options
  const firestore = useFirestore()
  // A counter rather than a copy of the cache: the cache is the source of
  // truth and this only exists to re-render when it grows.
  const [, setResolved] = useState(0)

  // The pairs as one string, so the effect runs when the SET changes and not
  // when the caller builds a new array of the same pairs on every render.
  const wanted = records
    .map((record) => `${record.kind}:${record.id}`)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .sort()
    .join('\n')

  useEffect(() => {
    if (!orgId || !wanted) return
    let active = true
    const reads: Promise<void>[] = []
    for (const entry of wanted.split('\n')) {
      const [kind, id] = entry.split(':') as [CrmRecordKind, string]
      const key = cacheKey(orgId, kind, id)
      if (nameCache.has(key)) continue
      let read = pending.get(key)
      if (!read) {
        read = getDoc(
          doc(firestore, 'orgs', orgId, CRM_RECORD_COLLECTIONS[kind], id),
        )
          .then((snapshot) => {
            nameCache.set(
              key,
              snapshot.exists()
                ? crmRecordName(
                    kind,
                    snapshot.data() as Record<string, unknown>,
                    groupId,
                  )
                : null,
            )
          })
          .catch(() => {
            // A refused or failed read is not cached: the cell keeps showing
            // the id, and the next mount tries again.
          })
          .finally(() => {
            pending.delete(key)
          })
        pending.set(key, read)
      }
      reads.push(read)
    }
    if (!reads.length) return
    void Promise.all(reads).then(() => {
      if (active) setResolved((count) => count + 1)
    })
    return () => {
      active = false
    }
  }, [firestore, orgId, groupId, wanted])

  return useCallback(
    (kind: CrmRecordKind, id: string) => {
      if (!orgId) return undefined
      const hit = nameCache.get(cacheKey(orgId, kind, id))
      return hit === null ? undefined : hit
    },
    [orgId],
  )
}
