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
 * The org's custom contact field DEFINITIONS, for the rule editor to offer
 * (AGL-2603).
 *
 * A twin of `use-org-lists.ts`: a LOOKUP that fills one control's options,
 * bounded so an org cannot turn the dropdown into an unbounded read. The
 * definitions live in `orgs/{orgId}/contactFields` and the values a rule
 * compares against live under each contact facet's `custom`, keyed by the
 * definition's `key` — so the picker offers keys, and the clause it authors
 * names one.
 *
 * ## Scoped like the contacts themselves
 *
 * The rules gate the collection on the contacts predicate, per document, so
 * a collaborator scoped to one site reading it unfiltered is refused rather
 * than shown less. The viewer's scope tokens narrow the query the way every
 * CRM read is narrowed; an org-wide member reads without a filter, which is
 * what keeps a definition the backfill never stamped from vanishing for them.
 *
 * ## A retired field is offered nowhere new
 *
 * `retiredAt` is a retirement, not a deletion: values written under the key
 * survive and an export still reads them back. A rule written before the
 * retirement keeps its clause — the editor shows the key it names — but the
 * picker stops offering the field, because a merchant building a new
 * audience on a field their team has retired is building it on a value
 * nobody is maintaining.
 */

import { CRM_COLLECTIONS, type ContactFieldDefinition } from '@aglyn/aglyn'
import { collection, limit, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useScopeTokens,
} from '@aglyn/tenant-feature-instance'

/** One definition, as the picker and the value control need it. */
export type OrgContactFieldOption = Pick<
  ContactFieldDefinition,
  'key' | 'label' | 'type' | 'options' | 'order'
> & { $id: string }

/** The picker's window. Matches the list and segment pickers beside it. */
export const CONTACT_FIELD_PICKER_LIMIT = 50

export function useOrgContactFields(
  scope: readonly [string, string],
): { fields: OrgContactFieldOption[]; ready: boolean } {
  const firestore = useFirestore()
  const { tokens, orgWide, loaded } = useScopeTokens(scope[1])
  const { data, status } = useFirestoreCollection<
    OrgContactFieldOption & { retiredAt?: number | null }
  >(
    () =>
      // Not until the viewer's reach is known: `useScopeTokens` reports
      // org-wide while loading, and a scoped member's first render would
      // send an unfiltered query the rules deny per document.
      loaded
        ? query(
            collection(
              firestore,
              scope[0],
              scope[1],
              CRM_COLLECTIONS.contactFields,
            ),
            ...(orgWide ? [] : [where('visibleTo', 'array-contains-any', tokens)]),
            limit(CONTACT_FIELD_PICKER_LIMIT),
          )
        : null,
    [firestore, scope[0], scope[1], loaded, orgWide, tokens],
    { idField: '$id' },
  )
  return useMemo(
    () => ({
      fields: (data ?? [])
        .filter((field) => !field.retiredAt && typeof field.key === 'string')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map(({ $id, key, label, type, options, order }) => ({
          $id,
          key,
          label: label || key,
          type,
          ...(options ? { options } : {}),
          order: order ?? 0,
        })),
      ready: loaded && status !== 'loading',
    }),
    [data, loaded, status],
  )
}

export default useOrgContactFields
