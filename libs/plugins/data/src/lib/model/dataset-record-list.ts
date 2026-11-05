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
 * The `visibleTo` tokens a list of datasets asks for, or `null` for no filter.
 *
 * Narrowed to a site, the site decides, whoever is looking: an owner who
 * reaches every dataset still sees only that site's and the workspace-wide
 * ones on that site's pages. With no site, the member's own reach decides:
 * their scope tokens, or `null` for an organization-wide member, who reads
 * everything.
 *
 * A site's tokens are a subset of those of anyone who can open the site, so
 * the query also satisfies the `canReadScoped` rule for a site collaborator.
 */
export function datasetListScope(request: {
  hostId?: string | null
  memberScope?: readonly string[] | null
}): readonly string[] | null {
  return request.hostId ? scopeTokensForHost(request.hostId) : (request.memberScope ?? null)
}

/**
 * The workspace's datasets, listed in the console for another plugin's picker
 * or check (AGL-3080) — an automation step choosing the dataset it writes to,
 * a reference check confirming one still exists.
 *
 * Narrowed to a site (`hostId`), the query asks only for the datasets shared
 * with it, by the site's scope tokens: an automation runs on the site, so it
 * may only reach datasets the site can use, and the filter is the one the
 * security rules require of a member scoped to the site. With no site, a
 * member who is not organization-wide (`memberScope`) is asked for the ones
 * shared with any site they reach — the rules refuse them an unfiltered
 * list — and an organization-wide reader lists the organization's own.
 * `installedFrom` keeps the ones installed from that listing, by the
 * `source.listingId` every dataset install stamps.
 *
 * Ordered by document id, which the automatic index serves beside the
 * `visibleTo` filter, and the composite index on (`source.listingId`,
 * `visibleTo`) beside both. Each record is `datasetIndexedRecord`'s, the
 * server index's shape.
 */
export const datasetRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.orgId) return null
    const scope = datasetListScope(request)
    return query(
      collection(firestore, 'orgs', request.orgId, 'datasets'),
      ...(request.installedFrom ? [where('source.listingId', '==', request.installedFrom)] : []),
      ...(scope ? [where('visibleTo', 'array-contains-any', [...scope])] : []),
      orderBy(documentId()),
      limit(request.limit),
    )
  },
  record: datasetIndexedRecord,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerDatasetRecordList(): void {
  registerPluginRecordListSource('dataset', datasetRecordListSource, { pluginId: BUNDLE_ID })
}
