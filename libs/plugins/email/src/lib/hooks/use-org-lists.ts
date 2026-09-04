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
 * The org's audiences, as the options of a picker.
 *
 * The sibling of `use-org-contact-segments.ts` and deliberately its twin: a
 * LOOKUP rather than a list. Nothing pages this — it fills the options of one
 * `Select` that a reader opens rather than walks, and the window is bounded so
 * an org with a thousand audiences cannot turn a dropdown into an unbounded
 * read. The paged surface that answers the other question already exists in
 * `lists-card.tsx`.
 *
 * `orderBy('name')` is safe here, and that is a claim about the writer rather
 * than a preference: the create drawer in `lists-card.tsx` is the only thing
 * that creates a list and it refuses an empty name. `orderBy` filters as well
 * as sorts, so a list written without one would be missing from its own picker
 * rather than merely out of order.
 */

import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/** One audience, as the picker needs it. */
export interface OrgListOption {
  $id: string
  name?: string
}

/** The picker's window. Matches the segment picker beside it. */
export const LIST_PICKER_LIMIT = 50

export function useOrgLists(
  scope: readonly [string, string],
): OrgListOption[] {
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<OrgListOption>(
    () =>
      query(
        collection(firestore, scope[0], scope[1], 'lists'),
        orderBy('name'),
        limit(LIST_PICKER_LIMIT),
      ),
    [firestore, scope[0], scope[1]],
    { idField: '$id' },
  )
  return data ?? []
}
