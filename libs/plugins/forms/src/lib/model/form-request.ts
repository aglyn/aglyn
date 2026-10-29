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
  FORM_FIELD_DATA_SUFFIX,
  formFieldDataOwner,
  readFormRequest,
  type FormFieldDecl,
  type FormRequest,
} from '@aglyn/aglyn/app-utils/forms'
import {
  isVisitorUploadSegment,
  VISITOR_UPLOAD_MAX_FILES,
  type VisitorUploadFile,
  type VisitorUploadScope,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import { readEmailThread, type EmailThread } from '@aglyn/shared-util-email/email-thread'

/*==========================================
 * A REQUEST SENT THROUGH A FORM (AGL-4098): its files, what it asks for, and
 * the conversation its confirmation starts.
 *
 * Pure, shared by the browser and the server.
 *
 * FILES. A form with a File upload field sends its files BEFORE the form: the
 * Form mints a pending submission key when it opens ({@link mintFormUploadKey}),
 * each file goes up through the shared visitor upload under the purpose
 * `form-file` and that key (`POST /api/forms/upload`), and the form then sends
 * the kept files by id ({@link FormFileRefs}). The submit route reads each id
 * back from that scope and refuses one it cannot find, so a submission only
 * ever names files that arrived, under its own key. The key becomes the
 * submission's id, so a submission's files are always at
 * `hosts/{hostId}/private/uploads/form-file/{submissionId}/`.
 *
 * A REQUEST is what a form marked "This form asks for a quote" sends: the
 * submission carries `request: { kind: 'quote' }`, read off the verified form,
 * never the request body.
 *
 * THE CONVERSATION. A form that emails the person a confirmation starts an
 * email thread with it and keeps it on the submission (`emailThread`), so the
 * business's answer — a quote started from the request — replies into the
 * same conversation.
 *=========================================*/

/** The resource another plugin reads a submission's facts under, on the core's record-facts seam. */
export const FORM_SUBMISSION_FACTS_RESOURCE = 'forms.submission'

/** The visitor-upload purpose a form's files are kept under. */
export const FORM_FILE_PURPOSE = 'form-file'

/** A pending submission key: letters and digits, long enough that nobody guesses one. */
export const FORM_UPLOAD_KEY_PATTERN = /^[A-Za-z0-9]{24,64}$/

/**
 * The hidden input a File upload field posts each kept file under, as
 * `{fieldName}:{fileId}`. `__`-prefixed, so it is never an answer: the Form
 * lifts these into the request's `files`.
 */
export const FORM_FILE_INPUT = '__formFile'

/** The request body's key for the files a submission names. */
export const FORM_FILES_BODY_KEY = 'files'

/** The `code` a submit refusal about its files carries, so the form shows its sentence. */
export const FORM_FILES_REFUSAL_CODE = 'files'

/** How long an upload key that was never sent keeps its files: a day after its latest file. */
export const FORM_UPLOAD_KEY_TTL_MS = 24 * 60 * 60 * 1000

/** Where the upload route keeps what it knows of a pending key, under the form it is for. */
export const FORM_UPLOAD_KEYS_COLLECTION = 'formUploadKeys'

/** A fresh pending submission key, from the browser's random source. */
export function mintFormUploadKey(random: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes)): string {
  return Array.from(random(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Whether a value can be a pending submission key. */
export function isFormUploadKey(value: unknown): value is string {
  return typeof value === 'string' && FORM_UPLOAD_KEY_PATTERN.test(value)
}

/** The upload scope of one pending key, which is also the submission it becomes. */
export function formFileScope(hostId: string, key: string): VisitorUploadScope {
  return { hostId, purpose: FORM_FILE_PURPOSE, purposeId: key }
}

/** One file a submission names: which field it answers, and its id under the key. */
export interface FormFileRef {
  field: string
  id: string
}

/** The files a form sends: its key, and each file by field and id. */
export interface FormFileRefs {
  key: string
  refs: FormFileRef[]
}

/**
 * The files a request body names, checked for shape only: a key, and at most
 * {@link VISITOR_UPLOAD_MAX_FILES} distinct `{ field, id }` pairs. `null` when
 * the body names none; an `error` for anything malformed.
 */
export function parseFormFileRefs(raw: unknown): FormFileRefs | null | { error: string } {
  if (raw === undefined || raw === null) return null
  const source = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(source['refs']) ? (source['refs'] as unknown[]) : null
  if (!isFormUploadKey(source['key']) || !list) return { error: 'The files sent with this form could not be read.' }
  if (list.length === 0) return null
  if (list.length > VISITOR_UPLOAD_MAX_FILES) {
    return { error: `A form can send up to ${VISITOR_UPLOAD_MAX_FILES} files.` }
  }
  const seen = new Set<string>()
  const refs: FormFileRef[] = []
  for (const entry of list) {
    const ref = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    const field = typeof ref['field'] === 'string' ? ref['field'].trim().slice(0, 64) : ''
    const id = ref['id']
    if (!field || !isVisitorUploadSegment(id)) return { error: 'The files sent with this form could not be read.' }
    if (seen.has(id)) continue
    seen.add(id)
    refs.push({ field, id })
  }
  return { key: source['key'] as string, refs }
}

/** The `{field}:{id}` value a File upload field posts per kept file. */
export function formFileInputValue(field: string, id: string): string {
  return `${field}:${id}`
}

/** The refs a form's hidden file inputs posted, in order. */
export function formFileRefsFromInputs(values: readonly string[]): FormFileRef[] {
  const refs: FormFileRef[] = []
  for (const value of values) {
    const at = value.lastIndexOf(':')
    if (at <= 0) continue
    refs.push({ field: value.slice(0, at), id: value.slice(at + 1) })
  }
  return refs
}

/** A file on a stored submission: which field it answers, and its record without the storage path. */
export interface FormSubmissionFile {
  id: string
  field: string
  name: string
  contentType: string
  size: number
  uploadedAtMs: number
}

/** A kept upload as the submission records it. */
export function formSubmissionFileOf(field: string, file: VisitorUploadFile): FormSubmissionFile {
  return {
    id: file.id,
    field,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    uploadedAtMs: file.uploadedAtMs,
  }
}

/** The files a stored submission names, read defensively. */
export function readFormSubmissionFiles(raw: unknown): FormSubmissionFile[] {
  if (!Array.isArray(raw)) return []
  const files: FormSubmissionFile[] = []
  for (const entry of raw.slice(0, VISITOR_UPLOAD_MAX_FILES)) {
    const file = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>
    if (!isVisitorUploadSegment(file['id']) || typeof file['name'] !== 'string') continue
    files.push({
      id: file['id'] as string,
      field: typeof file['field'] === 'string' ? file['field'] : '',
      name: file['name'],
      contentType: typeof file['contentType'] === 'string' ? file['contentType'] : '',
      size: Number(file['size']) || 0,
      uploadedAtMs: Number(file['uploadedAtMs']) || 0,
    })
  }
  return files
}

/** What a file field answers with, as the Inbox and the emails read it: the names, in order. */
export function formFileFieldAnswer(files: ReadonlyArray<{ name: string }>): string {
  return files.map((file) => file.name).join(', ').slice(0, 2000)
}

/** The declared `file` fields of a form, by name. */
export function formFileFields(decls: readonly FormFieldDecl[]): Map<string, FormFieldDecl> {
  return new Map(decls.filter((decl) => decl?.fieldType === 'file').map((decl) => [decl.fieldName, decl]))
}

/**
 * Splits a form's posted fields into the answers a person reads and the
 * machine values beside them (`product__data`, see `FORM_FIELD_DATA_SUFFIX`):
 * the answers keep their order; each machine value is kept under the field it
 * belongs to, so `fieldData.product` is what `product__data` posted.
 */
export function splitFormFieldData(fields: Readonly<Record<string, string>>): {
  answers: Record<string, string>
  fieldData: Record<string, string>
} {
  const answers: Record<string, string> = {}
  const fieldData: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    const owner = formFieldDataOwner(key)
    if (owner) fieldData[owner] = value
    else answers[key] = value
  }
  return { answers, fieldData }
}

/** The key a machine value is posted under, for the field it belongs to. */
export function formFieldDataKey(field: string): string {
  return `${field}${FORM_FIELD_DATA_SUFFIX}`
}

/** What a stored submission asks for, or null for an ordinary message. */
export function readSubmissionRequest(raw: unknown): FormRequest | null {
  return readFormRequest({ request: raw })
}

/** The conversation a submission's confirmation started, or null. */
export function readSubmissionThread(raw: unknown): EmailThread | null {
  return readEmailThread(raw)
}
