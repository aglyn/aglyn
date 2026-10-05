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

import { CAPTURED_BY_HOST_FIELD } from '@aglyn/aglyn/app-utils/marketing-consent'
import {
  registerPluginRecordCountSource,
  type PluginRecordCountSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-counts'
import { collection, query, where } from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * The leads a site CAPTURED (AGL-3275), counted for another plugin's figure
 * (AGL-3080). A lead is one document per person under the organization,
 * stamped in `capturedByHostIds` with every site that met them — so this is
 * exactly the population a site's own lead outcomes are drawn from.
 *
 * Not `visibleTo`: that also names the sites a consent group shares a person
 * with. The price is that a collaborator scoped to one site cannot run the
 * count — the rules prove a lead read by `visibleTo` — and the reader
 * withholds the figure for them.
 */
export const leadRecordCountSource: PluginRecordCountSource = {
  query(firestore, request) {
    if (!request.orgId || !request.hostId) return null
    return query(
      collection(firestore, 'orgs', request.orgId, 'leads'),
      where(CAPTURED_BY_HOST_FIELD, 'array-contains', request.hostId),
    )
  },
}

/**
 * The organization's contacts — ONE row per person for every site in it, so
 * the count crosses sites, which the reader is told.
 */
export const contactRecordCountSource: PluginRecordCountSource = {
  query(firestore, request) {
    return request.orgId ? collection(firestore, 'orgs', request.orgId, 'contacts') : null
  },
  crossesSites: true,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerCrmRecordCounts(): void {
  registerPluginRecordCountSource('lead', leadRecordCountSource, { pluginId: BUNDLE_ID })
  registerPluginRecordCountSource('contact', contactRecordCountSource, { pluginId: BUNDLE_ID })
}
