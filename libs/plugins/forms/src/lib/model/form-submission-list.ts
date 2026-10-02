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
  PLUGIN_RECORD_LIST_IDS_MAX,
  registerPluginRecordListSource,
  type PluginRecordListSource,
} from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { formSubmissionIndexedRecord } from './form-submission-record'

/** The collection this plugin keeps submissions in, under a site. */
const SUBMISSIONS = 'formSubmissions'

/**
 * A site's form submissions, listed in the console for the plugin that
 * reads them (AGL-3080) — the Inbox. The record is
 * `formSubmissionIndexedRecord`'s, and the stored fields a reader may filter,
 * order and change are documented there.
 *
 * - `query` — the newest of one site's, at most `limit`, for a glance.
 * - `walk` — the base a paged list walks: a site's submissions, or on the
 *   organization's Inbox every site's, which the reader narrows to the
 *   organization by `orgId` — the only group read the rules admit. The
 *   reader's list query adds that, its filters, its `createdAt` order and
 *   its pages.
 * - `doc` — one site's submission, which the Inbox opens, marks read or
 *   unread, and deletes (a site admin's or editor's to do, by the rules), and
 *   under which it reads the replies it sent.
 * - `byIds` — a site's submissions by name, at most
 *   {@link PLUGIN_RECORD_LIST_IDS_MAX} at a time, for a reader that holds ids
 *   from elsewhere: a campaign's conversion report grouping the submissions it
 *   was credited with by the page each was sent from.
 */
export const formSubmissionListSource: PluginRecordListSource = {
  query(firestore, request) {
    if (!request.hostId || request.search || request.installedFrom) return null
    return query(
      collection(firestore, 'hosts', request.hostId, SUBMISSIONS),
      orderBy('createdAt', 'desc'),
      limit(request.limit),
    )
  },
  walk(firestore, request) {
    if (request.hostId) return collection(firestore, 'hosts', request.hostId, SUBMISSIONS)
    return request.orgId ? collectionGroup(firestore, SUBMISSIONS) : null
  },
  doc(firestore, request) {
    if (!request.hostId || !request.id) return null
    return doc(firestore, 'hosts', request.hostId, SUBMISSIONS, request.id)
  },
  byIds(firestore, request) {
    const ids = request.ids.filter(Boolean).slice(0, PLUGIN_RECORD_LIST_IDS_MAX)
    if (!request.hostId || !ids.length) return null
    return query(
      collection(firestore, 'hosts', request.hostId, SUBMISSIONS),
      where(documentId(), 'in', ids),
    )
  },
  record: formSubmissionIndexedRecord,
}

/** Called from the console registrar, owner named for a spec that calls it directly. */
export function registerFormSubmissionList(): void {
  registerPluginRecordListSource('formSubmission', formSubmissionListSource, {
    pluginId: BUNDLE_ID,
  })
}
