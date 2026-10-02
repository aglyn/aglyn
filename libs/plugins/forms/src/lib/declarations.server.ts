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

// The seam from its own module, not the plugin-manager barrel: boot needs the
// registry and nothing else, and the barrel reaches the client contexts.
import { formIdsOfLeadSources } from '@aglyn/aglyn/app-utils/forms'
import {
  registerPluginEventHandler,
  type PluginEventPayloads,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import {
  registerPluginRecordIndex,
  type PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The forms each removed record was counted by, per site (AGL-3330): a
 * submission names its form by `formId` on its own site, and a lead names
 * the forms that filed it by `form:{formId}` in `sources`, on any of the
 * organization's sites.
 */
export function formsCountingRemovedRecords(
  payload: PluginEventPayloads['host.records.removed'],
): Array<{ hostId: string; formIds: string[] }> {
  const byHost = new Map<string, Set<string>>()
  const add = (hostId: string, formId: string) => {
    if (!hostId || !formId) return
    const ids = byHost.get(hostId) ?? new Set<string>()
    ids.add(formId)
    byHost.set(hostId, ids)
  }
  for (const { data } of payload.records) {
    if (payload.collection === 'formSubmissions') {
      const formId = typeof data['formId'] === 'string' ? data['formId'] : ''
      const hostId = typeof data['hostId'] === 'string' ? data['hostId'] : payload.hostIds[0]
      add(hostId ?? '', formId)
    } else if (payload.collection === 'leads') {
      for (const formId of formIdsOfLeadSources(data['sources'])) {
        for (const hostId of payload.hostIds) add(hostId, formId)
      }
    }
  }
  return [...byHost].map(([hostId, formIds]) => ({ hostId, formIds: [...formIds] }))
}

/**
 * The forms plugin's server declarations: the light registrations core reads
 * at boot, before any surface loads.
 *
 * A form's counters are this plugin's to keep (AGL-3330), and a row they
 * counted can be removed by a path that is not the plugin's — the public
 * API's delete, a person's erasure. Core says so through
 * `host.records.removed`, and this recounts each form the removed rows fed.
 * The recount module (and the Admin SDK with it) loads on the first such
 * event, not at boot. A site that does not hold a named form answers nothing
 * for one document read, so a lead's forms are looked for on each site the
 * event names.
 */
export function registerFormsServerDeclarations(): void {
  // Submissions are this plugin's records (AGL-3080): the Inbox reads, marks
  // and threads them through this index rather than through the collection.
  registerPluginRecordIndex('formSubmission', lazyFormSubmissionIndex, { pluginId: BUNDLE_ID })
  registerPluginEventHandler(
    'host.records.removed',
    async (payload) => {
      const targets = formsCountingRemovedRecords(payload)
      if (!targets.length) return
      const { recountFormStats } = await import('./server/form-stats')
      for (const { hostId, formIds } of targets) {
        for (const formId of formIds) {
          try {
            await recountFormStats({ hostId, formId })
          } catch (error) {
            console.error(`[forms] recount after a removal failed for ${hostId}/${formId}`, error)
          }
        }
      }
    },
    { pluginId: BUNDLE_ID },
  )
}

const loadFormSubmissionIndex = async () =>
  (await import('./server/form-submission-index')).formSubmissionRecordIndex

/** The index, its module (and the Admin SDK with it) loaded on its first read. */
const lazyFormSubmissionIndex: PluginRecordIndex = {
  list: async (request) => (await loadFormSubmissionIndex()).list(request),
  get: async (request) => (await loadFormSubmissionIndex()).get(request),
  ref: async (request) => (await loadFormSubmissionIndex()).ref?.(request) ?? null,
}
