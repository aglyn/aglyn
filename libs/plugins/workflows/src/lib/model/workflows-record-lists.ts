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
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  AUTOMATION_COLLECTIONS,
  automationIndexedRecord,
  type AutomationRecordKind,
} from './automation-record'

/**
 * A site's workflows, webhooks and actions, listed in the console for another
 * plugin's picker or check (AGL-3080) — a computed variable choosing the
 * workflow that fills it, a reference check confirming one still exists.
 *
 * All three are a site's: asked at the organization, a source answers none.
 * Ordered by document id, so the window is the same one every bounded list
 * reads. Each record is `automationIndexedRecord`'s, the server indexes'
 * shape.
 */
function automationListSource(kind: AutomationRecordKind): PluginRecordListSource {
  return {
    query(firestore, request) {
      return request.hostId
        ? query(
            collection(firestore, 'hosts', request.hostId, AUTOMATION_COLLECTIONS[kind]),
            orderBy(documentId()),
            limit(request.limit),
          )
        : null
    },
    record: (id, data) => automationIndexedRecord(kind, id, data),
  }
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerWorkflowsRecordLists(): void {
  for (const kind of Object.keys(AUTOMATION_COLLECTIONS) as AutomationRecordKind[]) {
    registerPluginRecordListSource(kind, automationListSource(kind), { pluginId: BUNDLE_ID })
  }
}
