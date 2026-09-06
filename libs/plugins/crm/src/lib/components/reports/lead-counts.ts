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
 * A lead lives under its site — `hosts/{hostId}/leads`, private by path —
 * so there is no org-level collection to count and no `orgId` on the
 * document to group by. The one figure is two server counts per site and
 * a subtraction: every lead, less the closed ones, because a lead nobody
 * has touched carries no status and Firestore cannot select on a field's
 * absence (`openLeadsFromCounts`). Handed one site this is the glance
 * card's figure as it always was; handed the org's sites it is the org
 * level's total, and the fan-out is bounded by the org's site list rather
 * than by the data.
 */
export async function openLeadsAcrossSites(
  firestore: Firestore,
  hostIds: readonly string[],
): Promise<number> {
  const countOf = (target: ReturnType<typeof query>) =>
    getCountFromServer(target).then((snapshot) => snapshot.data().count)
  const perSite = await Promise.all(
    hostIds.map(async (hostId) => {
      const leads = collection(firestore, 'hosts', hostId, 'leads')
      const [total, closed] = await Promise.all([
        countOf(query(leads)),
        countOf(query(leads, where('status', 'in', CRM_LEAD_CLOSED_STATUSES))),
      ])
      return openLeadsFromCounts(total, closed)
    }),
  )
  return perSite.reduce((sum, count) => sum + count, 0)
}
