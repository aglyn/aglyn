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

/**
 * A site's forms, listed in the console for another plugin's picker
 * (AGL-3080) — a recipe that keys an automation on the form a person picks.
 *
 * A form is the site's: the query lists `hosts/{hostId}/forms`, ordered by
 * document id so a reader asking one past its window learns it was cut, and
 * answers nothing at the organization, where no site is named. An archived
 * form collects nothing, so it is left out — an automation keyed on it would
 * never fire. A form with no display name reads by its id, as every form list
 * names one.
 */
export const formRecordListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.hostId) return null
    return query(
      collection(firestore, 'hosts', request.hostId, 'forms'),
      orderBy(documentId()),
      limit(request.limit),
    )
  },
  record(id, data) {
    if (data['archivedAt'] != null) return null
    return { id, name: String(data['displayName'] ?? '').trim() || id, facts: {} }
  },
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerFormRecordList(): void {
  registerPluginRecordListSource('form', formRecordListSource, { pluginId: BUNDLE_ID })
}
