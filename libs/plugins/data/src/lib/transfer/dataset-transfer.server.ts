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

import { createHash } from 'node:crypto'
import {
  TRANSFER_ID_FIELD,
  buildTransferPlan,
  matchLookupKey,
  planTransferUndo,
  rankTransferLookupSuggestions,
  transferLookupKey,
  transferLookupNewName,
  transferResourceInstanceOf,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferLookupSuggestion,
  type TransferPlanLimits,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { PicklistValue } from '@aglyn/aglyn/app-utils/picklists'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
  TransferLookupSuggestRequest,
  TransferPicklistList,
  TransferReadOptions,
  TransferReadPage,
  TransferRecordsHooks,
  TransferResourceContext,
  TransferRevertDecisions,
  TransferRevertResult,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import type { ListFilterClause } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { checkQuota, ensureDeclaredCustomFieldTypes, memberCanSee } from '@aglyn/aglyn/server'
import {
  dataStorageRefusal,
  firebaseAdmin,
  isServerReleaseFlagOnForOrg,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { applyListQuery } from '@aglyn/tenant-data-admin/server/list-query'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { FieldPath, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { datasetRecordFilter, planRecordQuery } from '../components/dataset-record-filter'
import {
  datasetFilterToken,
  datasetFilterValuePath,
  datasetFilterWords,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  effectiveDatasetModel,
  type DatasetFieldDefinition,
  type DatasetModel,
} from '../model/dataset-models'
import { datasetDisplayName, describeDatasetRecordErrors } from '../model/datasets'
import { fillRecordAddresses } from '../record-pages/record-pages'
import { announceDatasetRecords } from '../server/announce-dataset-records'
import { datasetTransferResourceKey } from './dataset-transfer-key'
import {
  datasetFieldIdOf,
  datasetFieldOfPicklist,
  datasetHoldsKey,
  datasetMatchKeyOffer,
  datasetMatchKeyQuery,
  datasetOptionsPicklist,
  datasetRecordTransferValues,
  datasetStorageValues,
  datasetTransferCatalog,
  datasetTransferFieldId,
  datasetWriteErrors,
  isOptionsField,
  limitDatasetCreates,
  refuseInvalidDatasetRows,
  type DatasetReferenceTarget,
} from './dataset-transfer-model'

/*==========================================
 * A DATASET'S RECORDS AS A TRANSFER RESOURCE (AGL-3530) — the server half.
 *
 * `data.dataset:<datasetId>` (`plugins.config.json`, `instances`): the job
 * engine (`@aglyn/tenant-data-admin/server/transfer-jobs`) reads the file,
 * matches it and keeps the job; these hooks answer for one dataset — its
 * catalog and match keys, its records page by page and by key, the dry run
 * held to its model, and the writes and their undo.
 *
 * ## The writes are the dataset's own
 *
 * A create goes the way `/api/orgs/datasets` creates (`datasets-route.ts`):
 * the values coerced, page addresses filled in and validated against the
 * model, and the `recordsPerDataset` count read, decided and written in ONE
 * transaction, the data storage band refusing first. An update is the
 * console's update: the record's values with the row's changes over them,
 * written with `mergeFields` so `filterValues` is replaced whole. Every write
 * carries the integrity index (`datasetIntegrityFields` on a create,
 * `datasetIntegrityUpdate` on an update), so `restrict` and `setNull` keep
 * answering by query. The live pages repeating over the dataset are told
 * once per chunk.
 *
 * ## A retried chunk never creates a record twice
 *
 * A created record is named by {@link transferRecordId} — the job and the
 * row — so a chunk the engine retries after a write landed but before the
 * ledger heard of it finds the record already there and writes nothing.
 *
 * ## References are the engine's lookups (AGL-3556)
 *
 * A reference field is a lookup of its target dataset, so the engine resolves
 * it through these same hooks asked as THAT dataset ({@link lookupDatasetRecords},
 * {@link suggestDatasetRecords}). A value the person chose to create arrives
 * as `transferLookupNewValue(name)`; {@link createNamedReferences} creates it
 * in the target through the same create as a row's record — once per name
 * however many rows name it, under an id derived from the job and the name,
 * so a retried chunk finds the record it already created. Undo leaves such a
 * record: other records may point at it by then.
 *
 * ## Undo keeps the references whole
 *
 * Undo deletes a created record the way the Data card deletes one: every
 * dataset that references this one is asked, by query, whether a record
 * still points at it. `restrict` keeps the record (reported back as a
 * conflict); `setNull` strips the reference from the holders first.
 *=========================================*/

/** What the hooks run against; a spec hands in a double. */
export interface DatasetTransferDeps {
  firestore: Firestore
}

const productionDeps = (): DatasetTransferDeps => ({ firestore: firebaseAdmin.app().firestore() })

/** The page an export reads when the engine names none. */
const PAGE_ROWS = 500

/** Firestore's cap on the values of one `in` query. */
const IN_MAX = 30

/** The most documents one `getAll` reads. */
const GET_ALL_MAX = 300

/** What a merging record write names, so each field is replaced whole. */
const RECORD_MERGE_FIELDS = ['values', 'referencedIds', 'filterKeys', 'filterValues', 'updatedAt']

const chunked = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

const notFound = () => new TransferEngineError('notFound', 404, 'No such dataset.')

/** The nanoid alphabet `createResourceUid` names documents from. */
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

/**
 * The id a record created by an import's row is given: ten characters of the
 * resource-id alphabet, derived from the job and the row, so a retried chunk
 * names the record it already wrote rather than writing a second one.
 */
export function transferRecordId(jobId: string, row: number): string {
  const digest = createHash('sha256').update(`${jobId}:${row}`).digest()
  let id = ''
  for (let at = 0; at < 10; at += 1) id += ID_ALPHABET[(digest[at] as number) % ID_ALPHABET.length]
  return id
}

/*------------------------------------------
 * The dataset a context names
 *-----------------------------------------*/

interface LoadedDataset {
  id: string
  label: string
  model: DatasetModel
  visibleTo: string[]
  orgRef: FirebaseFirestore.DocumentReference
  ref: FirebaseFirestore.DocumentReference
  records: FirebaseFirestore.CollectionReference
}

/**
 * The dataset per context object: the engine hands one context to every
 * hook a step runs, so an export's pages and a plan's lookups read the
 * dataset and the member once.
 */
const loaded = new WeakMap<TransferResourceContext, Promise<LoadedDataset>>()

async function readDataset(deps: DatasetTransferDeps, ctx: TransferResourceContext): Promise<LoadedDataset> {
  const datasetId = transferResourceInstanceOf(ctx)
  if (!datasetId) throw notFound()
  const orgRef = deps.firestore.collection('orgs').doc(ctx.orgId)
  const ref = orgRef.collection('datasets').doc(datasetId)
  const snapshot = await ref.get()
  const data = snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null
  if (!data || data['deletedAt'] != null) throw notFound()
  const visibleTo = Array.isArray(data['visibleTo']) ? (data['visibleTo'] as string[]) : []
  /*
   * The member has to SEE the dataset, as on every other door onto its
   * records (`datasets-route.ts`): the gate asked about the workspace, and a
   * collaborator scoped to one site passes it. The Admin SDK reads past the
   * rules, so this IS the enforcement, answered with the same 404 as a
   * dataset that does not exist. No membership is staff (the gate admitted
   * them) or the sweep resuming a job; the data store's release flag holds
   * for everyone else.
   */
  if (ctx.actorUid) {
    const member = (await resolveOrgMembership(ctx.actorUid, ctx.orgId))?.member
    if (member) {
      if (!memberCanSee(member as never, visibleTo)) throw notFound()
      if (!(await isServerReleaseFlagOnForOrg('release_data_store', ctx.orgId))) {
        throw new TransferEngineError('notFound', 404, 'Datasets are not available on this workspace.')
      }
    }
  }
  return {
    id: datasetId,
    label: datasetDisplayName(data) || 'Fields',
    model: effectiveDatasetModel(data as { model?: DatasetModel; fields?: string[] }),
    visibleTo,
    orgRef,
    ref,
    records: ref.collection('records'),
  }
}

function datasetFor(deps: DatasetTransferDeps, ctx: TransferResourceContext): Promise<LoadedDataset> {
  let pending = loaded.get(ctx)
  if (!pending) {
    pending = readDataset(deps, ctx)
    loaded.set(ctx, pending)
    pending.catch(() => loaded.delete(ctx))
  }
  return pending
}

/** The context a referenced dataset is asked in: the same job, actor and site, as that dataset. */
function targetContext(ctx: TransferResourceContext, datasetId: string): TransferResourceContext {
  return { ...ctx, resource: datasetTransferResourceKey(datasetId) }
}

/**
 * Each dataset the model references, as the person may use it: whether they
 * can read it (the same check as opening it), and its model when they can.
 */
async function datasetReferenceTargets(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  model: DatasetModel,
): Promise<Record<string, DatasetReferenceTarget>> {
  const out: Record<string, DatasetReferenceTarget> = {}
  for (const field of Object.values(model.fields ?? {})) {
    const targetId = field?.type === 'reference' ? field.reference?.datasetId : undefined
    if (!targetId || out[targetId]) continue
    try {
      out[targetId] = { readable: true, model: (await datasetFor(deps, targetContext(ctx, targetId))).model }
    } catch (error) {
      if (!(error instanceof TransferEngineError && error.code === 'notFound')) throw error
      out[targetId] = { readable: false }
    }
  }
  return out
}

/** A record document as transfer values. */
function viewOf(model: DatasetModel, doc: FirebaseFirestore.DocumentSnapshot): Record<string, unknown> {
  const data = (doc.data() ?? {}) as Record<string, unknown>
  return datasetRecordTransferValues(model, {
    id: doc.id,
    values: (data['values'] ?? {}) as Record<string, unknown>,
    createdAt: data['createdAt'],
    updatedAt: data['updatedAt'],
  })
}

async function getAll(
  firestore: Firestore,
  refs: readonly FirebaseFirestore.DocumentReference[],
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const out: FirebaseFirestore.DocumentSnapshot[] = []
  for (const slice of chunked(refs, GET_ALL_MAX)) if (slice.length) out.push(...(await firestore.getAll(...slice)))
  return out
}

/*------------------------------------------
 * Reading: the export's pages and the count
 *-----------------------------------------*/

/** The records table's filter as the Data card sends it: the grid's clauses and the search words. */
export interface DatasetTransferFilter {
  clauses: ListFilterClause[]
  search: string[]
}

function readFilter(filter: Readonly<Record<string, unknown>>): DatasetTransferFilter {
  const clauses = Array.isArray(filter['clauses']) ? filter['clauses'] : []
  const search = Array.isArray(filter['search']) ? filter['search'] : []
  const clause = (entry: unknown): entry is ListFilterClause => {
    const one = entry as Record<string, unknown> | null
    return Boolean(one) && typeof one?.['field'] === 'string' && typeof one?.['op'] === 'string' && typeof one?.['value'] === 'string'
  }
  if (!clauses.every(clause) || !search.every((word) => typeof word === 'string')) {
    throw new TransferEngineError('invalid', 400, 'The filter could not be read.')
  }
  return { clauses: clauses as ListFilterClause[], search: search as string[] }
}

/**
 * Every record, or the ones the records table's filter matches — the same
 * one query the table pages (`planRecordQuery`), ordered by document id.
 * What the table could not put on its query it did not apply either, so
 * neither does the export.
 */
function recordsQuery(dataset: LoadedDataset, options: TransferReadOptions | undefined): FirebaseFirestore.Query {
  if (!options?.filter) return dataset.records.orderBy(FieldPath.documentId())
  const filter = readFilter(options.filter)
  const { plan } = planRecordQuery(dataset.model, datasetRecordFilter(dataset.model), filter.clauses, filter.search)
  return applyListQuery(dataset.records, plan)
}

/** A collaborator's scope tokens must reach the dataset; records carry no scope of their own. */
function assertScope(dataset: LoadedDataset, options: TransferReadOptions | undefined): void {
  if (options?.scopeTokens && !options.scopeTokens.some((token) => dataset.visibleTo.includes(token))) throw notFound()
}

function pick(view: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fieldIds.filter((fieldId) => view[fieldId] !== undefined).map((fieldId) => [fieldId, view[fieldId]]))
}

export async function countDatasetRecords(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  options: TransferReadOptions,
): Promise<number> {
  const dataset = await datasetFor(deps, ctx)
  assertScope(dataset, options)
  if (options.ids) {
    let total = 0
    for (const slice of chunked(options.ids, IN_MAX)) {
      total += Number((await dataset.records.where(FieldPath.documentId(), 'in', slice).count().get()).data().count ?? 0)
    }
    return total
  }
  return Number((await recordsQuery(dataset, options).count().get()).data().count ?? 0)
}

export async function readDatasetPage(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options?: TransferReadOptions,
): Promise<TransferReadPage> {
  const dataset = await datasetFor(deps, ctx)
  assertScope(dataset, options)
  const size = Math.max(1, Math.min(options?.pageSize ?? PAGE_ROWS, PAGE_ROWS))
  if (options?.ids) {
    // The selection, in the order it was made; the cursor is how far through it.
    const offset = Math.max(0, Number(cursor ?? 0) || 0)
    const slice = options.ids.slice(offset, offset + size)
    const docs = await getAll(deps.firestore, slice.map((id) => dataset.records.doc(id)))
    return {
      rows: docs.filter((doc) => doc.exists).map((doc) => pick(viewOf(dataset.model, doc), fieldIds)),
      next: offset + size < options.ids.length ? String(offset + size) : null,
    }
  }
  let query = recordsQuery(dataset, options)
  if (cursor) query = query.startAfter(cursor)
  const snapshot = await query.limit(size).get()
  const docs = snapshot.docs
  return {
    rows: docs.map((doc) => pick(viewOf(dataset.model, doc), fieldIds)),
    next: docs.length === size ? (docs[docs.length - 1] as FirebaseFirestore.QueryDocumentSnapshot).id : null,
  }
}

/*------------------------------------------
 * Matching
 *-----------------------------------------*/

export async function lookupDatasetRecords(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<TransferLookupResult> {
  const dataset = await datasetFor(deps, ctx)
  const lookup = new Map<string, string[]>()
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  const file = (fieldId: string, normalized: string, id: string) => {
    const at = matchLookupKey(fieldId, normalized)
    const ids = lookup.get(at) ?? []
    if (!ids.includes(id)) ids.push(id)
    lookup.set(at, ids)
  }
  for (const request of requests) {
    if (!request.values.length) continue
    if (request.fieldId === TRANSFER_ID_FIELD) {
      const docs = await getAll(deps.firestore, request.values.map((id) => dataset.records.doc(id)))
      for (const doc of docs) {
        if (!doc.exists) continue
        records.set(doc.id, viewOf(dataset.model, doc))
        file(request.fieldId, doc.id, doc.id)
      }
      continue
    }
    // Asked of `filterValues`, the index the records table's own filters
    // read; a value clipped there is held to the whole value below.
    const asked = new Map<string | number, string[]>()
    for (const normalized of request.values) {
      const query = datasetMatchKeyQuery(dataset.model, request, normalized)
      if (!query) continue
      asked.set(query.value, [...(asked.get(query.value) ?? []), normalized])
    }
    const path = datasetFilterValuePath(datasetFieldIdOf(request.fieldId) ?? '')
    if (!path) continue
    for (const slice of chunked([...asked.keys()], IN_MAX)) {
      const snapshot = await dataset.records.where(path, 'in', slice).get()
      for (const doc of snapshot.docs) {
        const view = viewOf(dataset.model, doc)
        let held = false
        for (const normalized of slice.flatMap((value) => asked.get(value) ?? [])) {
          if (!datasetHoldsKey(view, request, normalized)) continue
          file(request.fieldId, normalized, doc.id)
          held = true
        }
        if (held) records.set(doc.id, view)
      }
    }
  }
  return { lookup, records }
}

/** The most distinct word queries one suggestion request runs. */
const SUGGEST_QUERIES_MAX = 200

/** The records one word query reads. */
const SUGGEST_READ = 20

/** The words of a value its candidates are asked by. */
const SUGGEST_WORDS = 2

/** The leading characters a word is also asked by, so a later misspelling still finds it. */
const SUGGEST_STEM = 3

/**
 * Records named LIKE each value a reference could not find, for the person
 * to pick from: each plain text `by` field asked for records with a word that
 * starts with one of the value's first words, or with its first few letters
 * (the `filterKeys` prefix tokens the records table's `contains` reads), then
 * ranked by how close the whole name is. Values past the query budget get none.
 */
export async function suggestDatasetRecords(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  request: TransferLookupSuggestRequest,
): Promise<Record<string, TransferLookupSuggestion[]>> {
  const dataset = await datasetFor(deps, ctx)
  const fields = request.by
    .map((transferId) => datasetFieldIdOf(transferId))
    .filter((fieldId): fieldId is string => {
      const field = fieldId ? dataset.model.fields?.[fieldId] : undefined
      return field?.type === 'text' && !isOptionsField(field)
    })
  const asked = new Map<string, Promise<Array<{ recordId: string; label: string }>>>()
  const ask = (fieldId: string, token: string) => {
    const at = `${fieldId}\u0000${token}`
    let pending = asked.get(at)
    if (!pending) {
      pending = dataset.records
        .where('filterKeys', 'array-contains', token)
        .limit(SUGGEST_READ)
        .get()
        .then((snapshot) =>
          snapshot.docs.map((doc) => ({
            recordId: doc.id,
            label: String(((doc.get('values') ?? {}) as Record<string, unknown>)[fieldId] ?? '').trim(),
          })),
        )
      asked.set(at, pending)
    }
    return pending
  }
  const answer: Record<string, TransferLookupSuggestion[]> = {}
  for (const value of request.values) {
    const candidates: TransferLookupSuggestion[] = []
    for (const fieldId of fields) {
      for (const word of datasetFilterWords(value).slice(0, SUGGEST_WORDS)) {
        const stem = Array.from(word).slice(0, SUGGEST_STEM).join('')
        for (const asWord of new Set([word, stem])) {
          const token = datasetFilterToken(dataset.model, { field: fieldId, op: 'contains', value: asWord })
          if (!token || (asked.size >= SUGGEST_QUERIES_MAX && !asked.has(`${fieldId}\u0000${token}`))) continue
          candidates.push(...(await ask(fieldId, token)).filter((candidate) => candidate.label))
        }
      }
    }
    answer[value] = rankTransferLookupSuggestions(value, candidates, { limit: 5 })
  }
  return answer
}

/*------------------------------------------
 * Options fields as picklists
 *-----------------------------------------*/

export async function datasetPicklists(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  picklistIds: readonly string[],
): Promise<Record<string, TransferPicklistList>> {
  const { model } = await datasetFor(deps, ctx)
  const out: Record<string, TransferPicklistList> = {}
  for (const picklistId of picklistIds) {
    const field = model.fields?.[datasetFieldOfPicklist(picklistId) ?? '']
    if (field) out[picklistId] = datasetOptionsPicklist(field)
  }
  return out
}

/**
 * The values the person chose to add to an options field, added to the
 * field's options in the dataset's model — the schema the Schema dialog
 * edits — before the import's first write. A value already there is left.
 */
export async function addDatasetOptions(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  picklistId: string,
  values: readonly PicklistValue[],
): Promise<void> {
  const dataset = await datasetFor(deps, ctx)
  const fieldId = datasetFieldOfPicklist(picklistId)
  if (!fieldId) return
  await deps.firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(dataset.ref)
    const model = effectiveDatasetModel((snapshot.data() ?? {}) as { model?: DatasetModel; fields?: string[] })
    const field = model.fields?.[fieldId]
    if (!field) return
    const options = [...(field.validation?.options ?? [])]
    const added = values.map((value) => value.label).filter((label) => label && !options.includes(label))
    if (!added.length) return
    tx.update(dataset.ref, {
      model: {
        ...model,
        fields: { ...model.fields, [fieldId]: { ...field, validation: { ...field.validation, options: [...options, ...added] } } },
      },
      updatedAt: Timestamp.now(),
    })
  })
  // The writes that follow validate against the options just added.
  loaded.delete(ctx)
}

/*------------------------------------------
 * The dry run
 *-----------------------------------------*/

/**
 * The records this import may create, from the plan's `recordsPerDataset`
 * against the dataset's real size — and none while the data storage band is
 * full — so the dry run fails what Apply would refuse.
 */
async function createLimits(dataset: LoadedDataset): Promise<Pick<TransferPlanLimits, 'maxCreates'>> {
  const org = (await dataset.orgRef.get()).data() as never
  if (await dataStorageRefusal(org, dataset.orgRef)) return { maxCreates: 0 }
  const live = Number((await dataset.records.count().get()).data().count ?? 0)
  const { remaining } = checkQuota(org, 'recordsPerDataset', live)
  return Number.isFinite(remaining) ? { maxCreates: remaining } : {}
}

/*------------------------------------------
 * Apply
 *-----------------------------------------*/

interface Landed {
  result: TransferRowResult
  undo?: TransferUndoEntry
}

const failed = (row: PlannedTransferRow, reason: string, message?: string): Landed => ({
  result: {
    row: row.index,
    outcome: 'failed',
    ...(row.recordId ? { recordId: row.recordId } : {}),
    reason,
    ...(message ? { message } : {}),
  },
})

function only(view: Readonly<Record<string, unknown>>, fieldIds: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, view[fieldId] ?? null]))
}

/** Updates: each record's values with the row's changes over them, in one batch. */
async function applyUpdates(
  deps: DatasetTransferDeps,
  dataset: LoadedDataset,
  rows: readonly PlannedTransferRow[],
): Promise<Landed[]> {
  if (!rows.length) return []
  const { model, records } = dataset
  const docs = await getAll(deps.firestore, rows.map((row) => records.doc(row.recordId as string)))
  const batch = deps.firestore.batch()
  const landed: Landed[] = []
  let writes = 0
  rows.forEach((row, at) => {
    const doc = docs[at] as FirebaseFirestore.DocumentSnapshot
    if (!doc.exists) return landed.push(failed(row, 'matchedRecordMissing'))
    const stored = { ...((doc.get('values') ?? {}) as Record<string, unknown>) }
    const before = viewOf(model, doc)
    const { values: changes, cleared } = datasetStorageValues(
      model,
      Object.fromEntries(row.diff.map((change) => [change.fieldId, change.after])),
    )
    const merged: Record<string, unknown> = { ...stored, ...changes }
    for (const fieldId of cleared) delete merged[fieldId]
    const coerced = fillRecordAddresses(model, merged)
    const errors = datasetWriteErrors(model, coerced, new Set([...Object.keys(changes), ...cleared]))
    if (Object.keys(errors).length) return landed.push(failed(row, 'refusedValue', describeDatasetRecordErrors(errors)))
    batch.set(
      doc.ref,
      {
        values: coerced,
        // The merging form: an update that clears the last reference has to
        // REMOVE the index rather than omit it.
        ...datasetIntegrityUpdate(model, coerced, FieldValue.delete()),
        updatedAt: Timestamp.now(),
      },
      // Each named field replaced whole: `merge: true` would fold the new
      // `filterValues` into the stored map and keep a cleared value.
      { mergeFields: RECORD_MERGE_FIELDS },
    )
    writes += 1
    const touched = row.diff.map((change) => change.fieldId)
    const after = datasetRecordTransferValues(model, { values: coerced })
    landed.push({
      result: { row: row.index, outcome: 'updated', recordId: doc.id },
      undo: {
        row: row.index,
        recordId: doc.id,
        action: 'updated',
        previous: only(before, touched),
        written: only(after, touched),
        modes: Object.fromEntries(row.diff.map((change) => [change.fieldId, change.mode])),
      },
    })
    return undefined
  })
  if (writes) await batch.commit()
  return landed
}

/** What became of one new record: written, already there (an earlier attempt's), or past the plan. */
type NewRecordOutcome = 'created' | 'existed' | 'refused'

/** Why a dataset's new records were not written at all. */
interface NewRecordsRefused {
  message: string
}

/**
 * New records written as `/api/orgs/datasets` creates them: the data storage
 * band refusing first, then counted, decided and written in ONE transaction
 * against `recordsPerDataset`, each with the integrity index of its values.
 * A record already there is left as it is. `values` are validated already.
 */
async function writeNewRecords(
  deps: DatasetTransferDeps,
  dataset: LoadedDataset,
  entries: ReadonlyArray<{ id: string; values: Record<string, unknown> }>,
): Promise<{ outcomes: NewRecordOutcome[]; limitMessage: string } | NewRecordsRefused> {
  const { model, records } = dataset
  const org = (await dataset.orgRef.get()).data() as never
  // Bytes, not rows (AGL-2163), before the write as on every other create.
  const storage = await dataStorageRefusal(org, dataset.orgRef)
  if (storage) return { message: `Dataset storage is full (${storage.includedMb} MB on this plan) — upgrade in Billing` }
  const outcomes = await deps.firestore.runTransaction(async (tx) => {
    const refs = entries.map((entry) => records.doc(entry.id))
    const existing = await tx.getAll(...refs)
    const live = Number((await tx.get(records.count())).data().count ?? 0)
    let room = checkQuota(org, 'recordsPerDataset', live).remaining
    let order = live
    return entries.map((entry, at): NewRecordOutcome => {
      if ((existing[at] as FirebaseFirestore.DocumentSnapshot).exists) return 'existed'
      if (room <= 0) return 'refused'
      room -= 1
      tx.create(refs[at] as FirebaseFirestore.DocumentReference, {
        values: entry.values,
        // The integrity index the delete check queries, on the same write as
        // the values it describes.
        ...datasetIntegrityFields(model, entry.values),
        order: order++,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      })
      return 'created'
    })
  })
  const limit = checkQuota(org, 'recordsPerDataset', 0).limit
  return { outcomes, limitMessage: `Record limit reached (${limit}) — upgrade in Billing` }
}

/**
 * Creates, through {@link writeNewRecords}: validated first, so a row the
 * model refuses fails naming why. A row the plan's room has run out for
 * fails as past the plan; a record this job already created (a retried
 * chunk) is reported, not written again.
 */
async function applyCreates(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  dataset: LoadedDataset,
  rows: readonly PlannedTransferRow[],
): Promise<Landed[]> {
  if (!rows.length) return []
  const { model } = dataset
  const landed: Landed[] = []
  const prepared: Array<{ row: PlannedTransferRow; id: string; values: Record<string, unknown> }> = []
  for (const row of rows) {
    const { values } = datasetStorageValues(
      model,
      Object.fromEntries(row.diff.map((change) => [change.fieldId, change.after])),
    )
    const coerced = fillRecordAddresses(model, values)
    const errors = datasetWriteErrors(model, coerced)
    if (Object.keys(errors).length) landed.push(failed(row, 'refusedValue', describeDatasetRecordErrors(errors)))
    else prepared.push({ row, id: transferRecordId(ctx.jobId ?? ctx.resource, row.index), values: coerced })
  }
  if (!prepared.length) return landed
  const written = await writeNewRecords(deps, dataset, prepared)
  if ('message' in written) return [...landed, ...prepared.map((entry) => failed(entry.row, 'planLimit', written.message))]
  prepared.forEach((entry, at) => {
    if (written.outcomes[at] === 'refused') {
      landed.push(failed(entry.row, 'planLimit', written.limitMessage))
      return
    }
    const values = datasetRecordTransferValues(model, { values: entry.values })
    delete values[TRANSFER_ID_FIELD]
    landed.push({
      result: { row: entry.row.index, outcome: 'created', recordId: entry.id },
      undo: { row: entry.row.index, recordId: entry.id, action: 'created', written: values },
    })
  })
  return landed
}

/*------------------------------------------
 * References the person chose to create
 *-----------------------------------------*/

/**
 * The id a record created for a reference's name is given: ten characters
 * of the resource-id alphabet, from the job, the target, the field it is
 * named in and the name as the engine keys it — so every row naming it, in
 * any chunk, and a retried chunk all land on the one record.
 */
export function transferReferenceRecordId(jobId: string, datasetId: string, displayFieldId: string, name: string): string {
  return transferRecordId(`${jobId}:${datasetId}:${displayFieldId}:${transferLookupKey(name)}`, 0)
}

/** The names a reference value asks to create, by the engine's marker. */
function namesToCreate(value: unknown): string[] {
  const names: string[] = []
  for (const item of Array.isArray(value) ? value : [value]) {
    const name = transferLookupNewName(item)
    if (name) names.push(name)
  }
  return names
}

/** A reference field with a target and the field it names records by. */
interface NamedReference {
  transferId: string
  targetId: string
  displayFieldId: string
}

function namedReferences(model: DatasetModel): NamedReference[] {
  const out: NamedReference[] = []
  for (const fieldId of model.order ?? []) {
    const field = model.fields?.[fieldId] as DatasetFieldDefinition | undefined
    const targetId = field?.type === 'reference' ? field.reference?.datasetId : undefined
    const displayFieldId = field?.reference?.displayFieldId
    if (targetId && displayFieldId) out.push({ transferId: datasetTransferFieldId(fieldId), targetId, displayFieldId })
  }
  return out
}

/**
 * The records the person chose to create from a reference's names, created
 * in the referenced dataset before the rows that name them are written: each
 * name once, holding the name in the field the reference displays, held to
 * the target's model and its plan, through {@link writeNewRecords}. The rows
 * come back naming the records' ids; a row naming one that could not be
 * created fails, saying why.
 */
async function createNamedReferences(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  dataset: LoadedDataset,
  rows: readonly PlannedTransferRow[],
): Promise<{ rows: PlannedTransferRow[]; failed: Landed[] }> {
  const references = namedReferences(dataset.model)
  // Target and display field → name key → the name as the file spelled it.
  const wanted = new Map<string, { reference: NamedReference; names: Map<string, string> }>()
  for (const row of rows) {
    for (const change of row.diff) {
      const reference = references.find((one) => one.transferId === change.fieldId)
      const names = reference ? namesToCreate(change.after) : []
      if (!reference || !names.length) continue
      const at = `${reference.targetId}\u0000${reference.displayFieldId}`
      const group = wanted.get(at) ?? { reference, names: new Map<string, string>() }
      for (const name of names) if (!group.names.has(transferLookupKey(name))) group.names.set(transferLookupKey(name), name)
      wanted.set(at, group)
    }
  }
  if (!wanted.size) return { rows: [...rows], failed: [] }

  // Name key → the record's id, or why it could not be created; per target and display field.
  const outcome = new Map<string, Map<string, { id: string } | { message: string }>>()
  const jobId = ctx.jobId ?? ctx.resource
  for (const [at, { reference, names }] of wanted) {
    const decided = new Map<string, { id: string } | { message: string }>()
    outcome.set(at, decided)
    const target = await datasetFor(deps, targetContext(ctx, reference.targetId))
    await ensureDeclaredCustomFieldTypes(target.model)
    const entries: Array<{ key: string; id: string; values: Record<string, unknown> }> = []
    for (const [key, name] of names) {
      const values = fillRecordAddresses(target.model, datasetStorageValues(target.model, { [datasetTransferFieldId(reference.displayFieldId)]: name }).values)
      const errors = datasetWriteErrors(target.model, values)
      if (Object.keys(errors).length) {
        decided.set(key, { message: `“${name}” could not be created in ${target.label}: ${describeDatasetRecordErrors(errors)}` })
      } else {
        entries.push({ key, id: transferReferenceRecordId(jobId, target.id, reference.displayFieldId, name), values })
      }
    }
    if (!entries.length) continue
    const written = await writeNewRecords(deps, target, entries)
    entries.forEach((entry, index) => {
      const name = names.get(entry.key) as string
      if ('message' in written) decided.set(entry.key, { message: `“${name}” could not be created in ${target.label}: ${written.message}` })
      else if (written.outcomes[index] === 'refused') {
        decided.set(entry.key, { message: `“${name}” could not be created in ${target.label}: ${written.limitMessage}` })
      } else decided.set(entry.key, { id: entry.id })
    })
    if (!('message' in written) && written.outcomes.includes('created')) {
      await announceDatasetRecords({ firestore: deps.firestore, orgId: ctx.orgId, datasetId: target.id })
    }
  }

  const out: PlannedTransferRow[] = []
  const refused: Landed[] = []
  for (const row of rows) {
    const problems: string[] = []
    const diff = row.diff.map((change) => {
      const reference = references.find((one) => one.transferId === change.fieldId)
      if (!reference || !namesToCreate(change.after).length) return change
      const decided = outcome.get(`${reference.targetId}\u0000${reference.displayFieldId}`)
      const idOf = (item: unknown): unknown => {
        const name = transferLookupNewName(item)
        if (!name) return item
        const one = decided?.get(transferLookupKey(name))
        if (one && 'id' in one) return one.id
        problems.push(one && 'message' in one ? one.message : `“${name}” could not be created.`)
        return item
      }
      return { ...change, after: Array.isArray(change.after) ? [...new Set(change.after.map(idOf))] : idOf(change.after) }
    })
    if (problems.length) refused.push(failed(row, 'refusedValue', [...new Set(problems)].join(' ')))
    else out.push({ ...row, diff })
  }
  return { rows: out, failed: refused }
}

export async function applyDatasetChunk(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  chunk: { rows: PlannedTransferRow[] },
  writer: TransferApplyWriter,
): Promise<TransferApplyResult> {
  const dataset = await datasetFor(deps, ctx)
  // A plugin's field validator runs only once its plugin registered it.
  await ensureDeclaredCustomFieldTypes(dataset.model)
  const results: TransferRowResult[] = []
  const undo: TransferUndoEntry[] = []
  const pending: PlannedTransferRow[] = []
  for (const row of chunk.rows) {
    const done = await writer.alreadyApplied(row.index)
    if (done) results.push(done)
    else pending.push(row)
  }
  // The records the rows' references name for creation, before the rows.
  const named = await createNamedReferences(deps, ctx, dataset, pending)
  const landed = [
    ...named.failed,
    ...(await applyUpdates(deps, dataset, named.rows.filter((row) => row.verdict === 'update' && row.recordId))),
    ...(await applyCreates(deps, ctx, dataset, named.rows.filter((row) => row.verdict === 'create'))),
  ]
  for (const entry of landed) {
    await writer.markApplied(entry.result, entry.undo)
    results.push(entry.result)
    if (entry.undo) undo.push(entry.undo)
  }
  // The pages repeating over the dataset, told once for the chunk (AGL-3113).
  if (undo.length) {
    await announceDatasetRecords({ firestore: deps.firestore, orgId: ctx.orgId, datasetId: dataset.id })
  }
  return { results, undo }
}

/*------------------------------------------
 * Undo
 *-----------------------------------------*/

/**
 * Deletes a record the import created, keeping every reference to it whole
 * (see the block header). `false` when a `restrict` reference holds it.
 */
async function deleteWithIntegrity(
  deps: DatasetTransferDeps,
  dataset: LoadedDataset,
  recordId: string,
): Promise<boolean> {
  const others = await dataset.orgRef.collection('datasets').get()
  const strips: Array<() => void> = []
  const batch = deps.firestore.batch()
  for (const other of others.docs) {
    const model = effectiveDatasetModel(other.data() as { model?: DatasetModel; fields?: string[] })
    const referencing = Object.keys(model.fields ?? {}).filter(
      (fieldId) => model.fields[fieldId]?.type === 'reference' && model.fields[fieldId]?.reference?.datasetId === dataset.id,
    )
    if (!referencing.length) continue
    const holders = (
      await other.ref.collection('records').where('referencedIds', 'array-contains', recordId).get()
    ).docs.filter((doc) =>
      referencing.some((fieldId) => {
        const stored = ((doc.get('values') ?? {}) as Record<string, unknown>)[fieldId]
        return Array.isArray(stored) ? stored.includes(recordId) : stored === recordId
      }),
    )
    if (!holders.length) continue
    if (referencing.some((fieldId) => model.fields[fieldId]?.reference?.onDelete === 'restrict')) return false
    for (const holder of holders) {
      strips.push(() => {
        const values = { ...((holder.get('values') ?? {}) as Record<string, unknown>) }
        for (const fieldId of referencing) {
          const stored = values[fieldId]
          if (Array.isArray(stored)) values[fieldId] = stored.filter((id) => id !== recordId)
          else if (stored === recordId) delete values[fieldId]
        }
        batch.update(holder.ref, {
          values,
          ...datasetIntegrityUpdate(model, values, FieldValue.delete()),
          updatedAt: Timestamp.now(),
        })
      })
    }
  }
  for (const strip of strips) strip()
  batch.delete(dataset.records.doc(recordId))
  await batch.commit()
  return true
}

export async function revertDatasetChunk(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  snapshot: { entries: TransferUndoEntry[] },
  decisions: TransferRevertDecisions = {},
): Promise<TransferRevertResult> {
  const dataset = await datasetFor(deps, ctx)
  const { model, records } = dataset
  const done: TransferUndoStep[] = []
  const conflicts: TransferUndoStep[] = []
  if (!snapshot.entries.length) return { done, conflicts }
  const docs = await getAll(deps.firestore, snapshot.entries.map((entry) => records.doc(entry.recordId)))
  const restores = deps.firestore.batch()
  let restoring = 0
  for (const [at, entry] of snapshot.entries.entries()) {
    const doc = docs[at] as FirebaseFirestore.DocumentSnapshot
    const step = planTransferUndo(entry, doc.exists ? viewOf(model, doc) : null)
    const revert = step.action !== 'conflict' || decisions[entry.recordId] === 'revert'
    if (!revert) {
      conflicts.push(step)
      continue
    }
    if (step.action === 'nothing') {
      done.push(step)
      continue
    }
    if (step.action === 'delete' || (step.action === 'conflict' && entry.action === 'created')) {
      if (await deleteWithIntegrity(deps, dataset, entry.recordId)) done.push({ action: 'delete', recordId: entry.recordId })
      else conflicts.push(step)
      continue
    }
    // Restore (or a conflict the person chose to revert): the fields the
    // import wrote, back to what they held before it.
    const stored = { ...((doc.get('values') ?? {}) as Record<string, unknown>) }
    const { values, cleared } = datasetStorageValues(model, step.values)
    const merged: Record<string, unknown> = { ...stored, ...values }
    for (const fieldId of cleared) delete merged[fieldId]
    restores.set(
      doc.ref,
      {
        values: merged,
        ...datasetIntegrityUpdate(model, merged, FieldValue.delete()),
        updatedAt: Timestamp.now(),
      },
      { mergeFields: RECORD_MERGE_FIELDS },
    )
    restoring += 1
    done.push({ action: 'restore', recordId: entry.recordId, values: step.values })
  }
  if (restoring) await restores.commit()
  if (done.some((step) => step.action !== 'nothing')) {
    await announceDatasetRecords({ firestore: deps.firestore, orgId: ctx.orgId, datasetId: dataset.id })
  }
  return { done, conflicts }
}

/*------------------------------------------
 * The hooks
 *-----------------------------------------*/

/** The records hooks for `data.dataset`, over `deps` (the Admin SDK's Firestore by default). */
export function datasetTransferHooks(deps: () => DatasetTransferDeps = productionDeps): TransferRecordsHooks {
  return {
    fields: async (ctx) => {
      const dataset = await datasetFor(deps(), ctx)
      return datasetTransferCatalog(dataset.model, dataset.label, await datasetReferenceTargets(deps(), ctx, dataset.model))
    },
    matchKeys: async (ctx) => datasetMatchKeyOffer((await datasetFor(deps(), ctx)).model),
    count: (ctx, options) => countDatasetRecords(deps(), ctx, options),
    readPage: (ctx, cursor, fieldIds, options) => readDatasetPage(deps(), ctx, cursor, fieldIds, options),
    lookup: (ctx, requests) => lookupDatasetRecords(deps(), ctx, requests),
    suggest: (ctx, request) => suggestDatasetRecords(deps(), ctx, request),
    picklists: (ctx, picklistIds) => datasetPicklists(deps(), ctx, picklistIds),
    addPicklistValues: (ctx, picklistId, values) => addDatasetOptions(deps(), ctx, picklistId, values),
    plan: async (ctx, input) => {
      const dataset = await datasetFor(deps(), ctx)
      await ensureDeclaredCustomFieldTypes(dataset.model)
      const plan = refuseInvalidDatasetRows(dataset.model, buildTransferPlan(input), input.existing)
      return limitDatasetCreates(plan, (await createLimits(dataset)).maxCreates)
    },
    apply: (ctx, chunk, writer) => applyDatasetChunk(deps(), ctx, chunk, writer),
    revert: (ctx, snapshot, decisions) => revertDatasetChunk(deps(), ctx, snapshot, decisions),
  }
}
