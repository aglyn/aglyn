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
 *               for the enrollments made before it;
 *   clicked     (AGL-3332) whether the person clicked a link: `clicked`,
 *               `false` at enrollment and set by the click route's
 *               transaction on a person's click (never a scanner's), and
 *               stamped from `engagement.clicks` by the same backfill;
 *   link        (AGL-3332) a destination they followed, whole:
 *               `engagement.links`, the capped array the click route keeps,
 *               asked with `array-contains-any` — the query's one array
 *               clause, so it and the search cannot stand together and the
 *               plan refuses the pair by name. The backfill seeds it with an
 *               earlier click's `lastClickUrl`, the one destination such a
 *               click is known by.
 *
 * The step, the next send and the last activity are not offered: each is
 * derived from the sequence's steps or from several fields, and a query can
 * ask none of them.
 */

/** The array the search box reads, stamped by the enroll route. */
export const OUTREACH_ENROLLMENT_SEARCH_TOKENS = 'searchTokens'

/** Whether the person clicked (AGL-3332): what the "Clicked" filter asks. */
export const OUTREACH_ENROLLMENT_CLICKED = 'clicked'

/** The destinations followed (AGL-3332): what the "Link followed" filter asks. */
export const OUTREACH_ENROLLMENT_LINKS_PATH = 'engagement.links'

/** The fields the table offers only for a sequence that counts clicks. */
export const OUTREACH_ENROLLMENT_CLICK_FIELDS = ['clicked', 'link'] as const

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
    { column: 'clicked', kind: 'boolean', path: OUTREACH_ENROLLMENT_CLICKED, operators: ['equals'] },
    {
      column: 'link',
      kind: 'exact',
      path: OUTREACH_ENROLLMENT_LINKS_PATH,
      tokensPath: OUTREACH_ENROLLMENT_LINKS_PATH,
      operators: ['isAnyOf'],
    },
  ],
  /*
   * The headers (AGL-3680). `buildOutreachEnrollment` stores every one of
   * these on every enrollment from its first write — `stopReason` and
   * `nextDueAtMs` as null until they apply — so each orders the query,
   * `alone`: beside the `sequenceId` base that is one composite per order.
   * Each costs a composite, so only Person (the stored lower-cased address)
   * sorts both ways; Status and Stop reason group, Current step reads from
   * the first step and Next send from the soonest, one direction each.
   * Last activity and the engagement figures are derived from
   * `engagement.*`, which is absent until the first event, and sort the page.
   */
  sorts: [
    { path: 'createdAtMs', direction: 'desc', label: 'newest enrolled first' },
    { path: 'email', direction: 'asc', column: 'person', label: 'Person', alone: true },
    { path: 'email', direction: 'desc', column: 'person', label: 'Person', alone: true },
    { path: 'status', direction: 'asc', column: 'status', label: 'Status', alone: true },
    { path: 'stepIndex', direction: 'asc', column: 'step', label: 'Current step', alone: true },
    { path: 'nextDueAtMs', direction: 'asc', column: 'nextSend', label: 'Next send', alone: true },
    { path: 'stopReason', direction: 'asc', column: 'stopReason', label: 'Stop reason', alone: true },
  ],
  search: { tokensPath: OUTREACH_ENROLLMENT_SEARCH_TOKENS },
}

/** The scope every page of the table carries: this sequence's people. */
export function outreachEnrollmentListBase(sequenceId: string): ListQueryFilter[] {
  return [{ path: 'sequenceId', op: '==', value: sequenceId }]
}
