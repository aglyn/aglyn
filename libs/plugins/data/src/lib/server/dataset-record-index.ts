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
import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'

/**
 * The data plugin's `dataset` index (AGL-3080): the workspace's datasets, as
 * another surface reads them — an AI job drafting an automation that names a
 * dataset, a planner listing what a site already has — without knowing where
 * they are stored or what a deleted one looks like.
 *
 * Datasets belong to the ORGANIZATION (`orgId` required; a scope with none
 * answers nothing). Narrowed to a site (`hostId`), only the datasets shared
 * with it are answered — the site Data page's rule. A deleted dataset is left
 * out of every answer.
 *
 * A `dataset`'s `facts`:
 *   `fields` — its fields in the dataset page's order, each
 *   `{ id, name, type }`; and `visibleTo` — the scope tokens it is shared
 *   with, so a reader acting for a member can apply the platform's own
 *   visibility rule to them. Never a record.
 */

type Data = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function recordOf(id: string, data: Data | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const model = effectiveDatasetModel(data as { model?: DatasetModel; fields?: string[] })
  return {
    id,
    name: datasetDisplayName(data) || id,
    facts: {
      fields: model.order.map((fieldId) => ({
        id: fieldId,
        name: text(model.fields[fieldId]?.name) || fieldId,
        type: String(model.fields[fieldId]?.type ?? 'text'),
      })),
      visibleTo: Array.isArray(data['visibleTo']) ? (data['visibleTo'] as string[]) : [],
    },
  }
}

function datasets(orgId: string) {
  return firebaseAdmin.app().firestore().collection('orgs').doc(orgId).collection('datasets')
}

export const datasetRecordIndex: PluginRecordIndex = {
  async list({ orgId, hostId, limit }) {
    if (!orgId || limit <= 0) return { records: [], truncated: false }
    const collection = datasets(orgId)
    const query = hostId ? scopedToHost(collection, hostId) : collection
    // One more than asked, so `truncated` is a fact rather than a guess;
    // deleted datasets are filtered after the read.
    const snapshot = await query.limit(limit + 1).get()
    const records = snapshot.docs
      .map((doc) => recordOf(doc.id, doc.data()))
      .filter((record): record is PluginIndexedRecord => record !== null)
    return { records: records.slice(0, limit), truncated: snapshot.size > limit }
  },
  async get({ orgId, hostId, id }) {
    if (!orgId || !id) return null
    const snapshot = await datasets(orgId).doc(id).get()
    const record = snapshot.exists ? recordOf(snapshot.id, snapshot.data()) : null
    if (!record || !hostId) return record
    return visibleToHost(record.facts['visibleTo'] as string[], hostId) ? record : null
  },
}
