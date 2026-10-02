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

import type { PluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { formSubmissionIndexedRecord } from '../model/form-submission-record'

/** The collection this plugin keeps submissions in, under a site. */
const SUBMISSIONS = 'formSubmissions'

const submissions = (hostId: string) =>
  firebaseAdmin.app().firestore().collection('hosts').doc(hostId).collection(SUBMISSIONS)

/**
 * A site's form submissions on the server, for the plugin that reads them
 * (AGL-3080) — the Inbox's reply and its list assignment. Site-scoped: a
 * request that names no site answers none. Each record is
 * `formSubmissionIndexedRecord`'s; `ref` hands the reader the one document it
 * marks answered and threads its own records under, as that module documents.
 * The reader proves who is asking first — the index authenticates nobody.
 */
export const formSubmissionRecordIndex: PluginRecordIndex = {
  async list({ hostId, limit }) {
    if (!hostId || limit < 1) return { records: [], truncated: false }
    const snapshot = await submissions(hostId).orderBy('createdAt', 'desc').limit(limit + 1).get()
    const records = snapshot.docs
      .slice(0, limit)
      .map((document) => formSubmissionIndexedRecord(document.id, document.data()))
      .filter((record): record is NonNullable<typeof record> => record !== null)
    return { records, truncated: snapshot.size > limit }
  },
  async get({ hostId, id }) {
    if (!hostId || !id) return null
    const snapshot = await submissions(hostId).doc(id).get()
    return snapshot.exists ? formSubmissionIndexedRecord(snapshot.id, snapshot.data()) : null
  },
  async ref({ hostId, id }) {
    if (!hostId || !id) return null
    return submissions(hostId).doc(id)
  },
}
