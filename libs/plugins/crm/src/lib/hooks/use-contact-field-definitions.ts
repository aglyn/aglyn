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
  activeContactFieldDefinitions,
  CONTACT_FIELDS_MAX_PER_ORG,
  type ContactFieldDefinition,
  CRM_COLLECTIONS,
  sortContactFieldDefinitions,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useMemo } from 'react'

/** A stored definition, with the document id every write needs. */
export interface ContactFieldDefinitionDoc extends ContactFieldDefinition {
  $id: string
}

export interface ContactFieldDefinitionsResult {
  /** Every definition, retired ones included, in `order`. */
  definitions: ContactFieldDefinitionDoc[]
  /** The definitions a value may still be written under, in `order`. */
  active: ContactFieldDefinitionDoc[]
  /**
   * Whether the answer above is the server's. False while the listen is
   * settling or while there is no org to ask, so a surface that would draw
   * "no fields yet" waits rather than saying it for one paint.
   */
  ready: boolean
  /** The rows have been seen by the server — `writeGuardedBySeed`'s input. */
  fromCache: boolean
}

const EMPTY: ContactFieldDefinitionDoc[] = []

/**
 * The org's custom contact field definitions, sorted, for every surface that
 * needs them (AGL-2601): the Fields list, the contact list's columns, the
 * profile card, the form editor's mapping picker, an import's target list
 * and an audience filter's field menu.
 *
 * ONE bounded read of a small collection. `orgs/{orgId}/contactFields` has
 * no index — it is read whole, ordered by document id so the query needs
 * none, and sorted by `order` here in memory; `CONTACT_FIELDS_MAX_PER_ORG`
 * is the ceiling on that read and the one every reader shares. The listen is
 * cached per org by the Firestore SDK itself: two mounts asking for the same
 * query share one target and one set of documents, so a page with the list
 * and the columns both open pays for the collection once, and a write from
 * the Fields section reaches every reader without an invalidation to forget.
 *
 * `orgId` rather than `hostId` because definitions are ORG-WIDE — the org is
 * what the reader has already resolved through `useOrgDataScope`, and a hook
 * that resolved it again would be a second lookup per surface. Null while
 * that lookup is in flight issues no query at all.
 */
export function useContactFieldDefinitions(
  orgId: string | null | undefined,
): ContactFieldDefinitionsResult {
  const firestore = useFirestore()
  const { data, status, fromCache } =
    useFirestoreCollection<ContactFieldDefinitionDoc>(
      () =>
        orgId
          ? query(
              collection(
                firestore,
                'orgs',
                orgId,
                CRM_COLLECTIONS.contactFields,
              ),
              orderBy(documentId()),
              limit(CONTACT_FIELDS_MAX_PER_ORG),
            )
          : null,
      [firestore, orgId],
      { idField: '$id' },
    )
  const definitions = useMemo(
    () => (data?.length ? sortContactFieldDefinitions(data) : EMPTY),
    [data],
  )
  const active = useMemo(
    () => (definitions.length ? activeContactFieldDefinitions(definitions) : EMPTY),
    [definitions],
  )
  return {
    definitions,
    active,
    ready: Boolean(orgId) && status !== 'loading',
    fromCache,
  }
}

export default useContactFieldDefinitions
