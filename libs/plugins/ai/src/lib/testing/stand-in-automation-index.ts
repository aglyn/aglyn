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

import {
  registerPluginRecordIndex,
  type PluginIndexedRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * The workflow, webhook and action indexes the plugin that keeps a site's
 * automations publishes (AGL-3080), stood in over a spec's own Firestore
 * double — this plugin may not load the workflows plugin that registers the
 * real ones. It answers in the shape the workflows plugin's
 * `automation-record-index.ts` documents: live records only, an unnamed
 * workflow or webhook left out, an unnamed action named by its id, and a
 * webhook's direction and switch but never its URL or secret. What the
 * workflows plugin itself answers is held in its own spec.
 */

const OWNER = 'workflows'

type Kind = 'workflow' | 'webhook' | 'action'

const COLLECTION: Record<Kind, string> = { workflow: 'workflows', webhook: 'webhooks', action: 'actions' }

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function record(kind: Kind, id: string, data: Record<string, unknown> | undefined): PluginIndexedRecord | null {
  if (!data || data['deletedAt'] != null) return null
  const name = str(data['name'])
  const steps = Array.isArray(data['steps']) ? data['steps'] : []
  if (kind === 'action') {
    return { id, name: name || id, facts: { trigger: data['trigger'] ?? null, steps, enabled: data['enabled'] !== false } }
  }
  if (!name) return null
  if (kind === 'webhook') {
    return { id, name, facts: { direction: data['direction'], enabled: data['enabled'] !== false } }
  }
  return { id, name, facts: { steps, returnValue: str(data['returnValue']) || null, trigger: data['trigger'] ?? null } }
}

/** Registers all three, reading through `firestore`. */
export function standInAutomationIndexes(firestore: FirebaseFirestore.Firestore): void {
  for (const kind of Object.keys(COLLECTION) as Kind[]) {
    const site = (hostId: string) => firestore.collection('hosts').doc(hostId).collection(COLLECTION[kind])
    registerPluginRecordIndex(
      kind,
      {
        async list({ hostId, limit }) {
          if (!hostId) return { records: [], truncated: false }
          const snapshot = await site(hostId).limit(limit + 1).get()
          const records = snapshot.docs
            .map((doc) => record(kind, doc.id, doc.data()))
            .filter((one): one is PluginIndexedRecord => one !== null)
          return { records: records.slice(0, limit), truncated: snapshot.docs.length > limit }
        },
        async get({ hostId, id }) {
          if (!hostId) return null
          const snapshot = await site(hostId).doc(id).get()
          return snapshot.exists ? record(kind, snapshot.id, snapshot.data()) : null
        },
      },
      { pluginId: OWNER },
    )
  }
}

/** Forgets all three, so the next spec starts with no plugin keeping automations. */
export function removeStandInAutomationIndexes(): void {
  unregisterPluginServices(OWNER)
}
