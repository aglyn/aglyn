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
  FORMS_MAX_PER_HOST,
  type FormFieldDecl,
  type FormFieldType,
} from '@aglyn/aglyn/app-utils/forms'
import {
  TRANSFER_ID_FIELD,
  buildMatchLookup,
  transferIdField,
  type TransferCatalogInput,
  type TransferField,
  type TransferFieldGroup,
  type TransferFieldType,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferReadOptions,
  TransferRecordsHooks,
  TransferReadPage,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { FieldPath, Timestamp } from 'firebase-admin/firestore'
import { FORM_SUBMISSIONS_MATCH_KEYS } from './form-submissions-transfer-key'

/*==========================================
 * A SITE'S FORM SUBMISSIONS, AS AN EXPORT.
 *
 * `hosts/{hostId}/formSubmissions/{id}`, written only by this plugin's door
 * (`server/form-submit.ts`): the answers a visitor sent, keyed by the form
 * field's `fieldName`, with when, from which page and through which form.
 * The record as a reader may rely on it is `model/form-submission-record.ts`'s;
 * this module reads it the same way.
 *
 * ## Export only
 *
 * The declaration carries `exportOnly`: a submission is what a visitor sent
 * through a published form, and a file cannot have sent one. So the resource
 * answers the catalog, the reads, the count and a lookup by id, and registers
 * no `apply` or `revert` — the upload route refuses it before a byte is
 * stored.
 *
 * ## The columns follow the form
 *
 * A submission's answers have no fixed shape: each form asks its own
 * questions, and a form edited since asks different ones than its older
 * submissions answered. So the catalog is read from the site's forms, and
 * from the list filter the dialog was opened on (`ctx.filter`):
 *
 *  - one form (`{ formId }`): that form's questions, each `answer:<fieldName>`,
 *    labeled with the question and typed from the field; then "Other
 *    answers" — keys its most recent submissions carry and today's form no
 *    longer declares, so an answer to a removed question is still exported.
 *  - the whole site: every form's questions, each form its own group. A
 *    `fieldName` two forms share is one column (the first form's label), so
 *    an "email" asked by every form lands in one place.
 *
 * The submission's own details — the Aglyn ID, when it arrived, the form, the
 * page, read, replied, campaigns, where it was filed — are read-only, and the
 * platform-written ones are `system`.
 *
 * ## The reads are queries, never a loaded window
 *
 * `{ formId }` and `{ read }` are equalities on the stored row, ordered by
 * `createdAt` newest first with the document id breaking ties, so a page
 * boundary between two submissions of the same instant neither repeats nor
 * skips one. `formId ↑ createdAt ↓` and `read ↑ createdAt ↓` are the
 * collection's existing indexes (the console's per-form list and the Inbox's
 * Read filter); no filter rides the single-field `createdAt` index. Both at
 * once needs `formId ↑ read ↑ createdAt ↓`, which the export dialog never
 * asks for today.
 *
 * ## Scope
 *
 * A host resource: the export route admits a reader only on the site, with
 * `data.manage` there. Submissions carry no `visibleTo`, so `scopeTokens` —
 * a site-scoped collaborator's tokens — narrows nothing here: a collaborator
 * the route let onto this site may read this site's submissions, as the
 * Inbox lets them.
 *=========================================*/

const SUBMISSIONS = 'formSubmissions'
const FORMS = 'forms'

/** The prefix of an answer's field id; the rest is the form field's `fieldName`. */
export const FORM_SUBMISSION_ANSWER_PREFIX = 'answer:'

/** How many of the most recent submissions the catalog reads for answers today's forms no longer ask. */
export const FORM_SUBMISSIONS_ANSWER_SAMPLE_ROWS = 200

/**
 * The most "other answers" columns the catalog offers. A submission's keys
 * come from the visitor's request (up to twenty, each at most 64 characters),
 * so a sample can hold keys no form ever asked; the most frequent are kept.
 */
export const FORM_SUBMISSIONS_OTHER_ANSWERS_MAX = 50

const PAGE_ROWS_DEFAULT = 200
const PAGE_ROWS_MAX = 500
/** Documents one `getAll` reads at a time, for a selection. */
const READ_BY_ID_CHUNK = 300

/** The group the submission's own details are listed under. */
export const FORM_SUBMISSION_DETAILS_GROUP: TransferFieldGroup = { id: 'submission', label: 'Submission' }
/** The group of answers no form declares today. */
export const FORM_SUBMISSION_OTHER_ANSWERS_GROUP: TransferFieldGroup = {
  id: 'otherAnswers',
  label: 'Other answers',
}

/** A form's questions are listed under `form:<formId>`. */
export function formAnswersGroupId(formId: string): string {
  return `form:${formId}`
}

/** The field id an answer to `fieldName` is exported under. */
export function formSubmissionAnswerFieldId(fieldName: string): string {
  return `${FORM_SUBMISSION_ANSWER_PREFIX}${fieldName}`
}

/** What an answer is, from the form field that asked it. */
export function formAnswerTransferType(fieldType: FormFieldType | undefined): TransferFieldType {
  switch (fieldType) {
    case 'email':
      return 'email'
    case 'textarea':
      return 'longText'
    case 'rating':
      return 'integer'
    default:
      return 'text'
  }
}

/*==========================================
 * THE FILTER
 *=========================================*/

/** The list filter, in this resource's terms: one form, and read or unread. */
export interface FormSubmissionsFilter {
  formId?: string
  read?: boolean
}

/**
 * The filter a dialog or a route handed over, or why it cannot be used.
 * Refused rather than ignored: a filter dropped without a word exports more
 * than the person asked for.
 */
export function readFormSubmissionsFilter(value: unknown): FormSubmissionsFilter {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A form submissions filter is an object naming formId and read.')
  }
  const filter: FormSubmissionsFilter = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue
    if (key === 'formId') {
      const formId = typeof raw === 'string' ? raw.trim() : ''
      if (!formId || formId.includes('/')) throw new Error('The form submissions filter names no usable form.')
      filter.formId = formId
    } else if (key === 'read') {
      if (raw === true || raw === 'true') filter.read = true
      else if (raw === false || raw === 'false') filter.read = false
      else throw new Error('The form submissions filter says read as true or false.')
    } else {
      throw new Error(`A form submissions filter names formId and read; "${key}" is not one.`)
    }
  }
  return filter
}

function matchesFilter(data: Readonly<Record<string, unknown>>, filter: FormSubmissionsFilter): boolean {
  if (filter.formId !== undefined && data['formId'] !== filter.formId) return false
  if (filter.read !== undefined && (data['read'] === true) !== filter.read) return false
  return true
}

/*==========================================
 * THE CATALOG
 *=========================================*/

/** The submission's own details, in the order a person reads them. */
export function formSubmissionDetailFields(): TransferField[] {
  const group = FORM_SUBMISSION_DETAILS_GROUP.id
  return [
    { ...transferIdField(), group },
    {
      id: 'createdAt',
      label: 'Submitted at',
      group,
      type: 'datetime',
      readOnly: true,
      system: true,
      aliases: ['submitted', 'created', 'date'],
      description: 'When the submission arrived, by the server’s clock.',
    },
    {
      id: 'formId',
      label: 'Form ID',
      group,
      type: 'text',
      readOnly: true,
      system: true,
      description: 'The form it was sent through; blank on submissions older than the form itself.',
    },
    {
      id: 'formName',
      label: 'Form name',
      group,
      type: 'text',
      readOnly: true,
      system: true,
      aliases: ['form'],
      description: 'What the form was called when the submission arrived.',
    },
    {
      id: 'path',
      label: 'Page path',
      group,
      type: 'text',
      readOnly: true,
      system: true,
      aliases: ['page', 'path'],
      description: 'The page of the site it was sent from.',
    },
    {
      id: 'read',
      label: 'Read',
      group,
      type: 'boolean',
      readOnly: true,
      description: 'Whether someone has marked it read in the Inbox.',
    },
    {
      id: 'repliedAt',
      label: 'Replied at',
      group,
      type: 'datetime',
      readOnly: true,
      description: 'When it was last answered from the Inbox.',
    },
    {
      id: 'campaignIds',
      label: 'Campaign IDs',
      group,
      type: 'tags',
      readOnly: true,
      system: true,
      description: 'The campaigns the form was filed under when the submission arrived.',
    },
    {
      id: 'routing',
      label: 'Where it was filed',
      group,
      type: 'json',
      readOnly: true,
      system: true,
      description: 'Where the submission was also filed beyond the Inbox, such as a dataset, or why it was not.',
    },
    {
      id: 'rateDegraded',
      label: 'Arrived while rate limits were unchecked',
      group,
      type: 'boolean',
      readOnly: true,
      system: true,
      description: 'Yes when it arrived during a moment the site’s submission rate limit could not be checked.',
    },
    {
      id: 'hostId',
      label: 'Site ID',
      group,
      type: 'text',
      readOnly: true,
      system: true,
    },
  ]
}

/** One form as the catalog reads it: its id, its name, and the questions it declares. */
export interface FormQuestions {
  id: string
  name: string
  fields: readonly FormFieldDecl[]
}

function formQuestionsOf(id: string, data: Readonly<Record<string, unknown>> | undefined): FormQuestions {
  const declared = Array.isArray(data?.['fields']) ? (data?.['fields'] as unknown[]) : []
  const displayName = data?.['displayName']
  return {
    id,
    name: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : id,
    fields: declared.filter(
      (field): field is FormFieldDecl =>
        Boolean(field) &&
        typeof field === 'object' &&
        typeof (field as FormFieldDecl).fieldName === 'string' &&
        (field as FormFieldDecl).fieldName.trim() !== '',
    ),
  }
}

function answerField(decl: FormFieldDecl, group: string): TransferField {
  const label = typeof decl.label === 'string' && decl.label.trim() ? decl.label.trim() : decl.fieldName
  return {
    id: formSubmissionAnswerFieldId(decl.fieldName),
    label,
    group,
    type: formAnswerTransferType(decl.fieldType),
    ...(label !== decl.fieldName ? { aliases: [decl.fieldName] } : {}),
  }
}

/**
 * The catalog, from the forms read and the answer keys sampled (see the
 * block header). `scoped` is true when the dialog was opened on one form.
 */
export function formSubmissionsCatalog(input: {
  forms: readonly FormQuestions[]
  sampledKeys: readonly string[]
  scoped: boolean
}): TransferCatalogInput {
  const answers: TransferField[] = []
  const groups: TransferFieldGroup[] = [FORM_SUBMISSION_DETAILS_GROUP]
  const taken = new Set<string>()
  for (const form of input.forms) {
    const group: TransferFieldGroup = {
      id: formAnswersGroupId(form.id),
      label: input.scoped ? 'Answers' : `Answers: ${form.name}`,
    }
    let added = false
    for (const decl of form.fields) {
      if (taken.has(decl.fieldName)) continue
      taken.add(decl.fieldName)
      answers.push(answerField(decl, group.id))
      added = true
    }
    if (added) groups.push(group)
  }
  const others = input.sampledKeys.filter((key) => !taken.has(key)).slice(0, FORM_SUBMISSIONS_OTHER_ANSWERS_MAX)
  for (const key of others) {
    answers.push({
      id: formSubmissionAnswerFieldId(key),
      label: key,
      group: FORM_SUBMISSION_OTHER_ANSWERS_GROUP.id,
      type: 'text',
      description: input.scoped
        ? 'An answer earlier submissions to this form carry that the form no longer asks for.'
        : 'An answer earlier submissions carry that no form on this site asks for today.',
    })
  }
  if (others.length) groups.push(FORM_SUBMISSION_OTHER_ANSWERS_GROUP)
  return { standard: [...formSubmissionDetailFields(), ...answers], groups }
}

/** The answer keys the sampled submissions carry, most frequent first, then first seen. */
export function sampledAnswerKeys(rows: ReadonlyArray<Readonly<Record<string, unknown>> | undefined>): string[] {
  const seen = new Map<string, { count: number; order: number }>()
  for (const data of rows) {
    const fields = data?.['fields']
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue
    for (const key of Object.keys(fields)) {
      if (!key.trim()) continue
      const entry = seen.get(key)
      if (entry) entry.count += 1
      else seen.set(key, { count: 1, order: seen.size })
    }
  }
  return [...seen.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.order - b.order)
    .map(([key]) => key)
}

/*==========================================
 * ONE ROW
 *=========================================*/

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** A stored instant as ISO text, so a CSV reads it: a Firestore Timestamp, a Date, or milliseconds. */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  const toDate = (value as { toDate?: () => Date }).toDate
  if (typeof toDate === 'function') return isoOf(toDate.call(value))
  return null
}

const DETAIL_READERS: Readonly<Record<string, (data: Readonly<Record<string, unknown>>, id: string) => unknown>> = {
  [TRANSFER_ID_FIELD]: (_data, id) => id,
  createdAt: (data) => isoOf(data['createdAt']),
  formId: (data) => textOrNull(data['formId']),
  formName: (data) => textOrNull(data['formName']),
  path: (data) => textOrNull(data['path']),
  read: (data) => data['read'] === true,
  repliedAt: (data) => isoOf(data['repliedAtMs']),
  campaignIds: (data) =>
    Array.isArray(data['campaignIds'])
      ? (data['campaignIds'] as unknown[]).filter((one): one is string => typeof one === 'string' && one !== '')
      : [],
  routing: (data) =>
    data['routing'] && typeof data['routing'] === 'object' && !Array.isArray(data['routing'])
      ? data['routing']
      : null,
  rateDegraded: (data) => data['rateDegraded'] === true,
  hostId: (data) => textOrNull(data['hostId']),
}

/**
 * One submission as an export row: only `fieldIds`, keyed by field id. An
 * answer is the value as the visitor sent it; a question they did not answer,
 * or a field id this resource does not know, is `null`.
 */
export function formSubmissionTransferRow(
  id: string,
  data: Readonly<Record<string, unknown>>,
  fieldIds: readonly string[],
): Record<string, unknown> {
  const answers =
    data['fields'] && typeof data['fields'] === 'object' && !Array.isArray(data['fields'])
      ? (data['fields'] as Readonly<Record<string, unknown>>)
      : {}
  const row: Record<string, unknown> = {}
  for (const fieldId of fieldIds) {
    const reader = DETAIL_READERS[fieldId]
    if (reader) row[fieldId] = reader(data, id)
    else if (fieldId.startsWith(FORM_SUBMISSION_ANSWER_PREFIX)) {
      const answer = answers[fieldId.slice(FORM_SUBMISSION_ANSWER_PREFIX.length)]
      row[fieldId] = answer === undefined ? null : answer
    } else row[fieldId] = null
  }
  return row
}

/*==========================================
 * THE CURSOR
 *=========================================*/

/**
 * Where the next page of a query starts: the last row's `createdAt` (seconds
 * and nanoseconds, so two submissions a microsecond apart stay apart) and
 * its id. A selection's cursor is the offset into the ids.
 */
export function formSubmissionsCursor(createdAt: unknown, id: string): string {
  const at = createdAt as { seconds?: unknown; nanoseconds?: unknown } | null | undefined
  if (typeof at?.seconds !== 'number' || typeof at?.nanoseconds !== 'number') {
    throw new Error(`Form submission ${id} has no submission time to page from.`)
  }
  return `${at.seconds}:${at.nanoseconds}:${id}`
}

function readQueryCursor(cursor: string): { createdAt: Timestamp; id: string } {
  const found = /^(-?\d+):(\d+):([^]+)$/.exec(cursor)
  if (!found) throw new Error('The export cursor could not be read.')
  return { createdAt: new Timestamp(Number(found[1]), Number(found[2])), id: found[3] as string }
}

function readOffsetCursor(cursor: string | null): number {
  if (cursor === null) return 0
  if (!/^\d+$/.test(cursor)) throw new Error('The export cursor could not be read.')
  return Number(cursor)
}

/*==========================================
 * THE RESOURCE
 *=========================================*/

export interface FormSubmissionsTransferDeps {
  firestore: FirebaseFirestore.Firestore
}

/** The hooks an export-only records resource answers with: no apply or revert. */
export type FormSubmissionsTransferResource = Required<
  Pick<TransferRecordsHooks, 'matchKeys' | 'fields' | 'count' | 'readPage' | 'lookup'>
>

function pageSizeOf(options: TransferReadOptions | undefined): number {
  const asked = Math.floor(Number(options?.pageSize) || PAGE_ROWS_DEFAULT)
  return Math.max(1, Math.min(PAGE_ROWS_MAX, asked))
}

/** The ids of a selection, each once, in the order given. */
function selectionIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id !== '' && !id.includes('/')))]
}

/**
 * The form submissions resource's server half (see the block header).
 * Firestore is handed in, so a spec runs it over an in-memory one.
 */
export function createFormSubmissionsTransferResource(
  deps: FormSubmissionsTransferDeps,
): FormSubmissionsTransferResource {
  const { firestore } = deps
  const site = (hostId: string) => firestore.collection('hosts').doc(hostId)
  const submissions = (hostId: string) => site(hostId).collection(SUBMISSIONS)

  /** The filter as Firestore equalities, over the collection's existing indexes. */
  const filtered = (hostId: string, filter: FormSubmissionsFilter): FirebaseFirestore.Query => {
    let query: FirebaseFirestore.Query = submissions(hostId)
    if (filter.formId !== undefined) query = query.where('formId', '==', filter.formId)
    if (filter.read !== undefined) query = query.where('read', '==', filter.read)
    return query
  }
  const newestFirst = (query: FirebaseFirestore.Query): FirebaseFirestore.Query =>
    query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')

  /** The selection's documents that exist and keep the filter, in the order given. */
  const readByIds = async (
    hostId: string,
    ids: readonly string[],
    filter: FormSubmissionsFilter,
  ): Promise<FirebaseFirestore.DocumentSnapshot[]> => {
    const found: FirebaseFirestore.DocumentSnapshot[] = []
    for (let at = 0; at < ids.length; at += READ_BY_ID_CHUNK) {
      const refs = ids.slice(at, at + READ_BY_ID_CHUNK).map((id) => submissions(hostId).doc(id))
      if (!refs.length) continue
      const snapshots = await firestore.getAll(...refs)
      for (const snapshot of snapshots) {
        const data = snapshot.data()
        if (snapshot.exists && data && matchesFilter(data, filter)) found.push(snapshot)
      }
    }
    return found
  }

  const readForms = async (hostId: string, formId: string | undefined): Promise<FormQuestions[]> => {
    if (formId !== undefined) {
      const snapshot = await site(hostId).collection(FORMS).doc(formId).get()
      return snapshot.exists ? [formQuestionsOf(snapshot.id, snapshot.data())] : []
    }
    const snapshot = await site(hostId).collection(FORMS).limit(FORMS_MAX_PER_HOST).get()
    return snapshot.docs
      .map((document) => formQuestionsOf(document.id, document.data()))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  }

  const readPage = async (
    ctx: TransferResourceContext,
    cursor: string | null,
    fieldIds: readonly string[],
    options?: TransferReadOptions,
  ): Promise<TransferReadPage> => {
    const hostId = ctx.hostId
    if (!hostId) return { rows: [], next: null }
    const filter = readFormSubmissionsFilter(options?.filter)
    const size = pageSizeOf(options)
    if (options?.ids) {
      const ids = selectionIds(options.ids)
      const from = readOffsetCursor(cursor)
      const to = from + size
      const snapshots = await readByIds(hostId, ids.slice(from, to), filter)
      return {
        rows: snapshots.map((snapshot) => formSubmissionTransferRow(snapshot.id, snapshot.data() ?? {}, fieldIds)),
        next: to < ids.length ? String(to) : null,
      }
    }
    let query = newestFirst(filtered(hostId, filter))
    if (cursor !== null) {
      const after = readQueryCursor(cursor)
      query = query.startAfter(after.createdAt, after.id)
    }
    // One past the page, so the last page says it is the last.
    const snapshot = await query.limit(size + 1).get()
    const page = snapshot.docs.slice(0, size)
    const last = page[page.length - 1]
    return {
      rows: page.map((document) => formSubmissionTransferRow(document.id, document.data(), fieldIds)),
      next: snapshot.docs.length > size && last ? formSubmissionsCursor(last.get('createdAt'), last.id) : null,
    }
  }

  return {
    matchKeys: FORM_SUBMISSIONS_MATCH_KEYS,

    async fields(ctx) {
      const hostId = ctx.hostId
      if (!hostId) return formSubmissionsCatalog({ forms: [], sampledKeys: [], scoped: false })
      const { formId } = readFormSubmissionsFilter(ctx.filter)
      const [forms, sample] = await Promise.all([
        readForms(hostId, formId),
        newestFirst(filtered(hostId, formId === undefined ? {} : { formId }))
          .limit(FORM_SUBMISSIONS_ANSWER_SAMPLE_ROWS)
          .get(),
      ])
      return formSubmissionsCatalog({
        forms,
        sampledKeys: sampledAnswerKeys(sample.docs.map((document) => document.data())),
        scoped: formId !== undefined,
      })
    },

    async count(ctx, options) {
      const hostId = ctx.hostId
      if (!hostId) return 0
      const filter = readFormSubmissionsFilter(options.filter)
      if (options.ids) return (await readByIds(hostId, selectionIds(options.ids), filter)).length
      const counted = await filtered(hostId, filter).count().get()
      return counted.data().count
    },

    readPage,

    /**
     * What a submission holds now, by its Aglyn ID — the one key this
     * resource answers, since nothing ever imports into it.
     */
    async lookup(ctx, requests) {
      const byId = requests.filter((request) => request.fieldId === TRANSFER_ID_FIELD)
      const ids = byId.flatMap((request) => request.values)
      const found = ctx.hostId ? await readByIds(ctx.hostId, selectionIds(ids), {}) : []
      const records = new Map<string, Record<string, unknown>>()
      for (const document of found) {
        const data = document.data() ?? {}
        const answers = data['fields'] && typeof data['fields'] === 'object' ? Object.keys(data['fields']) : []
        records.set(
          document.id,
          formSubmissionTransferRow(document.id, data, [
            ...Object.keys(DETAIL_READERS),
            ...answers.map(formSubmissionAnswerFieldId),
          ]),
        )
      }
      const lookup = buildMatchLookup(
        [...records].map(([id, values]) => ({ id, values })),
        byId,
      )
      return { lookup, records }
    },
  }
}
