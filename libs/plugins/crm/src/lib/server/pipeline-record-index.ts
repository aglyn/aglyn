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

import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'

/**
 * The CRM's `pipeline` index (AGL-3080): the organization's deal pipelines
 * and their stages, as another plugin reads them — an automation drafted by
 * the AI names a stage a deal moves to — without knowing where pipelines are
 * stored or what an archived one looks like.
 *
 * Org-scoped (`orgId` required; a site-only scope answers nothing). With a
 * `hostId`, only the pipelines that site can see — the ones shared with it
 * or with every site — which is the set that site's CRM offers. An archived
 * pipeline is left out of every answer.
 *
 * `name` is the pipeline's, or `Untitled pipeline` for one saved without,
 * which is what the CRM itself calls it. A pipeline's `facts`:
 *   `stages: Array<{ id: string, name: string }>`, in the pipeline's order,
 *   each stage that has an id (a stage saved without a name has `name: ''`).
 */

/** What the CRM calls a pipeline saved without a name. */
export const UNTITLED_PIPELINE = 'Untitled pipeline'

const PIPELINE_FIELDS = ['name', 'stages', 'archivedAt'] as const

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function pipelineRecord(
  id: string,
  data: Record<string, unknown> | undefined,
): PluginIndexedRecord | null {
  if (!data || Number(data['archivedAt']) > 0) return null
  const stages = (Array.isArray(data['stages']) ? data['stages'] : [])
    .map((stage) => {
      const entry = (stage ?? {}) as Record<string, unknown>
      return { id: str(entry['id']), name: str(entry['name']) }
    })
    .filter((stage) => stage.id)
  return { id, name: str(data['name']) || UNTITLED_PIPELINE, facts: { stages } }
}

function pipelineCollection(orgId: string): FirebaseFirestore.CollectionReference {
  return firebaseAdmin.app().firestore().collection('orgs').doc(orgId).collection('pipelines')
}

export const pipelineRecordIndex: PluginRecordIndex = {
  async list({ orgId, hostId, limit }) {
    if (!orgId || limit <= 0) return { records: [], truncated: false }
    const collection = pipelineCollection(orgId)
    // One more than asked, so `truncated` is a fact rather than a guess; the
    // archived rows are filtered after the read.
    const snapshot = await (hostId ? scopedToHost(collection, hostId) : collection)
      .select(...PIPELINE_FIELDS)
      .limit(limit + 1)
      .get()
    const records = snapshot.docs
      .slice(0, limit)
      .map((doc) => pipelineRecord(doc.id, doc.data()))
      .filter((record): record is PluginIndexedRecord => record !== null)
    return { records, truncated: snapshot.docs.length > limit }
  },
  async get({ orgId, hostId, id }) {
    if (!orgId || !id) return null
    const snapshot = await pipelineCollection(orgId).doc(id).get()
    const data = snapshot.exists ? snapshot.data() : undefined
    // A site asks about the pipelines it can see, and no other.
    if (hostId && !visibleToHost(data?.['visibleTo'] as string[] | undefined, hostId)) return null
    return pipelineRecord(snapshot.id, data)
  },
}
