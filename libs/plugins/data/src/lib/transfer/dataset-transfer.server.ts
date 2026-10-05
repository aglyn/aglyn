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
  transferResourceInstanceOf,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferPlanLimits,
  type TransferPlanRow,
  type TransferRowNote,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { PicklistValue } from '@aglyn/aglyn/app-utils/picklists'
import type {
  TransferApplyResult,
  TransferApplyWriter,
  TransferLookupResult,
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
  datasetFilterTextKey,
  datasetFilterValuePath,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  effectiveDatasetModel,
  type DatasetModel,
} from '../model/dataset-models'
import { datasetDisplayName, describeDatasetRecordErrors } from '../model/datasets'
import { fillRecordAddresses } from '../record-pages/record-pages'
import { announceDatasetRecords } from '../server/announce-dataset-records'
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
  limitDatasetCreates,
  refuseInvalidDatasetRows,
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
 * Each reference cell as the id of the record it names: by its id, or by the
 * target dataset's display field. A value that names no record — or more
 * than one — refuses its row with an `unresolvedLookup` note, so no write
 * leaves a reference pointing at nothing.
 */
async function resolveReferences(
  deps: DatasetTransferDeps,
  dataset: LoadedDataset,
  rows: readonly TransferPlanRow[],
): Promise<TransferPlanRow[]> {
  const out = rows.map((row) => ({ ...row, values: { ...row.values }, notes: [...(row.notes ?? [])] }))
  for (const fieldId of dataset.model.order ?? []) {
    const field = dataset.model.fields?.[fieldId]
    const targetId = field?.type === 'reference' ? field.reference?.datasetId : undefined
    if (!field || !targetId) continue
    const transferId = datasetTransferFieldId(fieldId)
    const cells = (value: unknown): string[] =>
      (Array.isArray(value) ? value : [value]).map((one) => (one == null ? '' : String(one).trim())).filter(Boolean)
    const wanted = [...new Set(out.flatMap((row) => cells(row.values[transferId])))]
    if (!wanted.length) continue

    const target = dataset.orgRef.collection('datasets').doc(targetId)
    const targetSnapshot = await target.get()
    const targetData = (targetSnapshot.data() ?? {}) as Record<string, unknown>
    const targetName = datasetDisplayName(targetData) || 'the referenced dataset'
    const targetModel = effectiveDatasetModel(targetData as { model?: DatasetModel; fields?: string[] })
    const resolved = new Map<string, string | null>()
    if (targetSnapshot.exists) {
      const docs = await getAll(deps.firestore, wanted.map((id) => target.collection('records').doc(id)))
      for (const doc of docs) if (doc.exists) resolved.set(doc.id, doc.id)
      const display = field.reference?.displayFieldId
      const path = display && targetModel.fields?.[display]?.type === 'text' ? datasetFilterValuePath(display) : null
      const byName = wanted.filter((value) => !resolved.has(value))
      if (path && display && byName.length) {
        const keys = new Map<string, string[]>()
        for (const value of byName) {
          const key = datasetFilterTextKey(value)
          keys.set(key, [...(keys.get(key) ?? []), value])
        }
        const found = new Map<string, string[]>()
        for (const slice of chunked([...keys.keys()], IN_MAX)) {
          for (const doc of (await target.collection('records').where(path, 'in', slice).get()).docs) {
            const name = String(((doc.get('values') ?? {}) as Record<string, unknown>)[display] ?? '').trim().toLowerCase()
            found.set(name, [...(found.get(name) ?? []), doc.id])
          }
        }
        for (const value of byName) {
          const ids = found.get(value.toLowerCase()) ?? []
          resolved.set(value, ids.length === 1 ? (ids[0] as string) : null)
        }
      }
    }
    for (const row of out) {
      const raw = row.values[transferId]
      const list = cells(raw)
      if (!list.length) continue
      const ids: string[] = []
      for (const value of list) {
        const id = resolved.get(value)
        if (id) ids.push(id)
        else {
          const note: TransferRowNote = {
            class: 'unresolvedLookup',
            fieldId: transferId,
            value,
            refuse: true,
            detail: `No single record of “${targetName}” has this ID or name`,
          }
          row.notes.push(note)
        }
      }
      row.values[transferId] = Array.isArray(raw) ? ids : (ids[0] ?? null)
    }
  }
  return out.map((row) => (row.notes.length ? row : { ...row, notes: undefined }))
}

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

/**
 * Creates, as `/api/orgs/datasets` creates: validated, then counted, decided
 * and written in one transaction against `recordsPerDataset`. A row the
 * plan's room has run out for fails as past the plan; a record this job
 * already created (a retried chunk) is reported, not written again.
 */
async function applyCreates(
  deps: DatasetTransferDeps,
  ctx: TransferResourceContext,
  dataset: LoadedDataset,
  rows: readonly PlannedTransferRow[],
): Promise<Landed[]> {
  if (!rows.length) return []
  const { model, records } = dataset
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
  const org = (await dataset.orgRef.get()).data() as never
  // Bytes, not rows (AGL-2163), before the write as on every other create.
  const storage = await dataStorageRefusal(org, dataset.orgRef)
  if (storage) {
    const message = `Dataset storage is full (${storage.includedMb} MB on this plan) — upgrade in Billing`
    return [...landed, ...prepared.map((entry) => failed(entry.row, 'planLimit', message))]
  }
  const outcomes = await deps.firestore.runTransaction(async (tx) => {
    const refs = prepared.map((entry) => records.doc(entry.id))
    const existing = await tx.getAll(...refs)
    const live = Number((await tx.get(records.count())).data().count ?? 0)
    let room = checkQuota(org, 'recordsPerDataset', live).remaining
    let order = live
    return prepared.map((entry, at): 'created' | 'existed' | 'refused' => {
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
  prepared.forEach((entry, at) => {
    if (outcomes[at] === 'refused') {
      landed.push(failed(entry.row, 'planLimit', `Record limit reached (${limit}) — upgrade in Billing`))
      return
    }
    const written = datasetRecordTransferValues(model, { values: entry.values })
    delete written[TRANSFER_ID_FIELD]
    landed.push({
      result: { row: entry.row.index, outcome: 'created', recordId: entry.id },
      undo: { row: entry.row.index, recordId: entry.id, action: 'created', written },
    })
  })
  return landed
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
  const landed = [
    ...(await applyUpdates(deps, dataset, pending.filter((row) => row.verdict === 'update' && row.recordId))),
    ...(await applyCreates(deps, ctx, dataset, pending.filter((row) => row.verdict === 'create'))),
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
      return datasetTransferCatalog(dataset.model, dataset.label)
    },
    matchKeys: async (ctx) => datasetMatchKeyOffer((await datasetFor(deps(), ctx)).model),
    count: (ctx, options) => countDatasetRecords(deps(), ctx, options),
    readPage: (ctx, cursor, fieldIds, options) => readDatasetPage(deps(), ctx, cursor, fieldIds, options),
    lookup: (ctx, requests) => lookupDatasetRecords(deps(), ctx, requests),
    picklists: (ctx, picklistIds) => datasetPicklists(deps(), ctx, picklistIds),
    addPicklistValues: (ctx, picklistId, values) => addDatasetOptions(deps(), ctx, picklistId, values),
    plan: async (ctx, input) => {
      const dataset = await datasetFor(deps(), ctx)
      await ensureDeclaredCustomFieldTypes(dataset.model)
      const rows = await resolveReferences(deps(), dataset, input.rows)
      const plan = refuseInvalidDatasetRows(dataset.model, buildTransferPlan({ ...input, rows }), input.existing)
      return limitDatasetCreates(plan, (await createLimits(dataset)).maxCreates)
    },
    apply: (ctx, chunk, writer) => applyDatasetChunk(deps(), ctx, chunk, writer),
    revert: (ctx, snapshot, decisions) => revertDatasetChunk(deps(), ctx, snapshot, decisions),
  }
}
