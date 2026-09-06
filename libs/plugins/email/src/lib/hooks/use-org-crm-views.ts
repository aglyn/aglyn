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
 * The org's saved Contacts views that can be an audience, for the rule
 * editor's picker (AGL-2617).
 *
 * A LOOKUP like the segment picker's, and bounded for the same reason. Two
 * things narrow it past the segments'. It lists only the views this reader
 * would see on the Contacts list — their own and the shared ones — because
 * a private view is one person's working arrangement and offering it as a
 * colleague's audience would put it to a use its owner never saw. And it
 * lists only views that TRANSLATE WHOLE into the rule language: a view
 * carrying a name prefix or an `updatedAt` window has no audience meaning,
 * and the sweep would refuse it by narrowing to nobody — so the picker
 * does not offer what the sweep cannot honor.
 *
 * Scoped like the field picker: the reader's own tokens filter the query
 * for a scoped member, and an org-wide member reads the section unfiltered
 * on the `(section, name)` index.
 */

import {
  CRM_COLLECTIONS,
  crmViewIsListed,
  dynamicListDimensionsForCrmView,
  normalizeCrmViewFilters,
} from '@aglyn/aglyn'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'

/** One saved view, as the picker needs it. */
export interface OrgCrmViewOption {
  $id: string
  name: string
}

export const CRM_VIEW_PICKER_LIMIT = 50

export function useOrgCrmViews(
  scope: readonly [string, string],
): OrgCrmViewOption[] {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = (user as { uid?: string } | null | undefined)?.uid ?? null
  const { tokens, orgWide, loaded } = useScopeTokens(scope[1])
  const { data } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      // Not until the viewer's reach is known — see the field picker.
      loaded
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.views),
            ...(orgWide ? [] : [where('visibleTo', 'array-contains-any', tokens)]),
            where('section', '==', 'contacts'),
            orderBy('name'),
            limit(CRM_VIEW_PICKER_LIMIT),
          )
        : null,
    [firestore, scope[0], scope[1], loaded, orgWide, tokens],
    { idField: '$id' },
  )
  return useMemo(
    () =>
      (data ?? [])
        .filter(
          (row) =>
            typeof row['name'] === 'string' &&
            row['name'] &&
            crmViewIsListed(
              {
                shared: row['shared'] === true,
                ownerUid: String(row['ownerUid'] ?? ''),
              },
              uid,
            ) &&
            dynamicListDimensionsForCrmView(normalizeCrmViewFilters(row['filters']))
              .unsupported.length === 0,
        )
        .map((row) => ({ $id: String(row['$id']), name: String(row['name']) })),
    [data, uid],
  )
}

export default useOrgCrmViews
