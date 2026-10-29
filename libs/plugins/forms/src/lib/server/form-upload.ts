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

import { isFormArchived, type FormFieldDecl } from '@aglyn/aglyn/app-utils/forms'
import { NO_CLIENT_ADDRESS_BUCKET, readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import {
  isVisitorUploadSegment,
  visitorUploadFileView,
  visitorUploadFinalPath,
  visitorUploadTypeInKinds,
  VISITOR_UPLOAD_HONEYPOT_FIELD,
  VISITOR_UPLOAD_MAX_FILES,
} from '@aglyn/aglyn/app-utils/visitor-upload'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  formFileFields,
  formFileScope,
  FORM_UPLOAD_KEYS_COLLECTION,
  FORM_UPLOAD_KEY_TTL_MS,
  isFormUploadKey,
} from '../model/form-request'
import type { FormUploadCalls } from './form-uploads'

/*==========================================
 * A FORM'S FILES, SENT BEFORE THE FORM (AGL-4098): `POST /api/forms/upload`.
 *
 *   { action: 'ticket', hostId, formId, key, field, file: { name, contentType, size } }
 *        → { ticket, upload: { url, fields }, file }
 *   { action: 'finalize', hostId, formId, key, field, ticket }
 *        → { file: { id, name, contentType, size, uploadedAtMs } }
 *   { action: 'remove', hostId, formId, key, fileId }
 *        → { removed: true }
 *
 * The shared visitor upload (`@aglyn/tenant-data-admin/server/visitor-upload`)
 * moves and checks the bytes; this route decides who may upload for what. A
 * file is taken only for a form that exists on the site, is in use, and
 * DECLARES a File upload field of that name — and only of the kinds, and up
 * to the number, the author set on that field. Everything is scoped to the
 * pending submission key the Form minted (`form-file/{key}`), which the
 * submission takes as its id when it is sent.
 *
 * What the route knows of a key is kept under the form,
 * `hosts/{hostId}/forms/{formId}/formUploadKeys/{key}`: which files it holds
 * and for which field, and when it may be swept. The submit route reads it to
 * check a submission's files and deletes it once they are the submission's;
 * the console's sweep (`form-upload-sweep.ts`) deletes the files of a key
 * that was never sent, a day after its latest file.
 *
 * A visitor door like the submit route, but one that keeps the tenant
 * dispatcher's gates: its cross-origin check, the site's Forms switch,
 * lockdown and the visitor-write limit stand in front of it, and the upload's
 * own limits (tickets per address and per site, the `uploads` pause) behind.
 * The honeypot is answered quietly, as the submit route answers it.
 *=========================================*/

export interface FormUploadDeps {
  firestore(): FirebaseFirestore.Firestore
  uploads(): Promise<FormUploadCalls>
  now(): number
}

export function defaultFormUploadDeps(): FormUploadDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    uploads: async () => (await import('./form-uploads')).formUploadCalls(),
    now: () => Date.now(),
  }
}

/** What the upload route knows of one pending key. */
export interface FormUploadKeyRecord {
  hostId: string
  formId: string
  key: string
  /** Each kept file's id, and the field it was sent for. */
  files: Record<string, string>
  createdAtMs: number
  /** When the console's sweep may delete the key's files, if it was never sent. */
  sweepAtMs: number
}

const DOC_ID = /^(?!__.*__$)[^/]{1,128}$/

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, { status, ...(headers ? { headers } : {}) })

/** The marker of a key, under the form it was minted for. */
export function formUploadKeyRef(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  formId: string,
  key: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('hosts')
    .doc(hostId)
    .collection('forms')
    .doc(formId)
    .collection(FORM_UPLOAD_KEYS_COLLECTION)
    .doc(key)
}

/** The files a key's record holds, read defensively. */
export function formUploadKeyFiles(data: Record<string, unknown> | undefined): Record<string, string> {
  const files = (data?.['files'] ?? {}) as Record<string, unknown>
  return Object.fromEntries(
    Object.entries(files).filter(
      (entry): entry is [string, string] => isVisitorUploadSegment(entry[0]) && typeof entry[1] === 'string',
    ),
  )
}

/** How many of a key's files answer one field. */
const countFor = (files: Record<string, string>, field: string) =>
  Object.values(files).filter((owner) => owner === field).length

/** The refusal when a field holds all it takes. */
function fullMessage(decl: FormFieldDecl): string {
  const max = decl.maxFiles ?? VISITOR_UPLOAD_MAX_FILES
  return max === 1 ? 'This field takes one file. Remove it to send another.' : `This field takes up to ${max} files.`
}

export async function handleFormUpload(deps: FormUploadDeps, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  // A person never fills the honeypot; a bot that did learns nothing.
  const honeypot = body[VISITOR_UPLOAD_HONEYPOT_FIELD]
  if (typeof honeypot === 'string' && honeypot.trim()) return json({ received: true })

  const action = String(body['action'] ?? '')
  const hostId = String(body['hostId'] ?? '')
  const formId = String(body['formId'] ?? '')
  const key = body['key']
  if (!DOC_ID.test(hostId) || !DOC_ID.test(formId) || !isFormUploadKey(key)) {
    return json({ error: 'This form can’t take files right now. Reload the page and try again.' }, 400)
  }

  const firestore = deps.firestore()
  const formSnapshot = await firestore.collection('hosts').doc(hostId).collection('forms').doc(formId).get()
  if (!formSnapshot.exists || isFormArchived(formSnapshot.data() as never)) {
    return json({ error: 'This form is no longer accepting submissions.' }, 404)
  }
  const decls = Array.isArray(formSnapshot.get('fields')) ? (formSnapshot.get('fields') as FormFieldDecl[]) : []
  const fileFields = formFileFields(decls)
  const scope = formFileScope(hostId, key)
  const markerRef = formUploadKeyRef(firestore, hostId, formId, key)
  const caller = { ip: readClientIp(request.headers) ?? NO_CLIENT_ADDRESS_BUCKET }

  if (action === 'remove') {
    const fileId = body['fileId']
    if (!isVisitorUploadSegment(fileId)) return json({ error: 'Unknown file' }, 400)
    const marker = await markerRef.get()
    const files = formUploadKeyFiles(marker.data())
    // Only a file this key holds; a stranger's key holds nothing of theirs.
    if (!marker.exists || !(fileId in files)) return json({ removed: true })
    const uploads = await deps.uploads()
    await uploads.remove(visitorUploadFinalPath(scope, fileId))
    const rest = { ...files }
    delete rest[fileId]
    // `update` writes the map whole, so the removed file leaves it.
    await markerRef.update({ files: rest })
    return json({ removed: true })
  }

  const field = String(body['field'] ?? '').trim()
  const decl = fileFields.get(field)
  if (!decl) return json({ error: 'This form doesn’t take files here.' }, 404)

  if (action === 'ticket') {
    const marker = await markerRef.get()
    const files = formUploadKeyFiles(marker.data())
    if (countFor(files, field) >= (decl.maxFiles ?? VISITOR_UPLOAD_MAX_FILES)) {
      return json({ error: fullMessage(decl) }, 409)
    }
    if (Object.keys(files).length >= VISITOR_UPLOAD_MAX_FILES) {
      return json({ error: `A form can send up to ${VISITOR_UPLOAD_MAX_FILES} files.` }, 409)
    }
    const uploads = await deps.uploads()
    const minted = await uploads.mint({ scope, request: body['file'], caller, kinds: decl.fileKinds })
    if ('error' in minted) {
      return json(
        { error: minted.error, code: minted.code },
        minted.status,
        minted.retryAfterSeconds ? { 'Retry-After': String(minted.retryAfterSeconds) } : undefined,
      )
    }
    const now = deps.now()
    await markerRef.set(
      {
        hostId,
        formId,
        key,
        ...(marker.exists ? {} : { createdAtMs: now, files: {} }),
        sweepAtMs: now + FORM_UPLOAD_KEY_TTL_MS,
      },
      { merge: true },
    )
    return json({ ticket: minted.ticket, upload: minted.upload, file: minted.file })
  }

  if (action === 'finalize') {
    const uploads = await deps.uploads()
    const kept = await uploads.finalize({ scope, ticket: body['ticket'], caller })
    if ('error' in kept) return json({ error: kept.error, code: kept.code }, kept.status)
    // The ticket held the kinds; the bytes are held to them again here.
    if (!visitorUploadTypeInKinds(kept.file.contentType, decl.fileKinds)) {
      await uploads.remove(kept.file.path).catch(() => undefined)
      return json({ error: `${kept.file.name} isn’t a kind of file this field takes.` }, 415)
    }
    const now = deps.now()
    const answer = await firestore.runTransaction(async (transaction) => {
      const marker = await transaction.get(markerRef)
      // Swept, or never ticketed here: the file has no key to belong to.
      if (!marker.exists) return 'gone' as const
      const files = formUploadKeyFiles(marker.data())
      if (files[kept.file.id] === field) return 'kept' as const
      if (countFor(files, field) >= (decl.maxFiles ?? VISITOR_UPLOAD_MAX_FILES)) return 'full' as const
      transaction.set(
        markerRef,
        { files: { ...files, [kept.file.id]: field }, sweepAtMs: now + FORM_UPLOAD_KEY_TTL_MS },
        { merge: true },
      )
      return 'kept' as const
    })
    if (answer !== 'kept') {
      await uploads.remove(kept.file.path).catch(() => undefined)
      return answer === 'full'
        ? json({ error: fullMessage(decl) }, 409)
        : json({ error: 'This upload took too long. Reload the page and attach the file again.' }, 410)
    }
    return json({ file: visitorUploadFileView(kept.file) })
  }

  return json({ error: 'Unknown action' }, 400)
}

/** `POST /api/forms/upload`. */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handleFormUpload(defaultFormUploadDeps(), request)
  } catch (error) {
    console.error('[forms] upload failed', error)
    return json({ error: 'The file could not be sent. Try again.' }, 500)
  }
}
