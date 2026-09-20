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

/**
 * The console's half of a dataset record refresh (AGL-3113).
 *
 * `announceDatasetRecordChange` works out WHICH pages a record write makes
 * stale; this supplies HOW the console drops them, which is the same request
 * every other console announce sends — `postTenantRevalidate`, secret-headed,
 * retried under one budget, with the custom domain's second cache key handled
 * for it. A second hand-rolled request is how the two would come to disagree
 * about `hostId`, the field that busts `tenant-data:{hostId}` and without
 * which a dropped page faithfully regenerates from the rows it just dropped.
 *
 * BEST EFFORT, ALWAYS. The record has already been written by the time this
 * runs, so it never throws and never rejects.
 */

import {
  announceDatasetRecordChange,
  type DatasetAnnounceResult,
  type LivePageDropper,
} from '@aglyn/tenant-data-admin/server/dataset-live-pages'
import type { Firestore } from 'firebase-admin/firestore'
import { postTenantRevalidate } from './tenant-revalidate'

/** The console drops a tenant's pages by asking the tenant to. */
const dropViaTenant: LivePageDropper = async (target) => {
  const result = await postTenantRevalidate({
    subdomain: target.subdomain,
    hostId: target.hostId,
    paths: target.paths,
    ...(target.cname ? { cname: target.cname } : {}),
  })
  return result.reason === 'ok'
}

/**
 * Refresh every live page showing this dataset's records, from a console
 * server route.
 *
 * Callers `await` it: the pages are supposed to be fresh by the time the
 * editor's save returns, and the whole exchange is bounded by
 * `postTenantRevalidate`'s own budget. The result is returned rather than
 * swallowed so a route can surface the existing shortfall warning — a refusal
 * is the one case where the write landed and the live pages stay stale for the
 * rest of their window.
 */
export async function announceDatasetChange(options: {
  firestore: Firestore
  orgId: string
  datasetId: string
}): Promise<DatasetAnnounceResult> {
  return announceDatasetRecordChange({ ...options, drop: dropViaTenant })
}

export default announceDatasetChange
