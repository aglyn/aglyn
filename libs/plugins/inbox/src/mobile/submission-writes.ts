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

/**
 * What the Inbox does to a submission (AGL-3622), the way the console's
 * Submissions card and reply composer do it:
 *
 *  - read / unread: a client write of `read` and nothing else, the one field
 *    the rules let a site's writer change on the row;
 *  - delete: a client delete after the console's confirm, then the forms
 *    plugin's recount (`POST /api/forms/stats`), best effort, because the
 *    form counted the submission when it arrived and an increment cannot see
 *    a delete;
 *  - reply: `POST /api/inbox/reply` with the site, the submission, a subject
 *    and a message. The route reads the recipient off the stored row, checks the
 *    caller's host role, refuses a suppressed address and records the reply.
 */

import type { MobileApiClient } from '@aglyn/mobile-plugin-host'
import { deleteDoc, doc, type Firestore, updateDoc } from 'firebase/firestore'
import { Alert } from 'react-native'
import { FORM_SUBMISSIONS_COLLECTION } from './submission-query'

/** The forms plugin's recount route, by address: this plugin may not import that one. */
export const FORM_STATS_API_PATH = '/api/forms/stats'

/** The Inbox's reply route. */
export const INBOX_REPLY_API_PATH = '/api/inbox/reply'

const submissionDoc = (firestore: unknown, hostId: string, id: string) =>
  doc(firestore as Firestore, 'hosts', hostId, FORM_SUBMISSIONS_COLLECTION, id)

export async function setSubmissionRead(
  firestore: unknown,
  hostId: string,
  id: string,
  read: boolean,
): Promise<void> {
  await updateDoc(submissionDoc(firestore, hostId, id), { read })
}

/** The console's delete confirmation, as a native alert. */
export function confirmDeleteSubmission(): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(
      'Delete this submission?',
      'The submission is removed permanently.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  )
}

/**
 * Deletes after the confirm; false when the person cancelled. The recount
 * never throws: the delete has happened either way, and the recount script
 * catches a follow-up that did not land.
 */
export async function deleteSubmission(
  firestore: unknown,
  api: MobileApiClient,
  hostId: string,
  row: { $id: string; formId?: unknown },
): Promise<boolean> {
  if (!(await confirmDeleteSubmission())) return false
  await deleteDoc(submissionDoc(firestore, hostId, row.$id))
  if (typeof row.formId === 'string' && row.formId) {
    await api
      .request(FORM_STATS_API_PATH, { method: 'POST', body: { hostId, formIds: [row.formId] } })
      .catch(() => undefined)
  }
  return true
}

export interface ReplySent {
  sent: boolean
  replyId?: string
  to?: string
  replyTo?: string
  sentAtMs?: number
}

export function sendSubmissionReply(
  api: MobileApiClient,
  body: { hostId: string; submissionId: string; subject: string; message: string },
): Promise<ReplySent> {
  return api.request<ReplySent>(INBOX_REPLY_API_PATH, {
    method: 'POST',
    body: {
      hostId: body.hostId,
      submissionId: body.submissionId,
      subject: body.subject.trim(),
      message: body.message.trim(),
    },
  })
}
