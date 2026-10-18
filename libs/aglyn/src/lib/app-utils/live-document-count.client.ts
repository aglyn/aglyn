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

import { getCountFromServer, query, where, type Query } from 'firebase/firestore'
import { liveDocumentCount, TOMBSTONE_FIELD } from './live-document-count'

/**
 * The web SDK's half of the live-count rule (AGL-3918): how many of
 * [documents] are not deleted, as `/api/hosts/resources` counts them for a
 * plan allowance. Every document less the tombstones (`deletedAt != null`);
 * an archived document is live and counted. See `live-document-count.ts` for
 * why it is two aggregates.
 *
 * Rejects when either aggregate is refused, so a caller keeps whatever
 * fallback it already has rather than reading a confident 0.
 */
export async function getLiveCountFromServer(documents: Query): Promise<number> {
  const [total, tombstones] = await Promise.all([
    getCountFromServer(documents),
    getCountFromServer(query(documents, where(TOMBSTONE_FIELD, '!=', null))),
  ])
  return liveDocumentCount(total.data().count, tombstones.data().count)
}
