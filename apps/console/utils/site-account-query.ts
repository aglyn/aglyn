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

import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { listFilterConstraints } from '@aglyn/tenant-feature-instance'
import { where, type QueryConstraint } from 'firebase/firestore'
import { SITE_MEMBER_LIST_FILTER_FIELDS } from './list-filters'

/** Whether a clause is the Status filter, which stands beside another. */
export const isSiteAccountStatusClause = (clause: ListFilterClause): boolean =>
  clause.field === 'suspended'

/**
 * The site accounts query's constraints for the clauses in force (AGL-3321),
 * without its `limit`.
 *
 * ONE field clause is served the way the shared translator serves it, each
 * with the ordering it needs (`listFilterConstraints`), because Firestore
 * composes predicates only through indexes built for the pair. Status is the
 * exception: an EQUALITY on `suspended`, which every such ordering takes
 * beside it, so it is prefixed onto whichever query the other clause builds.
 * Each pairing has its composite in `cloud/firebase-firestore.indexes.json`
 * (`siteMembers: suspended, …`); an equality beneath a document-name order
 * needs none, since Firestore merges the single-field indexes.
 *
 * Unfiltered, and under Status alone, the list keeps its own order, which
 * the caller names (newest first, `createdAt` DESC, is what the Status
 * composite serves).
 */
export function siteAccountQueryConstraints(
  clauses: readonly ListFilterClause[],
  unfilteredOrder: readonly QueryConstraint[],
): QueryConstraint[] {
  const status = clauses.find(
    (clause) =>
      isSiteAccountStatusClause(clause) &&
      clause.op === 'equals' &&
      (clause.value === 'true' || clause.value === 'false'),
  )
  const other = clauses.find((clause) => !isSiteAccountStatusClause(clause)) ?? null
  const served = listFilterConstraints(SITE_MEMBER_LIST_FILTER_FIELDS, other)
  return [
    ...(status ? [where('suspended', '==', status.value === 'true')] : []),
    ...(served ?? unfilteredOrder),
  ]
}
