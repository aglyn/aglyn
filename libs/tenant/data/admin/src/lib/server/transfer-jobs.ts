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

/*==========================================
 * THE TRANSFER JOB ENGINE (AGL-3524) — an import as a durable job.
 *
 * The core (`@aglyn/aglyn/data-transfer`) says what a file means and what
 * each row would do; the resource's plugin (`plugin-transfer-resources.ts`)
 * reads and writes its own records. This module is everything between: the
 * stored file, the job document and its subcollections, the dry run over
 * every row, the chunked and idempotent apply, the result file and the
 * seven-day undo. The console's `/api/transfer/*` routes are wiring over it,
 * and the cron sweep resumes what a closed tab left behind.
 *
 * ## Where things are
 *
 *   orgs/{orgId}/transferJobs/{jobId}            the job (`TransferJobRecord`)
 *     chunks/{n}                                 the dry run, 200 rows a chunk
 *     ledger/{jobId}:{row}                       a row's write, recorded the moment it lands
 *     results/{n}                                a written chunk's per-row results
 *     undo/{n}                                   a written chunk's undo entries
 *   Storage orgs/{orgId}/transfers/{jobId}/source   the file, inspected before it is stored
 *
 * The engine never writes a resource's record itself. A row reaches its
 * store only through the plugin's `apply` and `revert`, on the plugin's
 * own write paths, so what a record write must derive is derived there:
 * a dataset record's `datasetIntegrityFields` / `datasetIntegrityUpdate`
 * (referenced ids and filter fields) by the data plugin, as on every other
 * path that writes `records`. The `'records'` and `values` in this file are
 * the transfer kind and planned rows in the job's own subcollections.
 *
 * Every document is written with the Admin SDK only; the rules let members
 * holding `data.manage` read the job and nobody write anything.
 *
 * ## Applying never writes a row twice
 *
 * The plugin's `apply` is handed a writer whose `markApplied` creates the
 * row's ledger document the moment its write lands, and whose
 * `alreadyApplied` answers from that ledger — so a chunk retried after a
 * crash, a timeout or a second driver skips every row it already wrote. A
 * chunk is complete when every planned write has a ledger entry; then its
 * results, its undo entries and the job's cursor commit in ONE batch, and
 * only after that are its ledger entries cleared.
 *
 * One driver at a time: a request takes a lease on the job for its time
 * budget, and a second request (a second tab, the sweep) is refused while it
 * holds. One running import per resource per workspace: starting one while
 * another of the same resource is `applying` is refused.
 *
 * ## Undo asks before it overwrites a later edit
 *
 * Undo is two calls. `planTransferJobUndo` reads every record the import
 * touched and runs the core's `planTransferUndo` — restore, delete, nothing,
 * or a conflict for a record edited since — and writes nothing.
 * `applyTransferJobUndo` hands each chunk's snapshot to the plugin's
 * `revert` with the person's decision for every record, chunk by chunk.
 *=========================================*/

import {
  TRANSFER_DEFAULT_MAX_ROWS,
  TRANSFER_DRAFT_RETENTION_MS,
  TRANSFER_ID_FIELD,
  TRANSFER_PLAN_CONFLICTS_MAX,
  TRANSFER_PLAN_PAGE_MAX,
  TRANSFER_RESULT_COLUMNS,
  TRANSFER_UNDO_PAGE_MAX,
  TRANSFER_UPLOAD_MAX_BYTES,
  TRANSFER_UPLOAD_MAX_PARTS,
  TRANSFER_UPLOAD_PART_MAX_BYTES,
  TRANSFER_WRITE_CONCURRENCY,
  canApplyTransferPlan,
  collectPicklistValues,
  createTransferPolicy,
  deriveTransferCell,
  deriveTransferRow,
  mapTransferRow,
  mappingIsUsable,
  mappingProblems,
  matchHeaders,
  matchLookupRequests,
  matchPicklistValues,
  matchRows,
  missingAcknowledgements,
  picklistChoiceProblems,
  planTransferUndo,
  proposePicklistChoice,
  readTransferSource,
  resolveMultiPicklistCell,
  resolvePicklistCell,
  resolvePicklistChoices,
  sniffTransferFormat,
  summarizeMatches,
  summarizeTransferDerivations,
  summarizeTransferResults,
  transferAmbiguities,
  transferCellText,
  transferChunkRanges,
  transferContentType,
  transferDateOrderOptions,
  transferFormatFromFileName,
  transferLedgerKey,
  transferMatchReview,
  transferMatchedRecordIds,
  transferPlanConflicts,
  transferPlanSample,
  transferPolicyProblems,
  transferRowLabel,
  transferUndoAvailable,
  transferUndoExpiresAt,
  transitionTransferJob,
  transferLookupKey,
  transferLookupNewValue,
  mayBeTransferRecordId,
  normalizeMatchValue,
  matchLookupKey,
  isBlankTransferValue,
  TRANSFER_UNDO_WINDOW_MS,
  type MatchKeySpec,
  type MatchLookupRequest,
  type PicklistResolution,
  type PicklistValueChoice,
  type PlannedTransferRow,
  type RowMatchOutcome,
  type TransferAnalyzeResponse,
  type TransferChunkRange,
  type TransferCsvDelimiter,
  type TransferDateOrder,
  type TransferErrorCode,
  type TransferField,
  type TransferFormat,
  type TransferJobRecord,
  type TransferJobRetention,
  type TransferLookupChoice,
  type TransferLookupReview,
  type TransferLookupSuggestion,
  type TransferPicklistAnalysis,
  type TransferPlanChoices,
  type TransferPlanInvariantFailure,
  type TransferPlanResponse,
  type TransferPlanRow,
  type TransferPlanRowsPage,
  type TransferProgress,
  type TransferResourceInfo,
  type TransferResultSummary,
  type TransferRowNote,
  type TransferRowResult,
  type TransferRowVerdict,
  type TransferSourceOptions,
  type TransferSourceTable,
  type TransferUndoConflict,
  type TransferUndoCounts,
  type TransferUndoDecision,
  type TransferUndoEntry,
  type TransferUndoPlanResponse,
  type TransferUndoSnapshot,
  type TransferUndoState,
  type TransferWarningClass,
} from '@aglyn/aglyn/data-transfer'
import {
  normalizePicklistLabel,
  picklistLabelKey,
  type PicklistValue,
} from '@aglyn/aglyn/app-utils/picklists'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { inspectUploadBytes } from '@aglyn/aglyn/app-utils/upload-inspection'
import {
  planTransferResourceRows,
  resolveTransferResource,
  transferInvariantFailures,
  transferRecordsHooks,
  transferResourceCatalog,
  transferResourceLockedRules,
  transferResourceMatchKeys,
  TransferResourceUnavailableError,
  type ResolvedTransferResource,
  type TransferApplyWriter,
  type TransferLookupTargetHooks,
  type TransferPicklistList,
  type TransferRecordsHooks,
  type TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'

/*==========================================
 * DEPENDENCIES AND ERRORS
 *=========================================*/

/** The one Storage object operation set the engine uses. */
export interface TransferBucketFile {
  save(data: Buffer, options?: { contentType?: string; resumable?: boolean }): Promise<unknown>
  download(): Promise<[Buffer]>
  delete(options?: { ignoreNotFound?: boolean }): Promise<unknown>
}

/** The bucket the files are stored in (the Admin SDK's default bucket in production). */
export interface TransferBucket {
  file(path: string): TransferBucketFile
}

/** What the engine runs against; a spec hands it doubles. */
export interface TransferEngineDeps {
  firestore: FirebaseFirestore.Firestore
  bucket: TransferBucket
  /** Defaults to `resolveTransferResource`. */
  resolveResource?: (key: string) => Promise<ResolvedTransferResource>
  /** Defaults to `Date.now`. */
  now?: () => number
  /** Defaults to `createResourceUid()`, the id every console resource carries. */
  newJobId?: () => string
}

/** A refusal a route answers as `{ error, code, details }` with `status`. */
export class TransferEngineError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'TransferEngineError'
  }
}

/** The collection an organization's jobs live in. */
export const TRANSFER_JOBS_COLLECTION = 'transferJobs'

/** How long a driver's lease outlives its budget, so a crashed request's job is resumed soon after. */
export const TRANSFER_LEASE_GRACE_MS = 30_000

/** How long an `applying` job sits untouched before the sweep resumes it. */
export const TRANSFER_STALE_MS = 2 * 60 * 1000

/** Below this much budget, a request stops rather than starting another chunk. */
export const TRANSFER_MIN_CHUNK_BUDGET_MS = 2_000

/** The most ids one undo lookup asks for. */
const UNDO_LOOKUP_SLICE = 500

/** The most values one match lookup request carries. */
const MATCH_LOOKUP_SLICE = 500

/** The most characters of JSON one document holds before it is split into pieces. */
const JSON_PIECE_CHARS = 900_000

/** Where an organization's jobs are. */
export function transferJobsCollection(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.CollectionReference {
  return firestore.collection('orgs').doc(orgId).collection(TRANSFER_JOBS_COLLECTION)
}

/** Where a job's file is stored. */
export function transferSourcePath(orgId: string, jobId: string): string {
  return `orgs/${orgId}/transfers/${jobId}/source`
}

/** Where one part of a file sent in parts waits until the rest arrives. */
export function transferPartPath(orgId: string, jobId: string, part: number): string {
  return `orgs/${orgId}/transfers/${jobId}/parts/${part}`
}

const clock = (deps: TransferEngineDeps) => (deps.now ?? Date.now)()

/** A value as Firestore can store it: no `undefined`, no class instances. */
function stored<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function emptyResults(): TransferResultSummary {
  return { created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0, total: 0 }
}

function emptyUndoCounts(): TransferUndoCounts {
  return { restore: 0, delete: 0, conflict: 0, nothing: 0 }
}

/** `fn` over `items`, at most `limit` at once. */
async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next] as T
      next += 1
      await fn(item)
    }
  })
  await Promise.all(workers)
}

function isAlreadyExists(error: unknown): boolean {
  const failure = error as { code?: unknown; message?: unknown } | null
  return failure?.code === 6 || /ALREADY_EXISTS/i.test(String(failure?.message ?? ''))
}

/*------------------------------------------
 * JSON documents that may outgrow one document
 *-----------------------------------------*/

/**
 * Writes `value` as JSON on `ref` beside `fields`. JSON, because a plan row
 * holds whatever the file held — a nested list from a JSON file is a value
 * Firestore refuses — and past {@link JSON_PIECE_CHARS} the text goes into
 * `pieces/{k}` documents, so a chunk of long notes is never refused for size.
 */
async function writeJsonDoc(
  ref: FirebaseFirestore.DocumentReference,
  fields: Record<string, unknown>,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value)
  if (json.length <= JSON_PIECE_CHARS) {
    await ref.set(stored({ ...fields, json }))
    return
  }
  const pieces: string[] = []
  for (let at = 0; at < json.length; at += JSON_PIECE_CHARS) pieces.push(json.slice(at, at + JSON_PIECE_CHARS))
  await eachLimited(
    pieces.map((json, index) => ({ json, index })),
    TRANSFER_WRITE_CONCURRENCY,
    async (piece) => {
      await ref.collection('pieces').doc(String(piece.index)).set({ json: piece.json })
    },
  )
  await ref.set(stored({ ...fields, pieces: pieces.length }))
}

/** The value {@link writeJsonDoc} wrote, or `null` when the document is absent. */
async function readJsonDoc<T>(ref: FirebaseFirestore.DocumentReference): Promise<T | null> {
  const snapshot = await ref.get()
  if (!snapshot.exists) return null
  const data = snapshot.data() as { json?: string; pieces?: number }
  if (typeof data.json === 'string') return JSON.parse(data.json) as T
  const count = Number(data.pieces ?? 0)
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    const piece = await ref.collection('pieces').doc(String(index)).get()
    parts.push(String((piece.data() as { json?: string } | undefined)?.json ?? ''))
  }
  return JSON.parse(parts.join('')) as T
}

/** Deletes every document of a collection (and a JSON document's pieces), eight at a time. */
async function clearCollection(collection: FirebaseFirestore.CollectionReference): Promise<void> {
  const snapshot = await collection.get()
  await eachLimited(snapshot.docs, TRANSFER_WRITE_CONCURRENCY, async (doc) => {
    const pieces = await doc.ref.collection('pieces').get()
    for (const piece of pieces.docs) await piece.ref.delete()
    await doc.ref.delete()
  })
}

/*==========================================
 * JOBS
 *=========================================*/

async function readJob(deps: TransferEngineDeps, orgId: string, jobId: string): Promise<TransferJobRecord> {
  if (!jobId || jobId.includes('/')) throw new TransferEngineError('invalid', 400, 'Name the import.')
  const snapshot = await transferJobsCollection(deps.firestore, orgId).doc(jobId).get()
  if (!snapshot.exists) throw new TransferEngineError('notFound', 404, 'No such import.')
  return { ...(snapshot.data() as TransferJobRecord), id: jobId }
}

/**
 * When the sweep may clean a job up, and how (see the sweep below): never
 * while it runs or undoes, nor once trimmed; a job that never wrote expires
 * {@link TRANSFER_DRAFT_RETENTION_MS} after it was last touched; one that
 * wrote is trimmed once its undo window has closed.
 */
export function transferJobRetention(
  job: TransferJobRecord,
): { retention: TransferJobRetention; retainUntil: number } | null {
  if (job.trimmedAt !== undefined || job.status === 'applying' || job.undo?.status === 'running') return null
  const wrote = job.applyStartedAt !== undefined || job.status === 'applied' || job.status === 'undone'
  if (!wrote) return { retention: 'expire', retainUntil: job.updatedAt + TRANSFER_DRAFT_RETENTION_MS }
  return { retention: 'trim', retainUntil: (job.appliedAt ?? job.updatedAt) + TRANSFER_UNDO_WINDOW_MS }
}

/** A job as it is stored: Firestore-safe, with its retention stamped for the sweep's query. */
function storedJob(job: TransferJobRecord): TransferJobRecord {
  const rest: TransferJobRecord = { ...job }
  delete rest.retention
  delete rest.retainUntil
  return stored({ ...rest, ...(transferJobRetention(job) ?? {}) })
}

async function saveJob(deps: TransferEngineDeps, job: TransferJobRecord): Promise<void> {
  await transferJobsCollection(deps.firestore, job.orgId).doc(job.id).set(storedJob(job))
}

/** The job as a route returns it. */
export async function readTransferJob(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string },
): Promise<TransferJobRecord> {
  return readJob(deps, input.orgId, input.jobId)
}

/** A `records` resource, joined to its server half, or the refusal a route answers. */
export async function resolveTransferRecordsResource(
  deps: Pick<TransferEngineDeps, 'resolveResource'>,
  key: string,
): Promise<ResolvedTransferResource> {
  return resolveResource(deps, key)
}

async function resolveResource(deps: Pick<TransferEngineDeps, 'resolveResource'>, key: string): Promise<ResolvedTransferResource> {
  try {
    const resource = await (deps.resolveResource ?? resolveTransferResource)(key)
    if (!resource.kinds.includes('records')) {
      throw new TransferEngineError('invalid', 400, `${resource.label} is moved as a package, not imported as rows.`)
    }
    return resource
  } catch (error) {
    if (error instanceof TransferResourceUnavailableError) {
      throw error.reason === 'undeclared'
        ? new TransferEngineError('notFound', 404, `Nothing called "${key}" can be imported.`)
        : new TransferEngineError('unavailable', 500, 'Importing this is unavailable right now. Try again in a minute.')
    }
    throw error
  }
}

/**
 * The site a transfer concerns: required for a `host` resource; for an
 * `org` resource the site the person named, or `null` — a workspace's
 * records can be read through one site's view of them and imported as
 * that site's captures (the CRM's, AGL-3541), and the gate has already
 * checked `data.manage` on that site.
 */
export function transferHostIdFor(resource: ResolvedTransferResource, hostId: string | null | undefined): string | null {
  const site = typeof hostId === 'string' && hostId.trim() && !hostId.includes('/') ? hostId.trim() : null
  if (resource.scope === 'host' && !site) {
    throw new TransferEngineError('invalid', 400, `${resource.label} belong to a site; name the site.`)
  }
  return site
}

function contextFor(job: TransferJobRecord, actorUid: string | null): TransferResourceContext {
  return {
    resource: job.resource,
    orgId: job.orgId,
    hostId: job.hostId ?? null,
    actorUid,
    jobId: job.id,
    ...(job.extras ? { extras: job.extras } : {}),
    ...(job.headers ? { headers: job.headers } : {}),
  }
}

function moveJob(
  job: TransferJobRecord,
  to: TransferJobRecord['status'],
  now: number,
  patch: Partial<TransferJobRecord> = {},
): TransferJobRecord {
  try {
    return transitionTransferJob(job, to, now, patch) as TransferJobRecord
  } catch {
    throw new TransferEngineError('state', 409, `This import is ${job.status} and cannot be ${to} now.`)
  }
}

/** Where a job stands, for a progress bar. */
export function transferJobProgress(job: TransferJobRecord): TransferProgress {
  return {
    status: job.status,
    chunk: job.cursor?.chunk ?? 0,
    chunkCount: job.chunkCount ?? 0,
    rowsDone: job.cursor?.rowsDone ?? 0,
    rowCount: job.rowCount ?? 0,
    results: job.results ?? emptyResults(),
  }
}

/*==========================================
 * FIELDS — what a resource offers
 *=========================================*/

/**
 * What a resource offers the wizard and the export dialog: its descriptor,
 * every field and group, its match keys (and the ones a person starts with,
 * which the Re-importable preset leads with), the presets' hints and its own
 * presets, its locked rules and aliases. `prefs` is the person's own
 * and is filled by the caller; a custom field cannot be created from here.
 */
export async function readTransferResourceInfo(
  deps: TransferEngineDeps,
  input: { orgId: string; actorUid: string; resource: string; hostId?: string | null },
): Promise<Omit<TransferResourceInfo, 'prefs'>> {
  const resource = await resolveResource(deps, String(input.resource ?? '').trim())
  const ctx: TransferResourceContext = {
    resource: resource.key,
    orgId: input.orgId,
    hostId: transferHostIdFor(resource, input.hostId),
    actorUid: input.actorUid,
  }
  const hooks = transferRecordsHooks(resource)
  const catalog = await transferResourceCatalog(resource, ctx)
  const offer = await transferResourceMatchKeys(resource, ctx)
  const matchKeys = offer.keys
  return {
    resource: {
      key: resource.key,
      label: resource.label,
      ...(resource.singularLabel ? { singularLabel: resource.singularLabel } : {}),
      scope: resource.scope,
      kinds: [...resource.kinds],
      formats: [...resource.formats],
      ...(resource.limits ? { limits: resource.limits } : {}),
      ...(resource.description ? { description: resource.description } : {}),
    },
    fields: catalog.fields,
    groups: catalog.groups,
    matchKeys,
    defaultMatchKeys: offer.defaults,
    presetHints: { matchKeyFieldIds: offer.defaults },
    ...(hooks.presets?.length
      ? {
          resourcePresets: hooks.presets.map((preset) => ({
            ...preset,
            // Only fields the catalog has: a preset never names a column the export would refuse.
            fieldIds: preset.fieldIds.filter((fieldId) => catalog.byId.has(fieldId)),
          })),
        }
      : {}),
    locked: [...(await transferResourceLockedRules(resource, ctx))],
    ...(hooks.aliases?.length ? { dictionaries: [...hooks.aliases] } : {}),
    canCreateCustomField: false,
  }
}

/*==========================================
 * UPLOAD
 *=========================================*/

export interface TransferUploadInput {
  orgId: string
  actorUid: string
  resource: string
  hostId?: string | null
  fileName: string
  format?: TransferFormat
  content: string
  part?: number
  parts?: number
  jobId?: string
  delimiter?: TransferCsvDelimiter
  headerRow?: boolean
}

const CSV_DELIMITERS: readonly TransferCsvDelimiter[] = [',', ';', '\t', '|']

/** How the person said the CSV reads, or nothing for detection to decide. */
function readOptionsOf(input: Pick<TransferUploadInput, 'delimiter' | 'headerRow'>): TransferSourceOptions | undefined {
  const options: TransferSourceOptions = {}
  if (input.delimiter !== undefined) {
    if (!CSV_DELIMITERS.includes(input.delimiter)) throw new TransferEngineError('invalid', 400, 'That separator is not one a CSV can use.')
    options.delimiter = input.delimiter
  }
  if (input.headerRow === false) options.headerRow = false
  return Object.keys(options).length ? options : undefined
}

/**
 * The structure check every stored upload passes (`inspectUploadBytes`):
 * an executable or a test signature named as a CSV is refused before a byte
 * of it is stored. It is a structural check, not an antivirus scan.
 */
function inspectTransferBytes(bytes: Uint8Array, format: TransferFormat, fileName: string): void {
  const refusal = inspectUploadBytes({ bytes, contentType: transferContentType(format), fileName })
  if (refusal) throw new TransferEngineError('rejectedFile', 422, refusal.message, { code: refusal.code })
}

function textOf(bytes: Buffer): string {
  return bytes.toString('utf8')
}

/**
 * Stores a file, or one part of it, and makes the job on the first part.
 * Each part is inspected before it is stored; the whole file is inspected
 * again, read, counted against the resource's limits and stored as the
 * source once the last part lands. A part sent twice is accepted once.
 */
export async function uploadTransferSource(
  deps: TransferEngineDeps,
  input: TransferUploadInput,
): Promise<{ job: TransferJobRecord; complete: boolean }> {
  const resource = await resolveResource(deps, String(input.resource ?? '').trim())
  const hostId = transferHostIdFor(resource, input.hostId)
  const fileName = String(input.fileName ?? '').trim().slice(0, 240) || 'import'
  const content = typeof input.content === 'string' ? input.content : ''
  const format = input.format ?? transferFormatFromFileName(fileName) ?? sniffTransferFormat(content)
  if (!resource.formats.includes(format)) {
    throw new TransferEngineError(
      'unsupportedFormat',
      415,
      `${resource.label} can be imported from ${resource.formats.join(', ').toUpperCase()}, not ${format.toUpperCase()}.`,
    )
  }
  const parts = input.parts ?? 1
  const part = input.part ?? 0
  if (!Number.isInteger(parts) || parts < 1 || parts > TRANSFER_UPLOAD_MAX_PARTS) {
    throw new TransferEngineError('invalid', 400, `A file is sent in 1 to ${TRANSFER_UPLOAD_MAX_PARTS} parts.`)
  }
  if (!Number.isInteger(part) || part < 0 || part >= parts) {
    throw new TransferEngineError('invalid', 400, `Part ${part} is not one of ${parts}.`)
  }
  const bytes = Buffer.from(content, 'utf8')
  if (bytes.length > TRANSFER_UPLOAD_PART_MAX_BYTES) {
    throw new TransferEngineError('tooLarge', 413, 'Send the file in parts of at most 3 MB.')
  }
  const maxBytes = Math.min(resource.limits?.maxBytes ?? TRANSFER_UPLOAD_MAX_BYTES, TRANSFER_UPLOAD_MAX_BYTES)
  inspectTransferBytes(bytes, format, fileName)

  const now = clock(deps)
  const jobs = transferJobsCollection(deps.firestore, input.orgId)
  let job: TransferJobRecord
  if (input.jobId) {
    job = await readJob(deps, input.orgId, input.jobId)
    if (job.status !== 'draft' || job.resource !== resource.key || !job.upload || job.upload.complete) {
      throw new TransferEngineError('state', 409, 'This import is not waiting for a file.')
    }
    if (job.upload.parts !== parts) throw new TransferEngineError('invalid', 400, 'The part count changed.')
    if (job.upload.received.includes(part)) return { job, complete: false }
  } else {
    if (part !== 0) throw new TransferEngineError('invalid', 400, 'Send the first part first.')
    const id = deps.newJobId?.() ?? createResourceUid()
    job = {
      id,
      resource: resource.key,
      kind: 'records',
      direction: 'import',
      format,
      status: 'draft',
      orgId: input.orgId,
      ...(hostId ? { hostId } : {}),
      createdBy: input.actorUid,
      createdAt: now,
      updatedAt: now,
      fileName,
      ...(format === 'csv' && readOptionsOf(input) ? { read: readOptionsOf(input) } : {}),
      upload: { parts, received: [], bytes: 0, complete: false },
    }
  }

  if ((job.upload?.bytes ?? 0) + bytes.length > maxBytes) {
    throw new TransferEngineError('tooLarge', 413, `A file may be at most ${Math.round(maxBytes / 1_000_000)} MB.`)
  }

  let whole: Buffer
  if (parts === 1) {
    whole = bytes
  } else {
    await deps.bucket.file(transferPartPath(input.orgId, job.id, part)).save(bytes, {
      contentType: 'application/octet-stream',
      resumable: false,
    })
    const received = await deps.firestore.runTransaction(async (transaction) => {
      const ref = jobs.doc(job.id)
      const snapshot = await transaction.get(ref)
      const current = snapshot.exists ? ({ ...(snapshot.data() as TransferJobRecord), id: job.id }) : job
      const upload = current.upload ?? { parts, received: [], bytes: 0, complete: false }
      const next: TransferJobRecord = {
        ...current,
        updatedAt: now,
        upload: {
          ...upload,
          received: [...new Set([...upload.received, part])].sort((a, b) => a - b),
          bytes: upload.received.includes(part) ? upload.bytes : upload.bytes + bytes.length,
        },
      }
      transaction.set(ref, storedJob(next))
      return next
    })
    job = received
    if ((job.upload?.received.length ?? 0) < parts) return { job, complete: false }
    const pieces: Buffer[] = []
    for (let index = 0; index < parts; index += 1) {
      const [piece] = await deps.bucket.file(transferPartPath(input.orgId, job.id, index)).download()
      pieces.push(piece)
    }
    whole = Buffer.concat(pieces)
    if (whole.length > maxBytes) {
      throw new TransferEngineError('tooLarge', 413, `A file may be at most ${Math.round(maxBytes / 1_000_000)} MB.`)
    }
    inspectTransferBytes(whole, format, fileName)
  }

  const read = readTransferSource(textOf(whole), format, job.read ?? {})
  if ('problem' in read) {
    await saveJob(deps, moveJob(job, 'failed', now, { error: { code: read.problem.code, message: read.problem.message } }))
    throw new TransferEngineError('invalid', 422, read.problem.message, read.problem)
  }
  const maxRows = resource.limits?.maxRows ?? TRANSFER_DEFAULT_MAX_ROWS
  const rowCount = read.table.rows.length
  if (rowCount > maxRows) {
    const message = `${resource.label} are imported at most ${maxRows.toLocaleString('en-US')} rows at a time; this file has ${rowCount.toLocaleString('en-US')}. Split it and import each part.`
    await saveJob(deps, moveJob(job, 'failed', now, { error: { code: 'tooManyRows', message } }))
    throw new TransferEngineError('tooLarge', 413, message)
  }
  if (!rowCount) throw new TransferEngineError('invalid', 422, 'The file has a header and no rows.')

  const sourcePath = transferSourcePath(input.orgId, job.id)
  await deps.bucket.file(sourcePath).save(whole, { contentType: transferContentType(format), resumable: false })
  if (parts > 1) {
    await eachLimited(
      Array.from({ length: parts }, (_unused, index) => index),
      TRANSFER_WRITE_CONCURRENCY,
      async (index) => {
        await deps.bucket.file(transferPartPath(input.orgId, job.id, index)).delete({ ignoreNotFound: true })
      },
    )
  }
  const done: TransferJobRecord = {
    ...job,
    updatedAt: now,
    sourcePath,
    rowCount,
    chunkCount: transferChunkRanges(rowCount).length,
    headers: read.table.headers,
    upload: { parts, received: Array.from({ length: parts }, (_unused, index) => index), bytes: whole.length, complete: true },
  }
  await saveJob(deps, done)
  return { job: done, complete: true }
}

async function loadTable(deps: TransferEngineDeps, job: TransferJobRecord): Promise<TransferSourceTable> {
  if (!job.sourcePath || !job.upload?.complete) {
    throw new TransferEngineError('state', 409, 'The file has not finished uploading.')
  }
  const [bytes] = await deps.bucket.file(job.sourcePath).download()
  const read = readTransferSource(textOf(bytes), job.format, job.read ?? {})
  if ('problem' in read) throw new TransferEngineError('invalid', 422, read.problem.message, read.problem)
  return read.table
}

/*==========================================
 * ANALYZE
 *=========================================*/

function assertBeforeWrites(job: TransferJobRecord, what: string): void {
  if (job.applyStartedAt !== undefined || job.status === 'applying' || job.status === 'applied' || job.status === 'undone') {
    throw new TransferEngineError('state', 409, `This import has started writing; it cannot be ${what} again.`)
  }
}

function usableMapping(mapping: Readonly<Record<number, string | null | undefined>> | undefined): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [column, fieldId] of Object.entries(mapping ?? {})) {
    if (typeof fieldId === 'string' && fieldId && /^\d+$/.test(column)) out[Number(column)] = fieldId
  }
  return out
}

function isPicklistField(field: TransferField | undefined): field is TransferField & { picklistId: string } {
  return Boolean(field && (field.type === 'picklist' || field.type === 'multiPicklist') && field.picklistId)
}

async function picklistLists(
  hooks: TransferRecordsHooks,
  ctx: TransferResourceContext,
  fields: readonly TransferField[],
): Promise<Readonly<Record<string, TransferPicklistList>>> {
  const ids = [...new Set(fields.filter(isPicklistField).map((field) => field.picklistId))]
  if (!ids.length || !hooks.picklists) return {}
  return hooks.picklists(ctx, ids)
}

/** The picklist values each mapped picklist column carries, matched to the organization's list. */
function analyzePicklistColumns(
  table: TransferSourceTable,
  mapping: Record<number, string>,
  byId: ReadonlyMap<string, TransferField>,
  lists: Readonly<Record<string, TransferPicklistList>>,
): TransferPicklistAnalysis[] {
  const analyses: TransferPicklistAnalysis[] = []
  for (const [column, fieldId] of Object.entries(mapping)) {
    const field = byId.get(fieldId)
    if (!isPicklistField(field)) continue
    const list = lists[field.picklistId]
    if (!list) continue
    const incoming = collectPicklistValues(
      table.rows.map((cells, row) => {
        const derived = deriveTransferCell(field, cells[Number(column)])
        return { row, value: derived.ok ? derived.value : null }
      }),
    )
    const result = matchPicklistValues(list.set, incoming)
    analyses.push({
      fieldId,
      picklistId: field.picklistId,
      spec: list.spec,
      set: list.set,
      matched: result.matched,
      unmatched: result.unmatched,
      proposals: Object.fromEntries(result.unmatched.map((value) => [value.key, proposePicklistChoice(list.spec, value)])),
    })
  }
  return analyses
}

/** Record id → a name for it, for the records `ids` names that `records` holds. */
function recordLabelsFor(
  records: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ids: Iterable<string>,
): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const id of ids) {
    const label = transferRowLabel(records.get(id))
    if (label) labels[id] = label
  }
  return labels
}

export interface AnalyzeTransferInput {
  orgId: string
  jobId: string
  actorUid: string
  mapping?: Record<number, string | null>
  /** Match key field ids, in priority order; the resource's defaults when absent. */
  matchKeys?: string[]
  dateOrders?: Record<string, TransferDateOrder>
}

/**
 * Reads the file and proposes a mapping: every column against the
 * resource's catalog and aliases, with the first rows as samples, and each
 * mapped picklist column's values against the organization's list. With
 * `mapping`, the values are read under that mapping instead of the proposal,
 * and the answer adds what reading every mapped field did over the whole
 * file and how the rows match existing records under `matchKeys`.
 */
export async function analyzeTransferJob(
  deps: TransferEngineDeps,
  input: AnalyzeTransferInput,
): Promise<Omit<TransferAnalyzeResponse, 'ok'>> {
  const job = await readJob(deps, input.orgId, input.jobId)
  assertBeforeWrites(job, 'analyzed')
  const resource = await resolveResource(deps, job.resource)
  const hooks = transferRecordsHooks(resource)
  const ctx = contextFor(job, input.actorUid)
  const table = await loadTable(deps, job)
  const catalog = await transferResourceCatalog(resource, ctx)
  const samples = table.rows.slice(0, 20)
  const match = matchHeaders(table.headers, catalog.fields, {
    dictionaries: hooks.aliases ?? [],
    samples,
  })
  const mapping = input.mapping ? usableMapping(input.mapping) : match.mapping
  const byId = new Map(catalog.fields.map((field) => [field.id, field]))
  const lists = await picklistLists(hooks, ctx, catalog.fields)
  const picklists = analyzePicklistColumns(table, mapping, byId, lists)
  const lockedRules = [...(await transferResourceLockedRules(resource, ctx))]
  const offer = await transferResourceMatchKeys(resource, ctx)

  let review: Pick<TransferAnalyzeResponse, 'derivations' | 'lookups' | 'matches' | 'recordLabels'> = {}
  if (input.mapping) {
    const fieldOptions = transferDateOrderOptions(input.dateOrders)
    const read = table.rows.map((cells, index) => {
      const mapped = mapTransferRow(cells, mapping)
      return { index, cells: mapped, ...deriveTransferRow(byId, mapped, {}, fieldOptions) }
    })
    const mappedFields = [...new Set(Object.values(mapping))]
      .map((fieldId) => byId.get(fieldId))
      .filter((field): field is TransferField => Boolean(field))
    const keys = chosenMatchKeys(offer.keys, input.matchKeys ?? offer.defaults)
    const values = read.map((row) => row.values)
    const found = keys.length
      ? await lookupAll(hooks, ctx, matchLookupRequests(values, keys))
      : { lookup: new Map<string, string[]>(), records: new Map<string, Readonly<Record<string, unknown>>>() }
    const outcomes: RowMatchOutcome[] = matchRows(values, keys, found.lookup)
    const lookups = await lookupReviews(await resolveLookupColumns(deps, hooks, ctx, mapping, byId, read))
    review = {
      derivations: summarizeTransferDerivations(mappedFields, read),
      ...(lookups.length ? { lookups } : {}),
      matches: transferMatchReview(keys, outcomes, values),
      recordLabels: recordLabelsFor(found.records, transferMatchedRecordIds(outcomes)),
    }
  }

  const now = clock(deps)
  const next = moveJob(job, 'analyzed', now, {
    headers: table.headers,
    rowCount: table.rows.length,
    chunkCount: transferChunkRanges(table.rows.length).length,
    mapping,
  })
  await saveJob(deps, next)
  return {
    job: next,
    headers: table.headers,
    rowCount: table.rows.length,
    samples: samples.map((cells) => cells.map(transferCellText)),
    catalog,
    match,
    mappingProblems: mappingProblems(mapping, catalog.fields),
    matchKeys: offer.keys,
    lockedRules,
    picklists,
    ...review,
  }
}

/*==========================================
 * LOOKUPS — cells that name another record (AGL-3541)
 *=========================================*/

/** The most suggestions one unresolved value carries. */
const LOOKUP_SUGGESTIONS_MAX = 5

/** The most rows one unresolved value lists. */
const LOOKUP_ROWS_MAX = 20

function isLookupField(field: TransferField | undefined): field is TransferField & { lookup: NonNullable<TransferField['lookup']> } {
  return Boolean(field && field.type === 'lookup' && field.lookup?.resource && field.lookup.by?.length)
}

/** Who answers a lookup field's target, and the context it is asked in. */
interface LookupTarget {
  hooks: TransferLookupTargetHooks
  ctx: TransferResourceContext
}

/**
 * The target of a lookup field: one the resource answers itself
 * (`lookupTargets`), or the declared resource it names, asked as that
 * resource in the same workspace and site.
 */
async function lookupTargetFor(
  deps: TransferEngineDeps,
  hooks: TransferRecordsHooks,
  ctx: TransferResourceContext,
  key: string,
): Promise<LookupTarget> {
  const own = hooks.lookupTargets?.[key]
  if (own) return { hooks: own, ctx }
  const target = await resolveResource(deps, key)
  const targetCtx = { ...ctx, resource: target.key }
  // The target's keys as they stand for it — read for the context when
  // they depend on it (one dataset's own fields).
  const { keys } = await transferResourceMatchKeys(target, targetCtx)
  return { hooks: { ...transferRecordsHooks(target), matchKeys: keys }, ctx: targetCtx }
}

/** One distinct value of a lookup column, as the file spelled it, and where. */
interface LookupValue {
  value: string
  key: string
  count: number
  rows: number[]
}

/** What one lookup column's values resolved to. */
interface LookupColumn {
  field: TransferField & { lookup: NonNullable<TransferField['lookup']> }
  target: LookupTarget
  /** Value key → the one record it names. */
  resolved: Map<string, string>
  /** Values naming no record, or several, by key. */
  unresolved: Map<string, LookupValue & { candidates: string[] }>
  /** Every record the lookups found, by id. */
  records: Map<string, Readonly<Record<string, unknown>>>
}

/**
 * A record's name for the person: the first text it holds — the name a
 * resource lists first, as every record label the wizard shows is — else
 * its first `by` value.
 */
function lookupRecordLabel(record: Readonly<Record<string, unknown>> | undefined, by: readonly string[]): string | undefined {
  if (!record) return undefined
  const label = transferRowLabel(record)
  if (label) return label
  for (const fieldId of by) {
    const value = record[fieldId]
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim()
  }
  return undefined
}

/**
 * Every mapped lookup column's values resolved against its target: each
 * distinct value asked by id (when it could be one) and then by each `by`
 * field in order; the first key that names exactly one record decides. A
 * value that names several records, or none, is unresolved.
 */
async function resolveLookupColumns(
  deps: TransferEngineDeps,
  hooks: TransferRecordsHooks,
  ctx: TransferResourceContext,
  mapping: Record<number, string>,
  byId: ReadonlyMap<string, TransferField>,
  rows: ReadonlyArray<{ index: number; values: Readonly<Record<string, unknown>> }>,
): Promise<LookupColumn[]> {
  const columns: LookupColumn[] = []
  for (const fieldId of new Set(Object.values(mapping))) {
    const field = byId.get(fieldId)
    if (!isLookupField(field)) continue
    const values = new Map<string, LookupValue>()
    for (const row of rows) {
      const raw = row.values[field.id]
      if (isBlankTransferValue(raw) || typeof raw === 'object') continue
      const text = String(raw).trim()
      const key = transferLookupKey(text)
      const seen = values.get(key)
      if (seen) {
        seen.count += 1
        if (seen.rows.length < LOOKUP_ROWS_MAX) seen.rows.push(row.index)
      } else {
        values.set(key, { value: text, key, count: 1, rows: [row.index] })
      }
    }
    const target = await lookupTargetFor(deps, hooks, ctx, field.lookup.resource)
    const column: LookupColumn = { field, target, resolved: new Map(), unresolved: new Map(), records: new Map() }
    columns.push(column)
    if (!values.size) continue

    const keys: MatchKeySpec[] = [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      ...field.lookup.by.map(
        (by): MatchKeySpec =>
          target.hooks.matchKeys?.find((key) => key.fieldId === by) ?? { fieldId: by, normalizer: 'caseless' },
      ),
    ]
    const requests: MatchLookupRequest[] = keys
      .map((key) => {
        const wanted = new Set<string>()
        for (const entry of values.values()) {
          if (key.normalizer === 'aglynId' && !mayBeTransferRecordId(entry.value)) continue
          const normalized = normalizeMatchValue(key.normalizer, entry.value)
          if (normalized) wanted.add(normalized)
        }
        return { ...key, values: [...wanted] }
      })
      .filter((request) => request.values.length)
    const found = await lookupAll(target.hooks, target.ctx, requests)
    for (const [id, record] of found.records) column.records.set(id, record)

    for (const entry of values.values()) {
      let candidates: string[] = []
      for (const key of keys) {
        if (key.normalizer === 'aglynId' && !mayBeTransferRecordId(entry.value)) continue
        const normalized = normalizeMatchValue(key.normalizer, entry.value)
        const ids = normalized ? [...new Set(found.lookup.get(matchLookupKey(key.fieldId, normalized)) ?? [])] : []
        if (ids.length === 1) {
          column.resolved.set(entry.key, ids[0] as string)
          candidates = []
          break
        }
        if (ids.length > 1 && !candidates.length) candidates = ids
      }
      if (!column.resolved.has(entry.key)) column.unresolved.set(entry.key, { ...entry, candidates })
    }
  }
  return columns
}

/** The review the values step shows: every unresolved value, with records it may mean. */
async function lookupReviews(columns: readonly LookupColumn[]): Promise<TransferLookupReview[]> {
  const reviews: TransferLookupReview[] = []
  for (const column of columns) {
    const unresolved = [...column.unresolved.values()]
    const asked = unresolved.length && column.target.hooks.suggest
      ? await column.target.hooks.suggest(column.target.ctx, {
          by: column.field.lookup.by,
          values: unresolved.map((entry) => entry.value),
        })
      : {}
    reviews.push({
      fieldId: column.field.id,
      resolved: column.resolved.size,
      unresolved: unresolved.map((entry) => {
        const several: TransferLookupSuggestion[] = entry.candidates.map((recordId) => ({
          recordId,
          label: lookupRecordLabel(column.records.get(recordId), column.field.lookup.by) ?? recordId,
        }))
        const seen = new Set<string>()
        const suggestions = [...several, ...(asked[entry.value] ?? [])]
          .filter((suggestion) => {
            if (!suggestion?.recordId || seen.has(suggestion.recordId)) return false
            seen.add(suggestion.recordId)
            return true
          })
          .slice(0, LOOKUP_SUGGESTIONS_MAX)
          .map((suggestion) => ({ recordId: suggestion.recordId, label: String(suggestion.label || suggestion.recordId) }))
        return { value: entry.value, key: entry.key, count: entry.count, rows: entry.rows, suggestions }
      }),
    })
  }
  return reviews
}

/**
 * What the person must still decide about the lookup columns, by field: a
 * value with no choice, a "create" the target does not allow, and a record
 * chosen that does not exist. The records chosen are looked up by id.
 */
async function lookupChoiceProblems(
  columns: readonly LookupColumn[],
  choices: Readonly<Record<string, Readonly<Record<string, TransferLookupChoice>>>> | undefined,
): Promise<Record<string, string[]>> {
  const problems: Record<string, string[]> = {}
  for (const column of columns) {
    const fieldChoices = choices?.[column.field.id] ?? {}
    const found: string[] = []
    const mapped = new Set<string>()
    for (const entry of column.unresolved.values()) {
      const choice = fieldChoices[entry.key]
      if (!choice) found.push(`Choose what to do with “${entry.value}”.`)
      else if (choice.action === 'create' && !column.field.lookup.creatable) {
        found.push(`“${entry.value}” cannot be created by this import; use a record, leave it blank or refuse the rows.`)
      } else if (choice.action === 'mapTo') {
        if (typeof choice.recordId !== 'string' || !choice.recordId) found.push(`Choose the record “${entry.value}” means.`)
        else if (!column.records.has(choice.recordId)) mapped.add(choice.recordId)
      }
    }
    if (mapped.size) {
      const known = await lookupAll(column.target.hooks, column.target.ctx, [
        { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId', values: [...mapped] },
      ])
      for (const id of mapped) {
        if (known.records.has(id)) column.records.set(id, known.records.get(id) as Readonly<Record<string, unknown>>)
        else found.push(`The record chosen for a value no longer exists (${id}); choose again.`)
      }
    }
    if (found.length) problems[column.field.id] = found
  }
  return problems
}

/**
 * The person's lookup choices applied to the rows: a resolved value becomes
 * its record's id; an unresolved one its choice — the chosen record's id, a
 * record to create, nothing written, or the row refused — each noted on the
 * row as `unresolvedLookup`. A value left blank by choice is not written at
 * all: it must never read as "clear the field".
 */
function applyLookupChoices(
  rows: TransferPlanRow[],
  columns: readonly LookupColumn[],
  choices: Readonly<Record<string, Readonly<Record<string, TransferLookupChoice>>>> | undefined,
): void {
  for (const row of rows) {
    const values = row.values as Record<string, unknown>
    const notes = [...(row.notes ?? [])]
    for (const column of columns) {
      const raw = values[column.field.id]
      if (isBlankTransferValue(raw) || typeof raw === 'object') continue
      const text = String(raw).trim()
      const key = transferLookupKey(text)
      const id = column.resolved.get(key)
      if (id) {
        values[column.field.id] = id
        continue
      }
      const choice = choices?.[column.field.id]?.[key]
      const note = { class: 'unresolvedLookup' as const, fieldId: column.field.id, value: text }
      if (choice?.action === 'mapTo') {
        values[column.field.id] = choice.recordId
        const label = lookupRecordLabel(column.records.get(choice.recordId), column.field.lookup.by)
        notes.push({ ...note, detail: label ? `Uses “${label}”` : 'Uses a chosen record' })
      } else if (choice?.action === 'create') {
        values[column.field.id] = transferLookupNewValue(text)
        notes.push({ ...note, detail: 'Creates it' })
      } else if (choice?.action === 'refuseRow') {
        delete values[column.field.id]
        notes.push({ ...note, refuse: true, detail: 'Refuses the row' })
      } else {
        delete values[column.field.id]
        notes.push({ ...note, detail: 'Left blank' })
      }
    }
    if (notes.length) row.notes = notes
  }
}

/*==========================================
 * PLAN — the dry run
 *=========================================*/

interface PicklistColumn {
  field: TransferField & { picklistId: string }
  resolution: PicklistResolution
  /** Keys the person chose to add. */
  added: Set<string>
  /** Keys that resolve to blank: unmatched and left blank. */
  blank: Set<string>
}

/** The rows read, picklists resolved: what `buildTransferPlan` takes. */
function readPlanRows(
  table: TransferSourceTable,
  mapping: Record<number, string>,
  byId: ReadonlyMap<string, TransferField>,
  columns: readonly PicklistColumn[],
  choices: TransferPlanChoices,
): TransferPlanRow[] {
  return table.rows.map((cells, index): TransferPlanRow => {
    const derived = deriveTransferRow(
      byId,
      mapTransferRow(cells, mapping),
      choices.derive ?? {},
      transferDateOrderOptions(choices.dateOrders),
    )
    const notes: TransferRowNote[] = []
    for (const column of columns) {
      const fieldId = column.field.id
      const value = derived.values[fieldId]
      if (value === null || value === undefined) continue
      const noteFor = (raw: unknown): void => {
        const label = normalizePicklistLabel(raw)
        if (!label) return
        const key = picklistLabelKey(label)
        if (column.added.has(key)) notes.push({ class: 'newPicklistValue', fieldId, value: String(raw) })
        else if (column.blank.has(key)) notes.push({ class: 'unmatchedPicklist', fieldId, value: String(raw), detail: 'Left blank' })
      }
      if (column.field.type === 'multiPicklist' && Array.isArray(value)) {
        const outcome = resolveMultiPicklistCell(column.resolution, value)
        if (outcome.kind === 'refuse') {
          notes.push({ class: 'unmatchedPicklist', fieldId, value: value.join(', '), refuse: true, detail: 'Refuses the row' })
          continue
        }
        for (const raw of value) noteFor(raw)
        if (outcome.labels.length) derived.values[fieldId] = outcome.labels
        else delete derived.values[fieldId]
        continue
      }
      const outcome = resolvePicklistCell(column.resolution, value)
      if (outcome.kind === 'refuse') {
        notes.push({ class: 'unmatchedPicklist', fieldId, value: String(value), refuse: true, detail: 'Refuses the row' })
        continue
      }
      noteFor(value)
      // A value left blank by choice is not written at all: a blank here
      // must never read as "clear the field".
      if (outcome.kind === 'value') derived.values[fieldId] = outcome.label
      else delete derived.values[fieldId]
    }
    return {
      index,
      values: derived.values,
      derivations: derived.derivations,
      problems: derived.problems,
      ...(notes.length ? { notes } : {}),
    }
  })
}

/** The match keys the person chose, in their order, from the resource's own. */
function chosenMatchKeys(keys: readonly MatchKeySpec[], chosen: readonly string[]): MatchKeySpec[] {
  return chosen.map((fieldId) => {
    const key = keys.find((entry) => entry.fieldId === fieldId)
    if (!key) throw new TransferEngineError('invalid', 400, `"${fieldId}" is not a key records can be matched by.`)
    return key
  })
}

/** Every lookup request, cut so no single request carries more than {@link MATCH_LOOKUP_SLICE} values. */
function sliceLookupRequests(requests: readonly MatchLookupRequest[]): MatchLookupRequest[][] {
  const slices: MatchLookupRequest[][] = []
  for (const request of requests) {
    for (let at = 0; at < request.values.length; at += MATCH_LOOKUP_SLICE) {
      slices.push([{ ...request, values: request.values.slice(at, at + MATCH_LOOKUP_SLICE) }])
    }
  }
  return slices
}

async function lookupAll(
  hooks: Pick<TransferRecordsHooks, 'lookup'>,
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<{ lookup: Map<string, string[]>; records: Map<string, Readonly<Record<string, unknown>>> }> {
  const lookup = new Map<string, string[]>()
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const slice of sliceLookupRequests(requests)) {
    const found = await hooks.lookup(ctx, slice)
    for (const [key, ids] of found.lookup) lookup.set(key, [...new Set([...(lookup.get(key) ?? []), ...ids])])
    for (const [id, values] of found.records) records.set(id, values)
  }
  return { lookup, records }
}

/**
 * The dry run: every row read, its picklist values resolved, matched to the
 * records that exist and planned under the policy — without writing a
 * record. The planned rows are stored chunk by chunk for Apply; the summary,
 * the warnings and the first page answer the wizard.
 */
export async function planTransferJob(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string; actorUid: string; choices: TransferPlanChoices },
): Promise<Omit<TransferPlanResponse, 'ok'>> {
  const job = await readJob(deps, input.orgId, input.jobId)
  assertBeforeWrites(job, 'planned')
  if (job.status === 'draft') throw new TransferEngineError('state', 409, 'Analyze the file before planning it.')
  const resource = await resolveResource(deps, job.resource)
  const hooks = transferRecordsHooks(resource)
  const choices = input.choices
  // The plugin steps' answers as sent with this dry run, not the last one's.
  const ctx: TransferResourceContext = { ...contextFor(job, input.actorUid) }
  delete ctx.extras
  if (choices.extras) ctx.extras = choices.extras
  const table = await loadTable(deps, job)
  const catalog = await transferResourceCatalog(resource, ctx)
  const byId = new Map(catalog.fields.map((field) => [field.id, field]))

  const mapping = usableMapping(choices.mapping)
  const problems = mappingProblems(mapping, catalog.fields)
  if (!mappingIsUsable(problems)) {
    throw new TransferEngineError('invalid', 422, 'Resolve the mapping before the dry run.', problems)
  }
  const lockedRules = await transferResourceLockedRules(resource, ctx)
  const policy = createTransferPolicy({ ...(choices.policy ?? {}), locked: lockedRules })
  const policyProblems = transferPolicyProblems(policy, catalog.fields)
  if (policyProblems.length) throw new TransferEngineError('invalid', 422, policyProblems[0] as string, policyProblems)
  const offer = await transferResourceMatchKeys(resource, ctx)
  const keys = chosenMatchKeys(offer.keys, choices.matchKeys ?? offer.defaults)

  // Picklists: every unmatched value needs the person's choice.
  const lists = await picklistLists(hooks, ctx, catalog.fields)
  const analyses = analyzePicklistColumns(table, mapping, byId, lists)
  const columns: PicklistColumn[] = []
  const choiceProblems: Record<string, string[]> = {}
  const additions: Record<string, PicklistValue[]> = {}
  for (const analysis of analyses) {
    const fieldChoices: Record<string, PicklistValueChoice> = choices.picklistChoices?.[analysis.fieldId] ?? {}
    const found = picklistChoiceProblems(analysis.spec, analysis.set, analysis.unmatched, fieldChoices)
    if (found.length) {
      choiceProblems[analysis.fieldId] = found
      continue
    }
    const resolution = resolvePicklistChoices(
      analysis.spec,
      analysis.set,
      { matched: analysis.matched, unmatched: analysis.unmatched },
      fieldChoices,
    )
    const added = new Set<string>()
    const blank = new Set<string>()
    for (const value of analysis.unmatched) {
      const choice = fieldChoices[value.key]
      if (choice?.action === 'addValue') added.add(value.key)
      else if (choice?.action !== 'mapTo' && choice?.action !== 'refuseRow') blank.add(value.key)
    }
    const list = (additions[analysis.picklistId] ??= [])
    for (const value of resolution.added) {
      if (!list.some((entry) => entry.id === value.id)) list.push(value)
    }
    columns.push({ field: byId.get(analysis.fieldId) as PicklistColumn['field'], resolution, added, blank })
  }
  for (const [picklistId, values] of Object.entries(additions)) if (!values.length) delete additions[picklistId]

  const rows = readPlanRows(table, mapping, byId, columns, choices)

  // Lookups: every value that names no record needs the person's choice too.
  const lookupColumns = await resolveLookupColumns(deps, hooks, ctx, mapping, byId, rows)
  const lookupProblems = await lookupChoiceProblems(lookupColumns, choices.lookupChoices)
  for (const [fieldId, found] of Object.entries(lookupProblems)) {
    choiceProblems[fieldId] = [...(choiceProblems[fieldId] ?? []), ...found]
  }
  if (Object.keys(choiceProblems).length) {
    throw new TransferEngineError(
      'choicesNeeded',
      422,
      Object.keys(lookupProblems).length
        ? 'Choose what to do with every value the list does not hold and every record the file names that was not found.'
        : 'Choose what to do with every value the list does not hold.',
      choiceProblems,
    )
  }
  applyLookupChoices(rows, lookupColumns, choices.lookupChoices)
  const values = rows.map((row) => row.values)
  const found = keys.length
    ? await lookupAll(hooks, ctx, matchLookupRequests(values, keys))
    : { lookup: new Map<string, string[]>(), records: new Map<string, Readonly<Record<string, unknown>>>() }
  const matches = matchRows(values, keys, found.lookup)
  const plan = await planTransferResourceRows(resource, ctx, {
    fields: catalog.fields,
    rows,
    matches,
    existing: found.records,
    policy,
  })

  const failures: TransferPlanInvariantFailure[] = transferInvariantFailures(hooks.invariants, plan.rows, found.records)
  if (failures.length) {
    const failing = new Set(failures.map((failure) => failure.row))
    plan.rows = plan.rows.map(
      (row): PlannedTransferRow =>
        failing.has(row.index) ? { ...row, verdict: 'fail', reason: 'refusedValue', diff: [] } : row,
    )
    plan.summary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: plan.rows.length }
    for (const row of plan.rows) plan.summary[row.verdict] += 1
  }

  // The stored dry run, replaced whole.
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  await clearCollection(jobRef.collection('chunks'))
  const ranges = transferChunkRanges(plan.rows.length)
  await eachLimited(ranges, TRANSFER_WRITE_CONCURRENCY, async (range) => {
    await writeJsonDoc(
      jobRef.collection('chunks').doc(String(range.index)),
      { jobId: job.id, index: range.index, start: range.start, end: range.end },
      plan.rows.slice(range.start, range.end),
    )
  })

  const now = clock(deps)
  const matchSummary = summarizeMatches(matches)
  const allConflicts = transferPlanConflicts({ fields: byId, rows, matches, existing: found.records, policy })
  const conflicts = allConflicts.slice(0, TRANSFER_PLAN_CONFLICTS_MAX)
  const ambiguous = transferAmbiguities(matches)
  const sample = transferPlanSample(plan.rows)
  const labelled = new Set<string>()
  for (const row of sample) if (row.recordId) labelled.add(row.recordId)
  for (const conflict of conflicts) labelled.add(conflict.recordId)
  for (const row of ambiguous) for (const id of row.recordIds) labelled.add(id)
  const next = moveJob(job, 'planned', now, {
    mapping,
    matchKeys: keys.map((key) => key.fieldId),
    policy,
    picklistChoices: choices.picklistChoices ?? {},
    lookupChoices: choices.lookupChoices ?? {},
    ...(choices.derive ? { derive: choices.derive } : {}),
    ...(choices.dateOrders ? { dateOrders: choices.dateOrders } : {}),
    ...(choices.extras ? { extras: choices.extras } : {}),
    picklistAdditions: additions,
    summary: plan.summary,
    warnings: plan.warnings,
    acknowledgementsRequired: plan.acknowledgementsRequired,
    acknowledged: [],
    matchSummary,
    invariantFailures: failures.slice(0, 50),
    invariantFailureCount: failures.length,
    rowCount: plan.rows.length,
    chunkCount: ranges.length,
    plannedAt: now,
  })
  await saveJob(deps, next)
  const first = plan.rows.slice(0, 50)
  return {
    job: next,
    summary: plan.summary,
    warnings: plan.warnings,
    acknowledgementsRequired: plan.acknowledgementsRequired,
    matchSummary,
    invariantFailures: failures.slice(0, 50),
    invariantFailureCount: failures.length,
    picklistAdditions: additions,
    rows: { rows: first, offset: 0, next: plan.rows.length > first.length ? first.length : null },
    sample,
    conflicts,
    conflictCount: allConflicts.length,
    ambiguous,
    recordLabels: recordLabelsFor(found.records, labelled),
  }
}

async function readChunkRows(
  jobRef: FirebaseFirestore.DocumentReference,
  index: number,
): Promise<{ range: TransferChunkRange; rows: PlannedTransferRow[] } | null> {
  const ref = jobRef.collection('chunks').doc(String(index))
  const snapshot = await ref.get()
  if (!snapshot.exists) return null
  const data = snapshot.data() as TransferChunkRange
  const rows = (await readJsonDoc<PlannedTransferRow[]>(ref)) ?? []
  return { range: { index: data.index, start: data.start, end: data.end }, rows }
}

/** One page of the stored dry run, optionally only rows with some verdicts. */
export async function readTransferPlanRows(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string; offset?: number; limit?: number; verdicts?: readonly TransferRowVerdict[] },
): Promise<TransferPlanRowsPage> {
  const job = await readJob(deps, input.orgId, input.jobId)
  if (job.plannedAt === undefined) throw new TransferEngineError('state', 409, 'This import has no dry run yet.')
  const offset = Math.max(0, Math.floor(Number(input.offset ?? 0)) || 0)
  const limit = Math.min(TRANSFER_PLAN_PAGE_MAX, Math.max(1, Math.floor(Number(input.limit ?? 50)) || 50))
  const filter = input.verdicts?.length ? new Set(input.verdicts) : null
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const rows: PlannedTransferRow[] = []
  let seen = 0
  let more = false
  scan: for (let index = 0; index < (job.chunkCount ?? 0); index += 1) {
    const chunk = await readChunkRows(jobRef, index)
    if (!chunk) break
    for (const row of chunk.rows) {
      if (filter && !filter.has(row.verdict)) continue
      if (seen >= offset) {
        if (rows.length >= limit) {
          more = true
          break scan
        }
        rows.push(row)
      }
      seen += 1
    }
  }
  return { rows, offset, next: more ? offset + rows.length : null }
}

/*==========================================
 * APPLY
 *=========================================*/

export interface ApplyTransferInput {
  orgId: string
  jobId: string
  /** Whose import it is, for the plugin's own checks and activity lines. */
  actorUid: string
  acknowledged?: readonly TransferWarningClass[]
  /** When this request must stop starting chunks (epoch ms). */
  deadlineMs: number
  /** Who is driving: a request id, or the sweep. */
  driver: string
}

export interface ApplyTransferOutcome {
  job: TransferJobRecord
  progress: TransferProgress
  done: boolean
  /** This call moved the job into `applying` (the first call, or a resume after a failure). */
  started: boolean
  /** That move was a resume after a failure. */
  resumed: boolean
  /** The results of the chunks this call wrote. */
  results: TransferRowResult[]
}

/** A row the plan does not write, as its result. */
function plannedResult(row: PlannedTransferRow): TransferRowResult {
  if (row.verdict === 'unchanged') return { row: row.index, outcome: 'unchanged', ...(row.recordId ? { recordId: row.recordId } : {}) }
  if (row.verdict === 'skip') return { row: row.index, outcome: 'skipped', ...(row.reason ? { reason: row.reason } : {}) }
  return {
    row: row.index,
    outcome: 'failed',
    ...(row.recordId ? { recordId: row.recordId } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
  }
}

function addResults(total: TransferResultSummary, more: TransferResultSummary): TransferResultSummary {
  return {
    created: total.created + more.created,
    updated: total.updated + more.updated,
    unchanged: total.unchanged + more.unchanged,
    skipped: total.skipped + more.skipped,
    failed: total.failed + more.failed,
    total: total.total + more.total,
  }
}

interface LedgerEntry {
  result: TransferRowResult
  undo: TransferUndoEntry | null
}

/** Takes the job for `driver`, or refuses: another driver holds it, or another import of the resource is running. */
async function takeLease(
  deps: TransferEngineDeps,
  job: TransferJobRecord,
  driver: string,
  expiresAt: number,
  enter: (current: TransferJobRecord, now: number) => TransferJobRecord,
): Promise<TransferJobRecord> {
  const jobs = transferJobsCollection(deps.firestore, job.orgId)
  return deps.firestore.runTransaction(async (transaction) => {
    const ref = jobs.doc(job.id)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new TransferEngineError('notFound', 404, 'No such import.')
    const current = { ...(snapshot.data() as TransferJobRecord), id: job.id }
    const now = clock(deps)
    if (current.lease && current.lease.expiresAt > now && current.lease.owner !== driver) {
      throw new TransferEngineError('busy', 409, 'This import is already running in another window. Its progress shows here.')
    }
    const running = await transaction.get(
      jobs.where('resource', '==', current.resource).where('status', '==', 'applying').limit(5),
    )
    const other = running.docs.find((doc) => doc.id !== job.id)
    if (other) {
      throw new TransferEngineError('busy', 409, 'Another import of the same records is running. Wait for it to finish.', {
        jobId: other.id,
      })
    }
    const next = { ...enter(current, now), lease: { owner: driver, expiresAt } }
    transaction.set(ref, storedJob(next))
    return next
  })
}

/**
 * Writes chunks until the budget runs out (see the block header). The first
 * call needs every required acknowledgement; later calls — the browser's
 * next, or the sweep's — resume at the cursor. A plugin `apply` that throws
 * fails the job with the chunk named, and calling again resumes it.
 */
export async function applyTransferJob(
  deps: TransferEngineDeps,
  input: ApplyTransferInput,
): Promise<ApplyTransferOutcome> {
  let job = await readJob(deps, input.orgId, input.jobId)
  if (job.status === 'applied') {
    return { job, progress: transferJobProgress(job), done: true, started: false, resumed: false, results: [] }
  }
  if (job.status !== 'planned' && job.status !== 'applying' && job.status !== 'failed') {
    throw new TransferEngineError('state', 409, `This import is ${job.status}; plan it before applying.`)
  }
  if (job.plannedAt === undefined || !job.summary) {
    throw new TransferEngineError('state', 409, 'This import has no dry run yet.')
  }
  const acknowledged = [...(input.acknowledged ?? job.acknowledged ?? [])]
  if (job.applyStartedAt === undefined) {
    const plan = { acknowledgementsRequired: job.acknowledgementsRequired ?? [], summary: job.summary }
    if (!canApplyTransferPlan(plan, acknowledged)) {
      const missing = missingAcknowledgements(plan, acknowledged)
      if (!missing.length) throw new TransferEngineError('state', 409, 'The dry run writes nothing.')
      throw new TransferEngineError('acknowledgementsMissing', 422, 'Acknowledge every warning before applying.', {
        missing,
      })
    }
  }
  const resource = await resolveResource(deps, job.resource)
  const hooks = transferRecordsHooks(resource)
  const ctx = contextFor(job, input.actorUid)
  let started = false
  let resumed = false
  job = await takeLease(deps, job, input.driver, input.deadlineMs + TRANSFER_LEASE_GRACE_MS, (current, now) => {
    if (current.status === 'applying') return current
    started = true
    resumed = current.status === 'failed'
    return moveJob(current, 'applying', now, {
      acknowledged: current.applyStartedAt === undefined ? acknowledged : current.acknowledged,
      cursor: current.cursor ?? { chunk: 0, rowsDone: 0 },
      applyStartedAt: current.applyStartedAt ?? now,
      results: current.results ?? emptyResults(),
    })
  })

  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const timeLeft = () => input.deadlineMs - clock(deps)
  const written: TransferRowResult[] = []
  try {
    if (!job.picklistsAdded) {
      for (const [picklistId, values] of Object.entries(job.picklistAdditions ?? {})) {
        if (values.length) await hooks.addPicklistValues?.(ctx, picklistId, values)
      }
      job = { ...job, picklistsAdded: true, updatedAt: clock(deps) }
      await saveJob(deps, job)
    }
    const chunkCount = job.chunkCount ?? 0
    while ((job.cursor?.chunk ?? 0) < chunkCount && timeLeft() > TRANSFER_MIN_CHUNK_BUDGET_MS) {
      const next = await applyChunk(deps, job, jobRef, hooks, ctx, timeLeft)
      if (!next) break
      job = next.job
      written.push(...next.results)
    }
  } catch (error) {
    const chunk = job.cursor?.chunk ?? 0
    const message = error instanceof Error ? error.message : String(error)
    job = moveJob(job, 'failed', clock(deps), {
      error: { code: 'applyFailed', message: `Chunk ${chunk + 1} could not be written: ${message}`, chunk },
      lease: null,
    })
    await saveJob(deps, job)
    return { job, progress: transferJobProgress(job), done: false, started, resumed, results: written }
  }

  const done = (job.cursor?.chunk ?? 0) >= (job.chunkCount ?? 0)
  job = done
    ? moveJob(job, 'applied', clock(deps), { lease: null })
    : { ...job, lease: null, updatedAt: clock(deps) }
  await saveJob(deps, job)
  return { job, progress: transferJobProgress(job), done, started, resumed, results: written }
}

/**
 * One chunk, through the plugin's `apply` and the ledger. Answers the job
 * with the cursor moved past the chunk and the chunk's results, or `null`
 * when the chunk is not complete yet (the budget ran short and the plugin
 * stopped at a row).
 */
async function applyChunk(
  deps: TransferEngineDeps,
  job: TransferJobRecord,
  jobRef: FirebaseFirestore.DocumentReference,
  hooks: TransferRecordsHooks,
  ctx: TransferResourceContext,
  timeLeft: () => number,
): Promise<{ job: TransferJobRecord; results: TransferRowResult[] } | null> {
  const index = job.cursor?.chunk ?? 0
  const chunk = await readChunkRows(jobRef, index)
  if (!chunk) throw new Error(`the dry run has no chunk ${index + 1}`)
  const ledgerCollection = jobRef.collection('ledger')
  const ledger = new Map<number, LedgerEntry>()
  for (const doc of (await ledgerCollection.where('chunk', '==', index).get()).docs) {
    const data = doc.data() as { row: number; result: TransferRowResult; undoJson?: string | null }
    ledger.set(data.row, { result: data.result, undo: data.undoJson ? (JSON.parse(data.undoJson) as TransferUndoEntry) : null })
  }

  const writer: TransferApplyWriter = {
    async alreadyApplied(row) {
      return ledger.get(row)?.result ?? null
    },
    async markApplied(result, undo) {
      if (ledger.has(result.row)) return
      try {
        await ledgerCollection.doc(transferLedgerKey(job.id, result.row)).create(
          stored({ row: result.row, chunk: index, result, undoJson: undo ? JSON.stringify(undo) : null, at: clock(deps) }),
        )
      } catch (error) {
        if (!isAlreadyExists(error)) throw error
      }
      ledger.set(result.row, { result, undo: undo ?? null })
    },
    timeLeftMs: timeLeft,
  }

  const writes = chunk.rows.filter((row) => row.verdict === 'create' || row.verdict === 'update')
  if (writes.some((row) => !ledger.has(row.index))) {
    const applied = await hooks.apply(ctx, { jobId: job.id, index, start: chunk.range.start, end: chunk.range.end, rows: writes }, writer)
    const planned = new Set(writes.map((row) => row.index))
    for (const result of applied.results) {
      if (!planned.has(result.row) || ledger.has(result.row)) continue
      await writer.markApplied(result, applied.undo.find((entry) => entry.row === result.row))
    }
  }
  if (writes.some((row) => !ledger.has(row.index))) return null

  const results = chunk.rows.map((row) =>
    row.verdict === 'create' || row.verdict === 'update' ? (ledger.get(row.index) as LedgerEntry).result : plannedResult(row),
  )
  const undo: TransferUndoEntry[] = writes
    .map((row) => ledger.get(row.index)?.undo ?? null)
    .filter((entry): entry is TransferUndoEntry => entry !== null)
  const now = clock(deps)
  const next: TransferJobRecord = {
    ...job,
    cursor: { chunk: index + 1, rowsDone: chunk.range.end },
    results: addResults(job.results ?? emptyResults(), summarizeTransferResults(results)),
    updatedAt: now,
  }
  const undoJson = JSON.stringify(undo)
  const batch = deps.firestore.batch()
  batch.set(jobRef.collection('results').doc(String(index)), stored({ jobId: job.id, index, results, completedAt: now }))
  if (undoJson.length <= JSON_PIECE_CHARS) {
    batch.set(jobRef.collection('undo').doc(String(index)), { jobId: job.id, chunk: index, json: undoJson })
  }
  batch.set(jobRef, storedJob(next))
  if (undoJson.length > JSON_PIECE_CHARS) {
    // Too large for the batch: the undo snapshot is written whole first, so
    // the cursor never moves past a chunk whose undo is missing.
    await writeJsonDoc(jobRef.collection('undo').doc(String(index)), { jobId: job.id, chunk: index }, undo)
  }
  await batch.commit()

  // The ledger has done its work once the results are committed.
  const entries = (await ledgerCollection.where('chunk', '==', index).get()).docs
  await eachLimited(entries, TRANSFER_WRITE_CONCURRENCY, async (doc) => {
    await doc.ref.delete()
  })
  return { job: next, results }
}

/*==========================================
 * STATUS AND THE RESULT FILE
 *=========================================*/

/** The job, its progress, and whether undo is open. */
export async function readTransferJobStatus(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string; include?: 'results' },
): Promise<{
  job: TransferJobRecord
  progress: TransferProgress
  undo: { available: boolean; expiresAt: number | null; state: TransferUndoState | null }
  rows?: TransferRowResult[]
}> {
  const job = await readJob(deps, input.orgId, input.jobId)
  const rows =
    input.include === 'results'
      ? [...(await readResults(transferJobsCollection(deps.firestore, job.orgId).doc(job.id))).values()].sort(
          (a, b) => a.row - b.row,
        )
      : undefined
  return {
    ...(rows ? { rows } : {}),
    job,
    progress: transferJobProgress(job),
    undo: {
      available: transferUndoAvailable(job, clock(deps)) && job.undo?.status !== 'done',
      expiresAt: transferUndoExpiresAt(job),
      state: job.undo ?? null,
    },
  }
}

async function readResults(
  jobRef: FirebaseFirestore.DocumentReference,
): Promise<Map<number, TransferRowResult>> {
  const results = new Map<number, TransferRowResult>()
  for (const doc of (await jobRef.collection('results').get()).docs) {
    for (const result of ((doc.data() as { results?: TransferRowResult[] }).results ?? [])) results.set(result.row, result)
  }
  return results
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * The result file: every row of the file as it was sent, then what happened
 * to it, why, and the record it wrote. A row not written yet says `pending`.
 */
export async function transferResultFile(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string },
): Promise<{ csv: string; rows: number; fileName: string }> {
  const job = await readJob(deps, input.orgId, input.jobId)
  if (job.applyStartedAt === undefined) throw new TransferEngineError('state', 409, 'Nothing has been written yet.')
  if (job.trimmedAt !== undefined) {
    throw new TransferEngineError(
      'state',
      409,
      'The file behind this import was cleared once its undo window closed; its results are still counted.',
    )
  }
  const table = await loadTable(deps, job)
  const results = await readResults(transferJobsCollection(deps.firestore, job.orgId).doc(job.id))
  const lines = [[...table.headers, ...TRANSFER_RESULT_COLUMNS].map(csvCell).join(',')]
  table.rows.forEach((cells, row) => {
    const result = results.get(row)
    const tail = result
      ? [result.outcome, result.message ?? (result.reason ? String(result.reason) : ''), result.recordId ?? '']
      : ['pending', '', '']
    lines.push([...table.headers.map((_header, column) => transferCellText(cells[column])), ...tail].map(csvCell).join(','))
  })
  const base = (job.fileName ?? 'import').replace(/\.[a-z0-9]+$/i, '')
  return { csv: `${lines.join('\r\n')}\r\n`, rows: table.rows.length, fileName: `${base}-results.csv` }
}

/*==========================================
 * UNDO
 *=========================================*/

async function readUndoSnapshots(
  jobRef: FirebaseFirestore.DocumentReference,
  chunkCount: number,
  from = 0,
): Promise<TransferUndoSnapshot[]> {
  const snapshots: TransferUndoSnapshot[] = []
  for (let index = from; index < chunkCount; index += 1) {
    const entries = await readJsonDoc<TransferUndoEntry[]>(jobRef.collection('undo').doc(String(index)))
    snapshots.push({ jobId: jobRef.id, chunk: index, entries: entries ?? [] })
  }
  return snapshots
}

function assertUndoOpen(job: TransferJobRecord, now: number): void {
  if (job.status !== 'applied') throw new TransferEngineError('state', 409, `This import is ${job.status}; only an applied import can be undone.`)
  if (job.undo?.status === 'done') throw new TransferEngineError('state', 409, 'This import was already undone.')
  if (!job.undo && !transferUndoAvailable(job, now)) {
    throw new TransferEngineError('undoExpired', 410, 'An import can be undone for seven days; this one is older.')
  }
}

/**
 * What undo would do, writing nothing: every record the import touched,
 * read as it is now, and planned with the core's `planTransferUndo`. A
 * record edited since comes back as a conflict, with what it holds now and
 * what undo would put back, for the person to decide.
 */
export async function planTransferJobUndo(
  deps: TransferEngineDeps,
  input: { orgId: string; jobId: string; actorUid: string; offset?: number; limit?: number },
): Promise<Omit<TransferUndoPlanResponse, 'ok'>> {
  const job = await readJob(deps, input.orgId, input.jobId)
  assertUndoOpen(job, clock(deps))
  const resource = await resolveResource(deps, job.resource)
  const hooks = transferRecordsHooks(resource)
  const ctx = contextFor(job, input.actorUid)
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const snapshots = await readUndoSnapshots(jobRef, job.chunkCount ?? 0, job.undo?.chunk ?? 0)
  const entries = snapshots.flatMap((snapshot) => snapshot.entries)
  const ids = [...new Set(entries.map((entry) => entry.recordId))]
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (let at = 0; at < ids.length; at += UNDO_LOOKUP_SLICE) {
    const found = await hooks.lookup(ctx, [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId', values: ids.slice(at, at + UNDO_LOOKUP_SLICE) },
    ])
    for (const [id, values] of found.records) records.set(id, values)
  }
  const counts = emptyUndoCounts()
  const conflicts: TransferUndoConflict[] = []
  for (const entry of entries) {
    const current = records.get(entry.recordId) ?? null
    const step = planTransferUndo(entry, current)
    if (step.action === 'conflict') {
      counts.conflict += 1
      const label = transferRowLabel(current)
      conflicts.push({
        row: entry.row,
        recordId: entry.recordId,
        ...(label ? { label } : {}),
        action: entry.action,
        fields: step.fields,
        current: Object.fromEntries(step.fields.map((fieldId) => [fieldId, current?.[fieldId] ?? null])),
        restore: step.values,
      })
    } else if (step.action === 'restore') counts.restore += 1
    else if (step.action === 'delete') counts.delete += 1
    else counts.nothing += 1
  }
  const offset = Math.max(0, Math.floor(Number(input.offset ?? 0)) || 0)
  const limit = Math.min(TRANSFER_UNDO_PAGE_MAX, Math.max(1, Math.floor(Number(input.limit ?? 50)) || 50))
  const page = conflicts.slice(offset, offset + limit)
  return {
    job,
    counts,
    conflicts: page,
    offset,
    next: offset + page.length < conflicts.length ? offset + page.length : null,
    expiresAt: transferUndoExpiresAt(job),
  }
}

export interface ApplyTransferUndoInput {
  orgId: string
  jobId: string
  actorUid: string
  decisions?: Readonly<Record<string, TransferUndoDecision>>
  otherwise: TransferUndoDecision
  deadlineMs: number
  driver: string
}

/**
 * Carries undo out, chunk by chunk, through the plugin's `revert`, each
 * record with the person's decision (`otherwise` for one the decisions do
 * not name). Called again until `done`; the last chunk moves the job to
 * `undone`. Reverting a chunk twice is harmless: a field already restored
 * plans as nothing.
 */
export async function applyTransferJobUndo(
  deps: TransferEngineDeps,
  input: ApplyTransferUndoInput,
): Promise<{ job: TransferJobRecord; undo: TransferUndoState; done: boolean; started: boolean }> {
  if (input.otherwise !== 'keep' && input.otherwise !== 'revert') {
    throw new TransferEngineError('invalid', 400, 'Say what happens to a record edited since the import.')
  }
  let job = await readJob(deps, input.orgId, input.jobId)
  assertUndoOpen(job, clock(deps))
  const resource = await resolveResource(deps, job.resource)
  const hooks = transferRecordsHooks(resource)
  const ctx = contextFor(job, input.actorUid)
  const decisions: Record<string, TransferUndoDecision> = { ...(input.decisions ?? {}) }
  let started = false
  job = await takeLease(deps, job, input.driver, input.deadlineMs + TRANSFER_LEASE_GRACE_MS, (current, now) => {
    if (current.undo) {
      return {
        ...current,
        undo: { ...current.undo, otherwise: input.otherwise, decisions: { ...current.undo.decisions, ...decisions } },
        updatedAt: now,
      }
    }
    started = true
    return {
      ...current,
      updatedAt: now,
      undo: {
        status: 'running',
        chunk: 0,
        startedAt: now,
        startedBy: input.actorUid,
        otherwise: input.otherwise,
        decisions,
        counts: emptyUndoCounts(),
      },
    }
  })
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  const chunkCount = job.chunkCount ?? 0
  let undo = job.undo as TransferUndoState
  // The person's decisions, this call's and every earlier call's: a resumed undo decides the same way.
  Object.assign(decisions, undo.decisions ?? {}, input.decisions ?? {})
  try {
    while (undo.chunk < chunkCount && input.deadlineMs - clock(deps) > TRANSFER_MIN_CHUNK_BUDGET_MS) {
      const [snapshot] = await readUndoSnapshots(jobRef, undo.chunk + 1, undo.chunk)
      const counts = { ...undo.counts }
      if (snapshot && snapshot.entries.length) {
        const chosen = Object.fromEntries(
          snapshot.entries.map((entry) => [entry.recordId, decisions[entry.recordId] ?? input.otherwise]),
        )
        const reverted = await hooks.revert(ctx, snapshot, chosen)
        for (const step of reverted.done) counts[step.action] += 1
        counts.conflict += reverted.conflicts.length
      }
      undo = { ...undo, chunk: undo.chunk + 1, counts }
      job = { ...job, undo, updatedAt: clock(deps) }
      await saveJob(deps, job)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    job = { ...job, lease: null, updatedAt: clock(deps), error: { code: 'undoFailed', message, chunk: undo.chunk } }
    await saveJob(deps, job)
    throw new TransferEngineError('failed', 500, `Undo stopped at chunk ${undo.chunk + 1}: ${message}. Try again to continue.`)
  }
  const done = undo.chunk >= chunkCount
  if (done) {
    undo = { ...undo, status: 'done' }
    job = moveJob({ ...job, undo }, 'undone', clock(deps), { lease: null })
  } else {
    job = { ...job, lease: null, updatedAt: clock(deps) }
  }
  await saveJob(deps, job)
  return { job, undo, done, started }
}

/*==========================================
 * THE SWEEP — what a closed tab left behind, and what has outlived its use
 *
 *  - an import left `applying`, or an undo left running, untouched for
 *    {@link TRANSFER_STALE_MS}: resumed through the same engine, under the
 *    sweep's lease (undo with the person's stored decisions);
 *  - a job that never wrote, untouched for seven days
 *    (`TRANSFER_DRAFT_RETENTION_MS`): deleted with its subcollections and
 *    its file;
 *  - a job that wrote, once its seven-day undo window has closed: its dry
 *    run, undo snapshots, ledger and file are cleared, and the job and its
 *    per-row results kept (`trimmedAt`).
 *
 * The last two are found by the `retention` and `retainUntil` every job
 * write stamps (`transferJobRetention`), so a trimmed job never matches
 * again.
 *=========================================*/

/** The most jobs one sweep expires or trims. */
const CLEANUP_LIMIT = 50

export interface TransferSweepOutcome {
  /** Jobs found applying and untouched past the stale window. */
  found: number
  resumed: Array<{ orgId: string; jobId: string; status: TransferJobRecord['status']; done: boolean }>
  /** Jobs that could not be resumed this time (held by a driver, or failed). */
  skipped: Array<{ orgId: string; jobId: string; reason: string }>
  /** Undos found running and untouched, and what resuming each did. */
  undone: Array<{ orgId: string; jobId: string; done: boolean }>
  /** Jobs that never wrote, deleted with their file. */
  expired: Array<{ orgId: string; jobId: string }>
  /** Jobs past their undo window, cleared to the job and its results. */
  trimmed: Array<{ orgId: string; jobId: string }>
}

/** Deletes a Storage object, if it is there. */
async function deleteObject(deps: TransferEngineDeps, path: string): Promise<void> {
  await deps.bucket.file(path).delete({ ignoreNotFound: true })
}

/** The job's stored file and any parts still waiting for the rest. */
async function deleteSourceFiles(deps: TransferEngineDeps, job: TransferJobRecord): Promise<void> {
  await deleteObject(deps, transferSourcePath(job.orgId, job.id))
  const parts = job.upload?.parts ?? 0
  await eachLimited(
    Array.from({ length: parts > 1 ? parts : 0 }, (_unused, index) => index),
    TRANSFER_WRITE_CONCURRENCY,
    async (index) => deleteObject(deps, transferPartPath(job.orgId, job.id, index)),
  )
}

/** A job that never wrote, gone: its subcollections, its file, then the job. */
export async function expireTransferJob(deps: TransferEngineDeps, job: TransferJobRecord): Promise<void> {
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  for (const name of ['chunks', 'ledger', 'results', 'undo']) await clearCollection(jobRef.collection(name))
  await deleteSourceFiles(deps, job)
  await jobRef.delete()
}

/** A job past its undo window, kept as the job and its results: the dry run, undo snapshots, ledger and file cleared. */
export async function trimTransferJob(deps: TransferEngineDeps, job: TransferJobRecord): Promise<TransferJobRecord> {
  const jobRef = transferJobsCollection(deps.firestore, job.orgId).doc(job.id)
  for (const name of ['chunks', 'ledger', 'undo']) await clearCollection(jobRef.collection(name))
  await deleteSourceFiles(deps, job)
  const trimmed: TransferJobRecord = { ...job, trimmedAt: clock(deps) }
  delete trimmed.sourcePath
  await saveJob(deps, trimmed)
  return trimmed
}

function jobOf(doc: FirebaseFirestore.QueryDocumentSnapshot): { orgId: string; job: TransferJobRecord } {
  const job = { ...(doc.data() as TransferJobRecord), id: doc.id }
  return { orgId: doc.ref.parent.parent?.id ?? job.orgId, job: { ...job, orgId: doc.ref.parent.parent?.id ?? job.orgId } }
}

/**
 * The sweep (see the block header). Each resume runs under the sweep's
 * lease until the budget is spent; the ledger makes overlapping with a
 * returning browser harmless. `dryRun` lists what it would do and does
 * nothing.
 */
export async function sweepAbandonedTransferJobs(
  deps: TransferEngineDeps,
  input: { deadlineMs: number; dryRun?: boolean; limit?: number; staleMs?: number },
): Promise<TransferSweepOutcome> {
  const now = clock(deps)
  const stale = now - (input.staleMs ?? TRANSFER_STALE_MS)
  const jobs = deps.firestore.collectionGroup(TRANSFER_JOBS_COLLECTION)
  const budgetLeft = () => input.deadlineMs - clock(deps) > TRANSFER_MIN_CHUNK_BUDGET_MS
  const snapshot = await jobs
    .where('status', '==', 'applying')
    .where('updatedAt', '<=', stale)
    .orderBy('updatedAt', 'asc')
    .limit(input.limit ?? 10)
    .get()
  const outcome: TransferSweepOutcome = { found: snapshot.docs.length, resumed: [], skipped: [], undone: [], expired: [], trimmed: [] }
  for (const doc of snapshot.docs) {
    const { orgId, job } = jobOf(doc)
    if (input.dryRun) {
      outcome.skipped.push({ orgId, jobId: doc.id, reason: 'dryRun' })
      continue
    }
    if (!budgetLeft()) {
      outcome.skipped.push({ orgId, jobId: doc.id, reason: 'budget' })
      continue
    }
    try {
      const applied = await applyTransferJob(deps, {
        orgId,
        jobId: doc.id,
        actorUid: job.createdBy,
        deadlineMs: input.deadlineMs,
        driver: `sweep:${doc.id}`,
      })
      outcome.resumed.push({ orgId, jobId: doc.id, status: applied.job.status, done: applied.done })
    } catch (error) {
      outcome.skipped.push({ orgId, jobId: doc.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  // An undo the browser left part-way, finished with the person's own decisions.
  const undoing = await jobs
    .where('undo.status', '==', 'running')
    .where('updatedAt', '<=', stale)
    .orderBy('updatedAt', 'asc')
    .limit(input.limit ?? 10)
    .get()
  for (const doc of undoing.docs) {
    const { orgId, job } = jobOf(doc)
    if (input.dryRun || !budgetLeft() || !job.undo) {
      outcome.skipped.push({ orgId, jobId: doc.id, reason: input.dryRun ? 'dryRun' : 'budget' })
      continue
    }
    try {
      const undone = await applyTransferJobUndo(deps, {
        orgId,
        jobId: doc.id,
        actorUid: job.undo.startedBy,
        decisions: job.undo.decisions ?? {},
        otherwise: job.undo.otherwise,
        deadlineMs: input.deadlineMs,
        driver: `sweep-undo:${doc.id}`,
      })
      outcome.undone.push({ orgId, jobId: doc.id, done: undone.done })
    } catch (error) {
      outcome.skipped.push({ orgId, jobId: doc.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  // What has outlived its use: drafts that never wrote, and applied jobs past their undo window.
  for (const retention of ['expire', 'trim'] as const) {
    const due = await jobs
      .where('retention', '==', retention)
      .where('retainUntil', '<=', now)
      .orderBy('retainUntil', 'asc')
      .limit(CLEANUP_LIMIT)
      .get()
    for (const doc of due.docs) {
      const { orgId } = jobOf(doc)
      if (input.dryRun || !budgetLeft()) {
        outcome.skipped.push({ orgId, jobId: doc.id, reason: input.dryRun ? 'dryRun' : 'budget' })
        continue
      }
      // Read again: the job may have moved on since the query, and is decided as it is now.
      const current = await readJob(deps, orgId, doc.id).catch(() => null)
      const verdict = current ? transferJobRetention(current) : null
      if (!current || !verdict || verdict.retention !== retention || verdict.retainUntil > clock(deps)) continue
      try {
        if (retention === 'expire') {
          await expireTransferJob(deps, current)
          outcome.expired.push({ orgId, jobId: doc.id })
        } else {
          await trimTransferJob(deps, current)
          outcome.trimmed.push({ orgId, jobId: doc.id })
        }
      } catch (error) {
        outcome.skipped.push({ orgId, jobId: doc.id, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return outcome
}
