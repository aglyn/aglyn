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

import type { FormFieldDecl } from '@aglyn/aglyn/app-utils/forms'
import { visitorUploadTypeInKinds, VISITOR_UPLOAD_MAX_FILES } from '@aglyn/aglyn/app-utils/visitor-upload'
import {
  formFileFieldAnswer,
  formFileFields,
  formFileScope,
  formSubmissionFileOf,
  type FormFileRefs,
  type FormSubmissionFile,
} from '../model/form-request'
import { formUploadKeyFiles, formUploadKeyRef } from './form-upload'
import type { FormUploadCalls } from './form-uploads'

/*==========================================
 * THE FILES A SUBMISSION NAMES, CHECKED BEFORE IT IS STORED (AGL-4098).
 *
 * A form sends its files by id, under the pending key the page minted. Each
 * is held to:
 *
 *  - the FORM: a bound form on this site, whose upload record for the key
 *    (`forms/{formId}/formUploadKeys/{key}`) exists — so the key was minted
 *    for this form by the upload route, and has not been swept;
 *  - the FIELD: a File upload field the form declares, which the upload
 *    record says the file was sent for, within the field's number;
 *  - the FILE: kept under the key's scope (`readVisitorUpload`), of a kind
 *    the field takes.
 *
 * Any one that fails refuses the whole submission with a sentence the page
 * shows, before anything is written or counted. What passes is recorded on
 * the submission as `files` (id, field, name, type, size), and each file
 * field's answer becomes the names of its files, read from what was kept
 * rather than from what the page said.
 *=========================================*/

export type AttachedFormFiles =
  | {
      ok: true
      /** The pending key, which the submission takes as its id. */
      key: string
      files: FormSubmissionFile[]
      /** Each file field's answer: its files' names. */
      answers: Record<string, string>
      /** Deletes the key's upload record once the submission holds the files. Never throws. */
      release(): Promise<void>
    }
  | { ok: false; status: number; error: string }

const MISSING = 'One of your files didn’t arrive. Remove it, attach it again and send the form.'
const LAPSED = 'Your files took too long to send. Attach them again and send the form.'

export async function attachFormFiles(input: {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  /** The verified form's id, or null for a form no entity binds. */
  formId: string | null
  decls: readonly FormFieldDecl[]
  refs: FormFileRefs
  uploads: Pick<FormUploadCalls, 'read'>
}): Promise<AttachedFormFiles> {
  const { firestore, hostId, formId, decls, refs, uploads } = input
  // Only a bound form takes files: the upload route refuses every other.
  if (!formId) return { ok: false, status: 400, error: 'This form doesn’t take files.' }
  const fileFields = formFileFields(decls)
  const markerRef = formUploadKeyRef(firestore, hostId, formId, refs.key)
  const marker = await markerRef.get()
  if (!marker.exists) return { ok: false, status: 409, error: LAPSED }
  const held = formUploadKeyFiles(marker.data() as Record<string, unknown> | undefined)

  const perField = new Map<string, number>()
  for (const ref of refs.refs) {
    const decl = fileFields.get(ref.field)
    if (!decl) return { ok: false, status: 400, error: 'This form doesn’t take files there.' }
    if (held[ref.id] !== ref.field) return { ok: false, status: 400, error: MISSING }
    const count = (perField.get(ref.field) ?? 0) + 1
    if (count > (decl.maxFiles ?? VISITOR_UPLOAD_MAX_FILES)) {
      return { ok: false, status: 400, error: `${decl.label || 'A file field'} takes fewer files than were sent.` }
    }
    perField.set(ref.field, count)
  }

  const scope = formFileScope(hostId, refs.key)
  const kept = await Promise.all(refs.refs.map((ref) => uploads.read(scope, ref.id)))
  const files: FormSubmissionFile[] = []
  for (const [index, ref] of refs.refs.entries()) {
    const file = kept[index]
    if (!file) return { ok: false, status: 400, error: MISSING }
    if (!visitorUploadTypeInKinds(file.contentType, fileFields.get(ref.field)?.fileKinds)) {
      return { ok: false, status: 400, error: `${file.name} isn’t a kind of file this form takes.` }
    }
    files.push(formSubmissionFileOf(ref.field, file))
  }
  const answers: Record<string, string> = {}
  for (const field of fileFields.keys()) {
    const named = files.filter((file) => file.field === field)
    if (named.length) answers[field] = formFileFieldAnswer(named)
  }
  return {
    ok: true,
    key: refs.key,
    files,
    answers,
    release: async () => {
      await markerRef.delete().catch((error: unknown) => console.error('[forms] upload record not released', error))
    },
  }
}
