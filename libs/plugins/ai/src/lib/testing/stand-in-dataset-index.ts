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

import { effectiveDatasetModel, type DatasetModel } from '@aglyn/aglyn/app-utils/dataset-models'
import { datasetDisplayName } from '@aglyn/aglyn/app-utils/datasets'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginRecordIndex,
  type PluginIndexedRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * The `dataset` index the plugin that keeps the workspace's datasets
 * publishes (AGL-3080), stood in over a spec's own Firestore double — this
 * plugin may not load the data plugin that registers the real one. It answers
 * in the shape the data plugin's `dataset-record-index.ts` documents: live
 * datasets only, narrowed to a site to those shared with it, each with its
 * fields (`{ id, name, type }`, in the dataset page's order) and its
 * `visibleTo`. What the data plugin itself answers is held in its own spec.
 */

const OWNER = 'data'

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function record(id: string, data: Record<string, unknown> | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const model = effectiveDatasetModel(data as { model?: DatasetModel; fields?: string[] })
  return {
    id,
    name: datasetDisplayName(data) || id,
    facts: {
      fields: model.order.map((fieldId) => ({
        id: fieldId,
        name: str(model.fields[fieldId]?.name) || fieldId,
        type: String(model.fields[fieldId]?.type ?? 'text'),
      })),
      visibleTo: Array.isArray(data['visibleTo']) ? data['visibleTo'] : [],
    },
  }
}

/** Registers it, reading through `firestore`. */
export function standInDatasetIndex(firestore: FirebaseFirestore.Firestore): void {
  const datasets = (orgId: string) => firestore.collection('orgs').doc(orgId).collection('datasets')
  const shared = (one: PluginIndexedRecord | null, hostId: string | null | undefined) =>
    one && (!hostId || visibleToHost(one.facts['visibleTo'] as string[], hostId)) ? one : null
  registerPluginRecordIndex(
    'dataset',
    {
      async list({ orgId, hostId, limit }) {
        if (!orgId) return { records: [], truncated: false }
        const snapshot = await datasets(orgId).get()
        const records = snapshot.docs
          .map((doc) => shared(record(doc.id, doc.data()), hostId))
          .filter((one): one is PluginIndexedRecord => one !== null)
        return { records: records.slice(0, limit), truncated: records.length > limit }
      },
      async get({ orgId, hostId, id }) {
        if (!orgId) return null
        const snapshot = await datasets(orgId).doc(id).get()
        return snapshot.exists ? shared(record(snapshot.id, snapshot.data()), hostId) : null
      },
    },
    { pluginId: OWNER },
  )
}

/** Forgets it, so the next spec starts with nothing keeping datasets. */
export function removeStandInDatasetIndex(): void {
  unregisterPluginServices(OWNER)
}
