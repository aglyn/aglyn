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

import { extractEmailFromFields } from '@aglyn/aglyn/app-utils/contacts'
import type { FormFieldDecl } from '@aglyn/aglyn/app-utils/forms'
import { visitorUploadFinalPath } from '@aglyn/aglyn/app-utils/visitor-upload'
import type {
  PluginRecordFactsRead,
  PluginRecordFactsReader,
  PluginRecordFactsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  formFileScope,
  FORM_SUBMISSION_FACTS_RESOURCE,
  readFormSubmissionFiles,
  readSubmissionRequest,
  readSubmissionThread,
} from '../model/form-request'
import { memberMayReadSubmissions } from './submission-access'

/*==========================================
 * A FORM SUBMISSION'S FACTS, FOR ANOTHER PLUGIN (AGL-4098), on the core's
 * record-facts seam under {@link FORM_SUBMISSION_FACTS_RESOURCE}.
 *
 * Commerce starts a quote from a quote request in the Inbox, and must not read
 * this plugin's collection to do it. It asks here, for the member it has
 * verified, and gets:
 *
 *   record: 'formSubmission'
 *   hostId, formId (null when no form entity filed it), formName, createdAtMs
 *   request: { kind: 'quote' } | null
 *   person: { name, email, phone, company } — each '' when the form had none
 *   capturedRecord: { kind: 'lead' | 'contact', id } | null — the person the
 *            CRM filed the submission as, when it filed one
 *   message: the request's own words (a message, details or notes field,
 *            else the form's first multi-line field), or ''
 *   answers: [{ field, label, value }] in the order they were sent
 *   fieldData: { [field]: string } — machine values a field posted beside its
 *            answer (a product and its options), for the plugin that wrote them
 *   files: [{ id, field, name, contentType, size, path }] — `path` is the
 *            private object, for a server that streams it behind its own gate;
 *            never to be sent to a browser
 *   emailThread: the conversation the confirmation started, or null
 *
 * Read on the rules the Inbox reads on: the site must belong to the
 * organization asked about, and the member must be one who may read the
 * site's submissions (`memberMayReadSubmissions`). Nothing here writes.
 *=========================================*/

export { FORM_SUBMISSION_FACTS_RESOURCE }

export interface SubmissionFactsDeps {
  firestore(): FirebaseFirestore.Firestore
  orgMember(orgId: string, uid: string): Promise<Record<string, unknown> | null>
}

export function defaultSubmissionFactsDeps(): SubmissionFactsDeps {
  const firestore = () => firebaseAdmin.app().firestore()
  return {
    firestore,
    orgMember: async (orgId, uid) => {
      const snapshot = await firestore().collection('orgs').doc(orgId).collection('members').doc(uid).get()
      return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
    },
  }
}

const MESSAGE_KEYS = ['message', 'details', 'description', 'notes', 'comments', 'comment', 'project', 'request']

/** The first of `keys` the person filled in, trimmed. */
function firstOf(fields: Record<string, string>, keys: readonly string[]): string {
  const lower = new Map(Object.keys(fields).map((key) => [key.toLowerCase(), key]))
  for (const key of keys) {
    const found = lower.get(key.toLowerCase())
    const value = found ? String(fields[found] ?? '').trim() : ''
    if (value) return value
  }
  return ''
}

/** Who sent it, as far as the answers say. */
export function submissionPerson(fields: Record<string, string>): {
  name: string
  email: string
  phone: string
  company: string
} {
  const first = firstOf(fields, ['firstName', 'first_name', 'givenName'])
  const last = firstOf(fields, ['lastName', 'last_name', 'familyName'])
  return {
    name: (firstOf(fields, ['name', 'fullName', 'full_name', 'yourName']) || [first, last].filter(Boolean).join(' ')).slice(0, 200),
    email: (extractEmailFromFields(fields) ?? '').slice(0, 200),
    phone: firstOf(fields, ['phone', 'phoneNumber', 'tel', 'mobile', 'telephone']).slice(0, 40),
    company: firstOf(fields, ['company', 'companyName', 'business', 'businessName', 'organization']).slice(0, 200),
  }
}

/** The request's own words: a message field, else the form's first multi-line field. */
export function submissionMessage(fields: Record<string, string>, decls: readonly FormFieldDecl[]): string {
  const named = firstOf(fields, MESSAGE_KEYS)
  if (named) return named.slice(0, 5000)
  const multiline = decls.find((decl) => decl?.fieldType === 'textarea' && String(fields[decl.fieldName] ?? '').trim())
  return multiline ? String(fields[multiline.fieldName]).trim().slice(0, 5000) : ''
}

/** The lead or contact the submission was filed as, or null. */
function capturedRecordOf(raw: unknown): { kind: 'lead' | 'contact'; id: string } | null {
  const record = (raw ?? null) as { kind?: unknown; id?: unknown } | null
  return (record?.kind === 'lead' || record?.kind === 'contact') && typeof record.id === 'string' && record.id
    ? { kind: record.kind, id: record.id }
    : null
}

export async function readSubmissionFacts(
  deps: SubmissionFactsDeps,
  request: PluginRecordFactsRequest,
): Promise<PluginRecordFactsRead> {
  const { hostId, id, orgId, uid } = request
  if (!hostId || !id) return { ok: false, status: 400, error: 'A submission is read under its site.' }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const [host, submission] = await Promise.all([hostRef.get(), hostRef.collection('formSubmissions').doc(id).get()])
  if (!host.exists || String(host.get('orgId') ?? '') !== orgId) {
    return { ok: false, status: 404, error: 'That submission is no longer in the Inbox.' }
  }
  const allowed = await memberMayReadSubmissions({
    uid,
    staff: request.staff === true,
    host,
    orgId: String(submission.get?.('orgId') ?? '') || orgId,
    orgMember: deps.orgMember,
  })
  if (!allowed) return { ok: false, status: 403, error: 'You can’t read this site’s submissions.' }
  if (!submission.exists) return { ok: false, status: 404, error: 'That submission is no longer in the Inbox.' }

  const data = submission.data() as Record<string, unknown>
  const fields = Object.fromEntries(
    Object.entries((data['fields'] ?? {}) as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
  )
  const formId = typeof data['formId'] === 'string' && data['formId'] ? data['formId'] : null
  const form = formId ? await hostRef.collection('forms').doc(formId).get() : null
  const decls = Array.isArray(form?.get('fields')) ? (form?.get('fields') as FormFieldDecl[]) : []
  const label = (field: string) => decls.find((decl) => decl?.fieldName === field)?.label?.trim() || field
  const createdAt = data['createdAt'] as { toMillis?: () => number } | null | undefined
  const scope = formFileScope(hostId, id)
  const fieldData = Object.fromEntries(
    Object.entries((data['fieldData'] ?? {}) as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, value.slice(0, 2000)]),
  )
  return {
    ok: true,
    facts: {
      record: 'formSubmission',
      hostId,
      formId,
      formName: String(data['formName'] ?? '') || 'Form',
      createdAtMs: typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : null,
      request: readSubmissionRequest(data['request']),
      person: submissionPerson(fields),
      capturedRecord: capturedRecordOf(data['capturedRecord']),
      message: submissionMessage(fields, decls),
      answers: Object.entries(fields).map(([field, value]) => ({ field, label: label(field), value })),
      fieldData,
      files: readFormSubmissionFiles(data['files']).map((file) => ({
        id: file.id,
        field: file.field,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        path: visitorUploadFinalPath(scope, file.id),
      })),
      emailThread: readSubmissionThread(data['emailThread']),
    },
  }
}

/** The reader as the seam registers it; its module loads with the first read. */
export const formSubmissionFactsReader: PluginRecordFactsReader = {
  read: (request) => readSubmissionFacts(defaultSubmissionFactsDeps(), request),
}
