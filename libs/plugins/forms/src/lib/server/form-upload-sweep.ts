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

import type { PluginConsoleCronReport } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { formFileScope, FORM_UPLOAD_KEYS_COLLECTION, isFormUploadKey } from '../model/form-request'
import type { FormUploadCalls } from './form-uploads'

/*==========================================
 * FILES ATTACHED TO A FORM THAT WAS NEVER SENT (AGL-4098).
 *
 * A form's files go up before the form does, so a visitor who attaches a file
 * and closes the tab leaves a kept file behind under a pending key. The upload
 * route records each key under its form
 * (`forms/{formId}/formUploadKeys/{key}`, with `sweepAtMs` a day after its
 * latest file), the submit route deletes that record once a submission holds
 * the files, and this sweep deletes the files of every record whose time has
 * come — and the record with them.
 *
 * A key a submission already took (its record outlived a failed delete) keeps
 * its files: the submission named them, and only it releases them.
 *
 * Run every fifteen minutes by the console's plugin job runner; each tick
 * takes at most {@link FORM_UPLOAD_SWEEP_BATCH} keys and starts none after
 * its deadline. The query is a collection-group read on `sweepAtMs`, whose
 * index is declared in `cloud/firebase-firestore.indexes.json`.
 *=========================================*/

export const FORM_UPLOAD_SWEEP_JOB_ID = 'forms-upload-sweep'

/** Keys one tick sweeps. */
export const FORM_UPLOAD_SWEEP_BATCH = 100

export interface FormUploadSweepDeps {
  firestore(): FirebaseFirestore.Firestore
  uploads(): Promise<Pick<FormUploadCalls, 'removeAll'>>
}

export function defaultFormUploadSweepDeps(): FormUploadSweepDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    uploads: async () => (await import('./form-uploads')).formUploadCalls(),
  }
}

export async function sweepFormUploads(
  deps: FormUploadSweepDeps,
  context: { nowMs: number; deadlineMs: number },
): Promise<PluginConsoleCronReport> {
  const firestore = deps.firestore()
  const due = await firestore
    .collectionGroup(FORM_UPLOAD_KEYS_COLLECTION)
    .where('sweepAtMs', '<=', context.nowMs)
    .orderBy('sweepAtMs')
    .limit(FORM_UPLOAD_SWEEP_BATCH)
    .get()
  let swept = 0
  let kept = 0
  let failed = 0
  const uploads = due.empty ? null : await deps.uploads()
  for (const record of due.docs) {
    if (Date.now() > context.deadlineMs) break
    const hostId = String(record.get('hostId') ?? '')
    const key = record.id
    try {
      if (hostId && isFormUploadKey(key) && uploads) {
        const submitted = await firestore.collection('hosts').doc(hostId).collection('formSubmissions').doc(key).get()
        if (submitted.exists) kept += 1
        else {
          await uploads.removeAll(formFileScope(hostId, key))
          swept += 1
        }
      }
      await record.ref.delete()
    } catch (error) {
      failed += 1
      console.error('[forms] an unsent upload was not swept', { hostId, key, error })
    }
  }
  return { due: due.size, swept, kept, failed }
}
