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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { type DatasetModel, effectiveDatasetModel } from './dataset-models'
import { datasetDisplayName } from './datasets'

/**
 * One stored dataset as this plugin shares it with another (AGL-3080) — the
 * one shape its server index (`dataset-record-index.ts`) and its console list
 * source (`dataset-record-list.ts`) both answer, so a reader on either side
 * reads the same record.
 *
 * `null` for a deleted dataset. Otherwise its id, its name as the Data page
 * shows it, and `facts`:
 *   `fields` — its fields in the dataset page's order, each
 *   `{ id, name, type }`; `visibleTo` — the scope tokens it is shared
 *   with, so a reader acting for a member can apply the platform's own
 *   visibility rule to them; and `installedFrom` — `{ listingId, version }`
 *   for a dataset installed from a listing (`version` as the install
 *   stamped it), `null` for one the workspace made. Never a record of it.
 */
export function datasetIndexedRecord(
  id: string,
  data: Readonly<Record<string, unknown>> | undefined,
): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const model = effectiveDatasetModel(data as { model?: DatasetModel; fields?: string[] })
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
  return {
    id,
    name: datasetDisplayName(data) || id,
    facts: {
      fields: model.order.map((fieldId) => ({
        id: fieldId,
        name: text(model.fields[fieldId]?.name) || fieldId,
        type: String(model.fields[fieldId]?.type ?? 'text'),
        // A named type riding the storage one: a record's photo is `image` (AGL-3616).
        ...(model.fields[fieldId]?.customType ? { customType: String(model.fields[fieldId]?.customType) } : {}),
      })),
      visibleTo: Array.isArray(data['visibleTo']) ? (data['visibleTo'] as string[]) : [],
      installedFrom: installedFrom(data['source']),
    },
  }
}

/**
 * Where an installed dataset came from. Read from its `source` stamp, which
 * every dataset install has written — the ones from before install
 * provenance (AGL-1015) included, which carry no `installedFrom`.
 */
function installedFrom(source: unknown): { listingId: string; version: unknown } | null {
  const stamp = (source ?? {}) as Record<string, unknown>
  const listingId = typeof stamp['listingId'] === 'string' ? stamp['listingId'] : ''
  return listingId ? { listingId, version: stamp['version'] ?? null } : null
}
