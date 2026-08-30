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
 * The org's saved contact segments, for a picker to offer.
 *
 * A LOOKUP, not a list. Nothing pages this: it fills the options of one
 * `Select`, a reader opens it rather than walking it, and the window is
 * bounded so an org with a thousand segments cannot turn one dropdown into an
 * unbounded read. That is a different question from the one a paged table
 * answers, and keeping the read in its own module is what stops the form that
 * renders the dropdown reading like a list surface that forgot its footer.
 *
 * `orderBy('name')` is safe here, which is a claim about the writer rather
 * than a preference: `handleSaveSegment` in the contacts console is the only
 * thing that creates a segment and it refuses an empty name. `orderBy` filters
 * as well as sorts, so a segment written without one would be missing from its
 * own picker rather than merely out of order.
 */

import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/** One saved segment, as the picker needs it. */
export interface OrgContactSegment {
  $id: string
  name?: string
}

/**
 * The picker's window.
 *
 * Bounded rather than paged — see the module note. A rule that names a segment
 * beyond this window still shows its own reference: the picker adds the stored
 * id as an option of its own, because a `Select` whose value is absent from
 * its options renders empty, and saving from that screen would erase the
 * reference the merchant could not see.
 */
export const SEGMENT_PICKER_LIMIT = 50

export function useOrgContactSegments(
  scope: readonly [string, string],
): OrgContactSegment[] {
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<OrgContactSegment>(
    () =>
      query(
        collection(firestore, scope[0], scope[1], 'contactSegments'),
        orderBy('name'),
        limit(SEGMENT_PICKER_LIMIT),
      ),
    [firestore, scope[0], scope[1]],
    { idField: '$id' },
  )
  return data ?? []
}
