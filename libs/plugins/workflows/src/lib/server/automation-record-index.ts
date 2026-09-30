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
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'

/**
 * The workflows plugin's record indexes (AGL-3080): a site's workflows,
 * webhooks and actions, as another surface reads them — an AI job drafting an
 * automation that names a workflow, the "Used by" scan asking which workflows
 * call a function — without knowing where they are stored or what a deleted
 * one looks like.
 *
 * All three are a SITE's (`hostId` required; an org-only scope answers
 * nothing), and a deleted record is left out of every answer.
 *
 * A `workflow`'s `facts`:
 *   `steps` (the stored step list: `functionId`, `functionName`, `args`,
 *   `resultName` each), `returnValue` (a scope name, or `null`) and `trigger`
 *   (`{ event, filter? }`, or `null` for a workflow run only by hand).
 *   An unnamed workflow is left out.
 * A `webhook`'s `facts`:
 *   `direction` (`outbound` | `inbound`) and `enabled` (a boolean). Never its
 *   URL and never its secret. An unnamed webhook is left out.
 * An `action`'s `facts`:
 *   `trigger`, `steps` and `enabled`, as stored. An action with no stored
 *   name is named by its id — the name its run history already gives it.
 */

type Data = Record<string, unknown>

/** The stored kinds this module indexes, by their Firestore collection. */
const COLLECTION = {
  workflow: 'workflows',
  webhook: 'webhooks',
  action: 'actions',
} as const

type IndexedKind = keyof typeof COLLECTION

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function recordOf(kind: IndexedKind, id: string, data: Data | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const stored = str(data['name'])
  if (kind === 'action') {
    return {
      id,
      name: stored || id,
      facts: {
        trigger: data['trigger'] ?? null,
        steps: Array.isArray(data['steps']) ? data['steps'] : [],
        enabled: data['enabled'] !== false,
      },
    }
  }
  if (!stored) return null
  if (kind === 'webhook') {
    return {
      id,
      name: stored,
      facts: { direction: data['direction'], enabled: data['enabled'] !== false },
    }
  }
  return {
    id,
    name: stored,
    facts: {
      steps: Array.isArray(data['steps']) ? data['steps'] : [],
      returnValue: str(data['returnValue']) || null,
      trigger: data['trigger'] ?? null,
    },
  }
}

function hostCollection(hostId: string, kind: IndexedKind) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(COLLECTION[kind])
}

function indexOf(kind: IndexedKind): PluginRecordIndex {
  return {
    async list({ hostId, limit }) {
      if (!hostId || limit <= 0) return { records: [], truncated: false }
      // One more than asked, so `truncated` is a fact rather than a guess;
      // deleted and unnamed records are filtered after the read.
      const snapshot = await hostCollection(hostId, kind).limit(limit + 1).get()
      const records = snapshot.docs
        .map((doc) => recordOf(kind, doc.id, doc.data()))
        .filter((record): record is PluginIndexedRecord => record !== null)
      return { records: records.slice(0, limit), truncated: snapshot.size > limit }
    },
    async get({ hostId, id }) {
      if (!hostId || !id) return null
      const snapshot = await hostCollection(hostId, kind).doc(id).get()
      return snapshot.exists ? recordOf(kind, snapshot.id, snapshot.data()) : null
    },
  }
}

export const workflowRecordIndex = indexOf('workflow')
export const webhookRecordIndex = indexOf('webhook')
export const actionRecordIndex = indexOf('action')
