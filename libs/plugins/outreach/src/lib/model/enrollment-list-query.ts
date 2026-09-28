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

import type {
  ListQueryDeclaration,
  ListQueryFilter,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'

/*
 * WHAT A SEQUENCE'S ENROLLMENTS TABLE ASKS FIRESTORE (AGL-3321).
 *
 * One query over `orgs/{orgId}/outreachEnrollments`, narrowed to the
 * sequence (`sequenceId ==`, the list's base) and ordered newest enrolled
 * first, paged by that query. Every clause the Filters panel offers and the
 * search box are predicates on it:
 *
 *   status      the stored status, on every enrollment;
 *   target      `contact` or `lead`, on every enrollment (the ones made
 *               before leads could be sequenced gain `contact` from the
 *               backfill);
 *   stopReason  the stored reason code — the column shows its label and the
 *               stop detail, the query asks by code;
 *   email       the whole address, stored normalized, so `equals` is exact;
 *   enrolled    the table's ONE range: when the person was enrolled, the
 *               field the table is already ordered by, so it costs no index
 *               of its own;
 *   search      `searchTokens`: every prefix of the person's name and of
 *               their address and its parts, stamped at enrollment by the
 *               enroll route and by `tools/scripts/backfill-outreach-list-search.mjs`
 *               for the enrollments made before it.
 *
 * The step, the next send and the last activity are not offered: each is
 * derived from the sequence's steps or from several fields, and a query can
 * ask none of them.
 */

/** The array the search box reads, stamped by the enroll route. */
export const OUTREACH_ENROLLMENT_SEARCH_TOKENS = 'searchTokens'

export const OUTREACH_ENROLLMENT_LIST_QUERY: ListQueryDeclaration = {
  fields: [
    { column: 'status', kind: 'exact', path: 'status', presence: 'always', operators: ['equals', 'isAnyOf'] },
    { column: 'target', kind: 'exact', path: 'target', presence: 'always', operators: ['equals'] },
    { column: 'stopReason', kind: 'exact', path: 'stopReason', operators: ['equals', 'isAnyOf'] },
    { column: 'email', kind: 'text', path: 'email', lowerPath: 'email', operators: ['equals'] },
    {
      column: 'enrolled',
      kind: 'date',
      path: 'createdAtMs',
      storedAs: 'millis',
      presence: 'always',
      operators: ['is', 'after', 'onOrAfter', 'before', 'onOrBefore'],
    },
  ],
  sorts: [{ path: 'createdAtMs', direction: 'desc' }],
  search: { tokensPath: OUTREACH_ENROLLMENT_SEARCH_TOKENS },
}

/** The scope every page of the table carries: this sequence's people. */
export function outreachEnrollmentListBase(sequenceId: string): ListQueryFilter[] {
  return [{ path: 'sequenceId', op: '==', value: sequenceId }]
}
