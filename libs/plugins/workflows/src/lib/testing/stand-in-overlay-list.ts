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
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'

/**
 * The `overlay` list source the plugin that keeps a site's announcement bars
 * and popups publishes (AGL-3080), stood in for this plugin's specs — this
 * plugin may not load the marketing plugin. It builds the query that plugin's
 * `overlay-record-list.ts` builds (the site's overlays, ordered by document
 * id) from whatever `firebase/firestore` the spec stages, and reads a row as
 * a live overlay named by its name, its bar's text or its popup's headline.
 * What the marketing plugin itself answers is held in its own spec.
 */
export function standInOverlayList(): void {
  registerPluginRecordListSource(
    'overlay',
    {
      query(firestore, request) {
        if (!request.hostId) return null
        return query(
          collection(firestore, 'hosts', request.hostId, 'overlays'),
          orderBy(documentId()),
          limit(request.limit),
        )
      },
      record(id, data) {
        if (!data || data['deletedAt'] != null) return null
        const bar = (data['bar'] ?? {}) as Record<string, unknown>
        const popup = (data['popup'] ?? {}) as Record<string, unknown>
        const name = [data['name'], bar['text'], popup['headline']].find(
          (value) => typeof value === 'string' && value.trim(),
        )
        return { id, name: typeof name === 'string' ? name.trim() : id, facts: {} }
      },
    },
    { pluginId: 'marketing' },
  )
}
