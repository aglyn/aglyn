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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { registerPluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { registerPluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  collection,
  collectionGroup,
  doc,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'

/**
 * The `formSubmission` records the forms plugin publishes (AGL-3080), stood
 * in for this plugin's specs — this plugin may not load the forms plugin. Each
 * half builds what that plugin's own builds, over whatever Firestore the spec
 * stages: the console list source of `form-submission-list.ts` (the newest of
 * a site's, the base a paged list walks, one submission's document) and the
 * server index of `server/form-submission-index.ts` (one site's submissions,
 * and the document a reply or an assignment is kept under). What the forms
 * plugin itself answers is held in its own spec.
 */

const OWNER = 'forms'
const KIND = 'formSubmission'
const SUBMISSIONS = 'formSubmissions'

function submission(id: string, data: Record<string, unknown> | undefined): PluginIndexedRecord | null {
  if (!data) return null
  const formName = typeof data['formName'] === 'string' ? data['formName'] : ''
  return {
    id,
    name: formName || 'Form',
    facts: {
      hostId: typeof data['hostId'] === 'string' ? data['hostId'] : null,
      formId: typeof data['formId'] === 'string' ? data['formId'] : null,
      formName,
      path: typeof data['path'] === 'string' ? data['path'] : '',
      fields: data['fields'] && typeof data['fields'] === 'object' ? data['fields'] : {},
      read: data['read'] === true,
      createdAtMs: null,
    },
  }
}

/** The console half: the list source the Inbox's cards walk and open through. */
export function standInFormSubmissionList(): void {
  registerPluginRecordListSource(
    KIND,
    {
      query(firestore, request) {
        if (!request.hostId || request.search || request.installedFrom) return null
        return query(
          collection(firestore, 'hosts', request.hostId, SUBMISSIONS),
          orderBy('createdAt', 'desc'),
          limit(request.limit),
        )
      },
      walk(firestore, scope) {
        if (scope.hostId) return collection(firestore, 'hosts', scope.hostId, SUBMISSIONS)
        return scope.orgId ? collectionGroup(firestore, SUBMISSIONS) : null
      },
      doc(firestore, request) {
        if (!request.hostId || !request.id) return null
        return doc(firestore, 'hosts', request.hostId, SUBMISSIONS, request.id)
      },
      record: (id, data) => submission(id, data as Record<string, unknown>),
    },
    { pluginId: OWNER },
  )
}

/**
 * The server half: the index the Inbox's reply and assignment routes find a
 * submission through, reading the Admin Firestore `firestore()` answers.
 */
export function standInFormSubmissionIndex(firestore: () => FirebaseFirestore.Firestore): void {
  const site = (hostId: string) => firestore().collection('hosts').doc(hostId).collection(SUBMISSIONS)
  registerPluginRecordIndex(
    KIND,
    {
      async list({ hostId, limit: max }) {
        if (!hostId) return { records: [], truncated: false }
        const snapshot = await site(hostId).limit(max + 1).get()
        const records = snapshot.docs
          .map((one) => submission(one.id, one.data()))
          .filter((record): record is PluginIndexedRecord => record !== null)
        return { records: records.slice(0, max), truncated: snapshot.docs.length > max }
      },
      async get({ hostId, id }) {
        if (!hostId || !id) return null
        const snapshot = await site(hostId).doc(id).get()
        return snapshot.exists ? submission(snapshot.id, snapshot.data()) : null
      },
      async ref({ hostId, id }) {
        if (!hostId || !id) return null
        return site(hostId).doc(id)
      },
    },
    { pluginId: OWNER },
  )
}

/** Forgets both, so a spec can ask what happens where no plugin keeps submissions. */
export function removeStandInFormSubmissions(): void {
  unregisterPluginServices(OWNER)
}
