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

import type { CrmReportPeriod, CrmReportRange } from '@aglyn/aglyn'
import {
  collection,
  type CollectionReference,
  type Firestore,
  type QueryConstraint,
  where,
} from 'firebase/firestore'
import type { CrmRoutes } from '../../model/crm-routes'

/**
 * What every report card is handed, resolved once by the section (AGL-2604).
 *
 * The cards are independent — each opens its own reads and draws its own
 * figures — but they must agree on four things or the page contradicts
 * itself: WHICH org's collections they read, WHO the reader is (the scope
 * tokens every query filters on), WHICH holder's facet a contact field is
 * read through, and WHEN the period starts and ends. Resolving those in the
 * section and passing them down is what keeps a card from computing its own
 * "now" a second after its neighbor's, or its own token list without the
 * org-wide token.
 */
export interface CrmReportScope {
  /** `['orgs', orgId]` — the org-shared data root every CRM collection lives under. */
  scope: readonly ['orgs', string]
  /**
   * The scope tokens this reader may see — the `array-contains-any` operand
   * of every query a card runs, and the same predicate the rules evaluate.
   */
  tokens: string[]
  /** The consent group whose facet the contact fields are read through. */
  groupId: string
  period: CrmReportPeriod
  range: CrmReportRange
  /** The moment the period was anchored at, so every card shares one clock. */
  nowMs: number
  routes: CrmRoutes
}

/** One CRM collection under the report's org. */
export function scopedCollection(
  firestore: Firestore,
  scope: CrmReportScope['scope'],
  name: string,
): CollectionReference {
  return collection(firestore, scope[0], scope[1], name)
}

/**
 * The visibility predicate, as the one clause every report query starts
 * with.
 *
 * A function rather than a convention so that a card cannot forget it: a
 * query on a CRM collection without it is permission-denied rather than a
 * leak, per the rules, but a denied aggregate renders as a dash and a
 * missing clause would be diagnosed as "the count is broken" rather than as
 * what it is.
 */
export function visibleToClause(tokens: readonly string[]): QueryConstraint {
  return where('visibleTo', 'array-contains-any', [...tokens])
}
