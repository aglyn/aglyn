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

import { CRM_LEAD_CLOSED_STATUSES, openLeadsFromCounts } from '@aglyn/aglyn'
import {
  collection,
  type Firestore,
  getCountFromServer,
  query,
  where,
} from 'firebase/firestore'

/**
 * THE LEADS STILL TO WORK, a site at a time (AGL-2624, across sites since
 * AGL-2634).
 *
 * ONE PAIR OF COUNTS, not one pair per site (AGL-3275).
 *
 * This fanned out across the org's sites and summed, because a lead lived at
 * `hosts/{hostId}/leads` and each site's collection was disjoint from every
 * other's. On the org they share one collection, and a lead two brands both
 * hold would be counted once for each of them — so the sum would report a
 * multi-brand org more open leads than it has. A single scoped count cannot
 * double-count, and costs two reads instead of two per site.
 *
 * The figure is still every lead less the closed ones, because a lead nobody
 * has touched carries no status and Firestore cannot select on a field's
 * absence (`openLeadsFromCounts`).
 *
 * `visibleTo` is the scope clause: a site's tokens for the glance card, and
 * `null` at the organization level, where an org-wide member's reads carry no
 * clause at all.
 */
export async function openLeadsForScope(
  firestore: Firestore,
  orgId: string,
  visibleTo: readonly string[] | null,
): Promise<number> {
  const countOf = (target: ReturnType<typeof query>) =>
    getCountFromServer(target).then((snapshot) => snapshot.data().count)
  const leads = collection(firestore, 'orgs', orgId, 'leads')
  // An `array-contains-any` over nothing is a query Firestore refuses.
  if (visibleTo && !visibleTo.length) return 0
  const scope = visibleTo
    ? [where('visibleTo', 'array-contains-any', [...visibleTo])]
    : []
  const [total, closed] = await Promise.all([
    countOf(query(leads, ...scope)),
    countOf(
      query(leads, ...scope, where('status', 'in', CRM_LEAD_CLOSED_STATUSES)),
    ),
  ])
  return openLeadsFromCounts(total, closed)
}
