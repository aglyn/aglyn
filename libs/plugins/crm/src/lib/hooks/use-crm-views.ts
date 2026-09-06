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
  CRM_COLLECTIONS,
  type CrmSavedView,
  type CrmViewSection,
  crmViewIsListed,
  normalizeCrmViewState,
} from '@aglyn/aglyn'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { crmScopeListable, crmVisibleToClause } from './use-crm-scope'

/** One saved view as the menu lists it: the document, held to shape, with its id. */
export interface CrmSavedViewRow extends CrmSavedView {
  $id: string
}

/**
 * The menu's window.
 *
 * A LOOKUP, not a list: nothing pages this, a reader opens a menu rather
 * than walking it, and a hundred named views for one section of one org is
 * past what anybody scrolls. Bounded so the listen cannot grow with the
 * org; a view past the window is still reachable by its address, which
 * resolves through the same rows and so reads as "not listed" rather than
 * as missing — see the controller.
 */
export const CRM_VIEWS_LIMIT = 100

/**
 * The saved views of one section, mine and shared (AGL-2617).
 *
 * ONE listener, filtered on the reader's own tokens like every CRM read,
 * narrowed to the section and ordered by name — the `(visibleTo, section,
 * name)` index. What the rules admit is wider than what the menu shows: a
 * colleague's private view is readable under the contacts predicate and
 * hidden here by `crmViewIsListed`, because the privacy of a working
 * arrangement is a courtesy between colleagues rather than a disclosure
 * boundary, and a rule per reader would need a query per reader.
 *
 * `orderBy('name')` also FILTERS: a view written without a name would be
 * missing from its own menu. The controller refuses an empty name, which is
 * the only writer.
 */
export function useCrmViews(options: {
  scope: readonly ['orgs', string] | null
  /** The reader's tokens, or `null` at the organization level — no clause (AGL-2630). */
  visibleTo: readonly string[] | null
  section: CrmViewSection
  uid: string | null | undefined
}): { views: CrmSavedViewRow[]; ready: boolean } {
  const { scope, visibleTo, section, uid } = options
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      scope && crmScopeListable(visibleTo)
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.views),
            ...crmVisibleToClause(visibleTo),
            where('section', '==', section),
            orderBy('name'),
            limit(CRM_VIEWS_LIMIT),
          )
        : null,
    [firestore, scope, visibleTo, section],
    { idField: '$id' },
  )
  const views = useMemo<CrmSavedViewRow[]>(
    () =>
      (data ?? [])
        .map((row) => ({
          $id: String(row['$id']),
          section,
          name: String(row['name'] ?? ''),
          ownerUid: String(row['ownerUid'] ?? ''),
          createdByUid: String(row['createdByUid'] ?? ''),
          shared: row['shared'] === true,
          hostId: String(row['hostId'] ?? ''),
          visibleTo: Array.isArray(row['visibleTo'])
            ? (row['visibleTo'] as string[])
            : [],
          createdAt: row['createdAt'],
          updatedAt: row['updatedAt'],
          ...normalizeCrmViewState(row),
        }))
        .filter((view) => view.name && crmViewIsListed(view, uid)),
    [data, section, uid],
  )
  return { views, ready: Boolean(scope) && status !== 'loading' }
}

export default useCrmViews
