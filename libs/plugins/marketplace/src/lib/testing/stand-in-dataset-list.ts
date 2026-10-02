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
import { registerPluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { collection, documentId, limit, orderBy, query, where } from 'firebase/firestore'

/** A dataset's name as the Data page shows it: its display name, else its legacy name. */
function datasetName(data: Readonly<Record<string, unknown>>): string {
  for (const candidate of [data['displayName'], data['name']]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

/**
 * The `dataset` list source the plugin that keeps the workspace's datasets
 * publishes (AGL-3080), stood in for this plugin's specs — this plugin may
 * not load the data plugin. It builds the query that plugin's
 * `dataset-record-list.ts` builds (installed from a listing by its
 * `source.listingId`, narrowed by a site's or a member's scope tokens,
 * ordered by document id) from whatever `firebase/firestore` the spec stages,
 * and reads a row as a live dataset named as the Data page names it, with the
 * listing it was installed from. What the data plugin itself answers is held
 * in its own spec.
 */
export function standInDatasetList(): void {
  registerPluginRecordListSource(
    'dataset',
    {
      query(firestore, request) {
        if (!request.orgId) return null
        const scope = request.hostId ? scopeTokensForHost(request.hostId) : (request.memberScope ?? null)
        return query(
          collection(firestore, 'orgs', request.orgId, 'datasets'),
          ...(request.installedFrom ? [where('source.listingId', '==', request.installedFrom)] : []),
          ...(scope ? [where('visibleTo', 'array-contains-any', [...scope])] : []),
          orderBy(documentId()),
          limit(request.limit),
        )
      },
      record(id, data) {
        if (!data || data['deletedAt'] != null) return null
        const source = (data['source'] ?? {}) as Record<string, unknown>
        const listingId = typeof source['listingId'] === 'string' ? source['listingId'] : ''
        return {
          id,
          name: datasetName(data) || id,
          facts: {
            fields: [],
            visibleTo: Array.isArray(data['visibleTo']) ? data['visibleTo'] : [],
            installedFrom: listingId ? { listingId, version: source['version'] ?? null } : null,
          },
        }
      },
    },
    { pluginId: 'data' },
  )
}

/** Forgets it, so a spec can ask what happens where no plugin keeps datasets. */
export function removeStandInDatasetList(): void {
  unregisterPluginServices('data')
}
