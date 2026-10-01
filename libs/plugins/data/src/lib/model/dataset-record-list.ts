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

import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { datasetIndexedRecord } from './dataset-record'

/**
 * The workspace's datasets, listed in the console for another plugin's picker
 * or check (AGL-3080) — an automation step choosing the dataset it writes to,
 * a reference check confirming one still exists.
 *
 * Narrowed to a site (`hostId`), the query asks only for the datasets shared
 * with it, by the site's scope tokens: an automation runs on the site, so it
 * may only reach datasets the site can use, and the filter is the one the
 * security rules require of a member scoped to the site. With no site it lists
 * the organization's own, which only an organization-wide reader may hold.
 * Ordered by document id, which the automatic index serves beside the
 * `visibleTo` filter. Each record is `datasetIndexedRecord`'s, the server
 * index's shape.
 */
export const datasetRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId) return null
    const datasets = collection(firestore, 'orgs', request.orgId, 'datasets')
    return request.hostId
      ? query(
          datasets,
          where('visibleTo', 'array-contains-any', scopeTokensForHost(request.hostId)),
          orderBy(documentId()),
          limit(request.limit),
        )
      : query(datasets, orderBy(documentId()), limit(request.limit))
  },
  record: datasetIndexedRecord,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerDatasetRecordList(): void {
  registerPluginRecordListSource('dataset', datasetRecordListSource, { pluginId: BUNDLE_ID })
}
