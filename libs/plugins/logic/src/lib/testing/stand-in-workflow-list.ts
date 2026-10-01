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

import { registerPluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'

/**
 * The `workflow` list source the plugin that keeps a site's automations
 * publishes (AGL-3080), stood in for this plugin's specs — this plugin may
 * not load the workflows plugin. It builds the query that plugin's
 * `workflows-record-lists.ts` builds (the site's workflows, ordered by
 * document id) from whatever `firebase/firestore` the spec stages, and reads
 * a row as a live, named workflow. What the workflows plugin itself answers
 * is held in its own spec.
 */
export function standInWorkflowList(): void {
  registerPluginRecordListSource(
    'workflow',
    {
      query(firestore, request) {
        return request.hostId
          ? query(
              collection(firestore, 'hosts', request.hostId, 'workflows'),
              orderBy(documentId()),
              limit(request.limit),
            )
          : null
      },
      record(id, data) {
        const name = typeof data?.['name'] === 'string' ? data['name'].trim() : ''
        return data && data['deletedAt'] == null && name ? { id, name, facts: {} } : null
      },
    },
    { pluginId: 'workflows' },
  )
}

/** Forgets it, so a spec can ask what happens where no plugin keeps workflows. */
export function removeStandInWorkflowList(): void {
  unregisterPluginServices('workflows')
}
