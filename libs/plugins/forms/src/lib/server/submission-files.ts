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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import { visitorUploadFinalPath } from '@aglyn/aglyn/app-utils/visitor-upload'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { formFileScope, readFormSubmissionFiles } from '../model/form-request'
import type { FormUploadCalls } from './form-uploads'
import { memberMayReadSubmissions } from './submission-access'

/*==========================================
 * A SUBMISSION'S FILES IN THE CONSOLE (AGL-4098): `POST /api/forms/submission-file`.
 *
 *   { action: 'download', hostId, submissionId, fileId } → the file, streamed
 *   { action: 'release', hostId, submissionId }          → { released: true }
 *
 * DOWNLOAD serves one of the files a submission names to a member who may
 * read the site's submissions (`memberMayReadSubmissions`, the Inbox's own
 * read): never a file the submission does not name, and through the shared
 * upload's serving headers (`nosniff`, a sandboxing CSP, a download for
 * anything but the pictures a browser draws safely).
 *
 * RELEASE deletes the files of a submission that is gone. The Inbox deletes a
 * submission from the browser, which cannot reach private storage, so it asks
 * here after the delete; the files go only once the document no longer
 * exists, so nothing a submission still names can be released. A submission
 * removed by the API or a person's erasure releases its files through
 * `host.records.removed` (`declarations.server.ts`) instead.
 *=========================================*/

export interface SubmissionFilesDeps {
  verifyIdToken(token: string): Promise<{ uid: string; staff?: unknown }>
  firestore(): FirebaseFirestore.Firestore
  uploads(): Promise<FormUploadCalls>
  orgMember(orgId: string, uid: string): Promise<Record<string, unknown> | null>
}

export function defaultSubmissionFilesDeps(): SubmissionFilesDeps {
  const firestore = () => firebaseAdmin.app().firestore()
  return {
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    firestore,
    uploads: async () => (await import('./form-uploads')).formUploadCalls(),
    orgMember: async (orgId, uid) => {
      const snapshot = await firestore().collection('orgs').doc(orgId).collection('members').doc(uid).get()
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
    },
  }
}

type Outcome = { status: number; body: Record<string, unknown>; file?: { path: string; name: string; contentType: string } }

const refuse = (status: number, error: string): Outcome => ({ status, body: { error } })
const DOC_ID = /^(?!__.*__$)[^/]{1,128}$/

function bodyOf(req: PluginApiRequest): Record<string, unknown> {
  const raw = req.body
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

export async function handleSubmissionFiles(deps: SubmissionFilesDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return refuse(405, 'Method not allowed')
  const headers = (req.headers ?? {}) as Record<string, unknown>
  const authorization = String(headers['authorization'] ?? headers['Authorization'] ?? '')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return refuse(401, 'Unauthenticated')
  const body = bodyOf(req)
  const action = String(body['action'] ?? '')
  const hostId = String(body['hostId'] ?? '')
  const submissionId = String(body['submissionId'] ?? '')
  if (!DOC_ID.test(hostId) || !DOC_ID.test(submissionId)) return refuse(400, 'Missing hostId or submissionId')

  let decoded: { uid: string; staff?: unknown }
  try {
    decoded = await deps.verifyIdToken(idToken)
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return refuse(401, 'Unauthenticated')
  }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [host, submission] = await Promise.all([
    hostRef.get(),
    hostRef.collection('formSubmissions').doc(submissionId).get(),
  ])
  if (!host.exists) return refuse(404, 'Unknown site')
  const allowed = await memberMayReadSubmissions({
    uid: decoded.uid,
    staff: decoded.staff === true,
    host,
    orgId: submission.exists ? String(submission.get('orgId') ?? '') || null : String(host.get('orgId') ?? '') || null,
    orgMember: deps.orgMember,
  })
  if (!allowed) return refuse(403, 'You can’t read this site’s submissions.')

  if (action === 'download') {
    if (!submission.exists) return refuse(404, 'That submission is no longer in the Inbox.')
    const fileId = String(body['fileId'] ?? '')
    const file = readFormSubmissionFiles(submission.get('files')).find((entry) => entry.id === fileId)
    if (!file) return refuse(404, 'That file is no longer on this submission.')
    return {
      status: 200,
      body: {},
      file: {
        path: visitorUploadFinalPath(formFileScope(hostId, submissionId), file.id),
        name: file.name,
        contentType: file.contentType,
      },
    }
  }

  if (action === 'release') {
    // Only the files of a submission that is gone.
    if (submission.exists) return refuse(409, 'This submission is still in the Inbox.')
    const uploads = await deps.uploads()
    await uploads.removeAll(formFileScope(hostId, submissionId))
    return { status: 200, body: { released: true } }
  }

  return refuse(400, 'Unknown action')
}

/** `POST /api/forms/submission-file`. */
export const submissionFilesHandler: PluginApiHandler = async (req, res) => {
  const deps = defaultSubmissionFilesDeps()
  const outcome = await handleSubmissionFiles(deps, req)
  if (outcome.file) {
    const uploads = await deps.uploads()
    return uploads.send(res as never, outcome.file)
  }
  return res.status(outcome.status).json(outcome.body)
}
