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

import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { LivePageDropper } from '@aglyn/tenant-data-admin/server/live-page-drops'
import { announceDatasetRecordChange, type DatasetAnnounceResult } from './dataset-live-pages'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * Drops one site's pages through the platform's site cache, narrowed to the
 * addresses that repeat over the dataset — the app knows how to drop a page on
 * every address a site answers at, and this plugin knows which pages.
 */
const dropThroughSiteCache: LivePageDropper = async (target) => {
  const result = await dropPluginSiteCache({
    hostIds: [target.hostId],
    paths: { [target.hostId]: target.paths },
    reason: 'dataset records changed',
  })
  return result.complete && result.dropped > 0
}

/**
 * Refresh every live page showing this dataset's records, from one of this
 * plugin's console routes (AGL-3113).
 *
 * `announceDatasetRecordChange` works out WHICH pages a record write makes
 * stale; the drop goes through the platform's site cache. Callers `await` it:
 * the pages are supposed to be fresh by the time the editor's save returns.
 * The result is returned rather than swallowed so a route can surface the
 * shortfall warning — a refusal is the one case where the write landed and
 * the live pages stay stale for the rest of their window.
 *
 * BEST EFFORT, ALWAYS. The record has already been written by the time this
 * runs, so it never throws and never rejects.
 */
export async function announceDatasetRecords(options: {
  firestore: Firestore
  orgId: string
  datasetId: string
}): Promise<DatasetAnnounceResult> {
  return announceDatasetRecordChange({ ...options, drop: dropThroughSiteCache })
}
