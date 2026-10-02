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

import { registerPluginRecordCountSource } from '@aglyn/aglyn/plugin-manager/plugin-record-counts'
import { registerPluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, documentId, limit, orderBy, query, where } from 'firebase/firestore'

/**
 * The count and list sources the plugins that keep a campaign's converted
 * records publish (AGL-3080), stood in for this plugin's specs — this plugin
 * may not load the forms, bookings or record-system plugins. Each builds the
 * query its owner's module builds (`form-submission-list.ts`, `form-submission-counts.ts`,
 * `bookings-record-counts.ts`, `crm-record-counts.ts`) from whatever
 * `firebase/firestore` the spec stages; what the owners themselves answer is
 * held in their own specs.
 */
export function standInConvertedRecordSources(): void {
  const submissions = (firestore: any, hostId: string) =>
    collection(firestore, 'hosts', hostId, 'formSubmissions')
  registerPluginRecordCountSource(
    'formSubmission',
    { query: (firestore, { hostId }) => (hostId ? submissions(firestore, hostId) : null) },
    { pluginId: 'forms' },
  )
  registerPluginRecordListSource(
    'formSubmission',
    {
      query: (firestore, request) =>
        request.hostId
          ? query(submissions(firestore, request.hostId), orderBy(documentId()), limit(request.limit))
          : null,
      byIds: (firestore, request) =>
        request.hostId && request.ids.length
          ? query(submissions(firestore, request.hostId), where(documentId(), 'in', [...request.ids]))
          : null,
      record: (id, data) => {
        const path = typeof data['path'] === 'string' ? data['path'].trim() : ''
        return { id, name: 'Form submission', facts: path ? { path } : {} }
      },
    },
    { pluginId: 'forms' },
  )
  registerPluginRecordCountSource(
    'booking',
    { query: (firestore, { hostId }) => (hostId ? collection(firestore, 'hosts', hostId, 'bookings') : null) },
    { pluginId: 'bookings' },
  )
  registerPluginRecordCountSource(
    'lead',
    {
      query: (firestore, { hostId, orgId }) =>
        orgId && hostId
          ? query(
              collection(firestore, 'orgs', orgId, 'leads'),
              where('capturedByHostIds', 'array-contains', hostId),
            )
          : null,
    },
    { pluginId: 'crm' },
  )
  registerPluginRecordCountSource(
    'contact',
    {
      query: (firestore, { orgId }) => (orgId ? collection(firestore, 'orgs', orgId, 'contacts') : null),
      crossesSites: true,
    },
    { pluginId: 'crm' },
  )
}
