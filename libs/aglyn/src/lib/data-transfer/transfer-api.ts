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
 * THE TRANSFER API — what the import wizard sends the job engine, and what
 * it gets back.
 *
 * Eight console routes, all `POST` with a JSON body (`Content-Type:
 * application/json`) carrying `orgId`, and the caller's ID token as
 * `Authorization: Bearer …`:
 *
 *   fields  → what a resource offers: its fields, groups, match keys,
 *             locked rules and the person's remembered choices
 *   upload  → a job in `draft`, the file stored (in parts when it is large)
 *   analyze → `analyzed`: the header proposal, samples, picklist values;
 *             given a mapping, every field's derivations and the matches
 *   plan    → `planned`: the dry run over every row; `action: 'rows'` pages it
 *   apply   → `applying` … `applied`: chunks written until the time budget
 *             runs out; called again until `done`
 *   status  → the job, its progress and counts; `download: 'results'`
 *             answers the per-row result file as CSV instead of JSON
 *   undo    → `action: 'plan'` lists what undo would do and the records
 *             edited since; `action: 'apply'` carries it out with the
 *             person's decisions, called again until `done`
 *   export  → the chosen fields of the chosen records, streamed as CSV,
 *             JSON or NDJSON with the row count in a header
 *   package → a workspace package (AGL-3535): `list` and `export` its
 *             items, `plan` an import, `apply` it, `undoPlan` and `undo`
 *   jobs    → the workspace's imports, newest first, for the hub's history
 *
 * Every refusal is a {@link TransferErrorResponse} with an HTTP status and a
 * {@link TransferErrorCode} a client can branch on. The job itself is also
 * readable from Firestore at `orgs/{orgId}/transferJobs/{jobId}` (as a
 * {@link TransferJobRecord}) by the members the routes admit, so a progress
 * panel can listen instead of polling.
 *
 * These are types and constants only, and the one definition of every
 * shape that crosses the wire: the engine is the console's
 * (`@aglyn/tenant-data-admin/server/transfer-jobs`), the client the console
 * hands the UI kit is built on them, and the kit's in-memory client answers
 * with the same shapes.
 *=========================================*/

import type { PicklistSpec, PicklistValue, PicklistValueSet } from '../app-utils/picklists'
import type { DerivationKind, DeriveOptions, DeriveProblemCode } from './derive'
import type {
  TransferFieldCatalog,
  TransferFieldGroup,
  TransferPresetHints,
  TransferResourcePreset,
  TransferSavedPreset,
} from './field-catalog'
import type { HeaderMatchResult, MappingProblems, TransferAliasDictionary } from './header-match'
import type { TransferJob, TransferJobStatus, TransferResultSummary, TransferRowResult } from './job'
import type { MatchKeySpec, MatchedVia, RowMatchOutcome } from './match'
import type {
  PicklistMatched,
  PicklistUnmatched,
  PicklistValueChoice,
} from './picklist-map'
import type {
  PlannedTransferRow,
  TransferPlanSummary,
  TransferRowVerdict,
  TransferWarning,
  TransferWarningClass,
} from './plan'
import type { TransferFieldMode, TransferLockedRule, TransferPolicy, TransferPolicySource } from './policy'
import type { TransferField, TransferFormat, TransferResourceDescriptor } from './resource'
import type { TransferCsvDelimiter, TransferSourceOptions } from './source'
import type { PackageDependency, PackageItemDecision, TransferPackage } from './package'
import type {
  TransferPackageDependencyChoice,
  TransferPackagePlanItem,
  TransferPackageReference,
  TransferPackageSummary,
  TransferPackageWarningClass,
} from './package-plan'

/** Where each route is served. */
export const TRANSFER_API_ROUTES = {
  fields: '/api/transfer/fields',
  upload: '/api/transfer/upload',
  analyze: '/api/transfer/analyze',
  plan: '/api/transfer/plan',
  apply: '/api/transfer/apply',
  status: '/api/transfer/status',
  undo: '/api/transfer/undo',
  export: '/api/transfer/export',
  package: '/api/transfer/package',
  jobs: '/api/transfer/jobs',
} as const

export type TransferApiRoute = keyof typeof TRANSFER_API_ROUTES

/**
 * The most bytes one upload request carries. A file larger than this is
 * sent in parts (`part`, `parts`), each under the platform's request ceiling.
 */
export const TRANSFER_UPLOAD_PART_MAX_BYTES = 3_000_000

/** The most bytes one file may carry, unless its resource sets a lower `limits.maxBytes`. */
export const TRANSFER_UPLOAD_MAX_BYTES = 24_000_000

/** The most parts one upload may be sent in. */
export const TRANSFER_UPLOAD_MAX_PARTS = Math.ceil(TRANSFER_UPLOAD_MAX_BYTES / TRANSFER_UPLOAD_PART_MAX_BYTES)

/** The most rows a file may carry, unless its resource sets `limits.maxRows`. */
export const TRANSFER_DEFAULT_MAX_ROWS = 50_000

/** The sample rows analyze returns for the mapping step. */
export const TRANSFER_ANALYZE_SAMPLE_ROWS = 20

/** The most planned rows one `plan` page returns. */
export const TRANSFER_PLAN_PAGE_MAX = 200

/** The most undo conflicts one `undo` plan page returns. */
export const TRANSFER_UNDO_PAGE_MAX = 200

/** The planned rows of each verdict a dry run answers with, so every filter of the review table shows rows. */
export const TRANSFER_PLAN_SAMPLE_PER_VERDICT = 50

/** The most conflicts a dry run lists; the count covers every one. */
export const TRANSFER_PLAN_CONFLICTS_MAX = 500

/** The rows of each match outcome analyze lists; the summary counts every row. */
export const TRANSFER_MATCH_ROWS_PER_KIND = 100

/** The examples each derivation or problem keeps. */
export const TRANSFER_REVIEW_SAMPLES = 5

/*------------------------------------------
 * The stored job
 *-----------------------------------------*/

/** A file that arrives in parts: how many, and which have landed. */
export interface TransferUploadState {
  parts: number
  received: number[]
  bytes: number
  complete: boolean
}

/** What undo has done so far, while it runs and after. */
export interface TransferUndoState {
  status: 'running' | 'done'
  /** The next undo snapshot (chunk) to revert. */
  chunk: number
  startedAt: number
  startedBy: string
  /** What happens to an edited record the decisions do not name. */
  otherwise: TransferUndoDecision
  /** The person's decision per record id, kept so the sweep can finish an undo the browser left. */
  decisions?: Record<string, TransferUndoDecision>
  counts: TransferUndoCounts
}

/**
 * What the sweep does to a job once `retainUntil` passes: `expire` deletes
 * a job that never wrote (and its file); `trim` clears an applied job's
 * dry run, undo snapshots and file once its undo window has closed, keeping
 * the job and its per-row results.
 */
export type TransferJobRetention = 'expire' | 'trim'

/** How long a job that never wrote is kept after it was last touched. */
export const TRANSFER_DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/** Undo's steps, counted. */
export type TransferUndoCounts = Record<'restore' | 'delete' | 'conflict' | 'nothing', number>

/** Who is driving a job right now; another driver waits until it lapses. */
export interface TransferJobLease {
  owner: string
  expiresAt: number
}

/** A planned row that breaks one of the resource's own rules, and so fails. */
export interface TransferPlanInvariantFailure {
  row: number
  invariant: string
  message: string
}

/**
 * A job as `orgs/{orgId}/transferJobs/{jobId}` stores it: the core's
 * {@link TransferJob}, and what the engine keeps between requests.
 */
export interface TransferJobRecord extends TransferJob {
  /** Where the file is stored, once every part has landed. */
  sourcePath?: string
  upload?: TransferUploadState
  /** How the CSV is read, as the person confirmed it at upload. */
  read?: TransferSourceOptions
  /** The file's header, once analyzed. */
  headers?: string[]
  /** The person's choices the stored plan was built from. */
  picklistChoices?: TransferPicklistChoices
  /** Field id → lookup value key → what the person chose for a value that named no record. */
  lookupChoices?: Record<string, Record<string, TransferLookupChoice>>
  derive?: DeriveOptions
  /** The date order the person chose per field. */
  dateOrders?: Record<string, TransferDateOrder>
  /** What a plugin's extra wizard steps collected, by step id. */
  extras?: Record<string, unknown>
  /** Values the plan adds to the organization's picklists, by picklist id; added before the first write. */
  picklistAdditions?: Record<string, PicklistValue[]>
  picklistsAdded?: boolean
  warnings?: TransferWarning[]
  acknowledgementsRequired?: TransferWarningClass[]
  matchSummary?: Record<RowMatchOutcome['kind'], number>
  invariantFailures?: TransferPlanInvariantFailure[]
  invariantFailureCount?: number
  plannedAt?: number
  /** Set by the first write; a job that has written can be resumed, never re-planned. */
  applyStartedAt?: number
  /** Results so far, counted. */
  results?: TransferResultSummary
  lease?: TransferJobLease | null
  undo?: TransferUndoState
  /** What the sweep does once `retainUntil` passes; absent while the job is running, and once trimmed. */
  retention?: TransferJobRetention
  retainUntil?: number
  /** When the sweep cleared the dry run, undo snapshots and file of an applied job. */
  trimmedAt?: number
  /** A workspace package import's plan, as the job keeps it (`kind: 'package'`). */
  package?: TransferPackageJobState
}

/** What a workspace package import keeps on its job between requests. */
export interface TransferPackageJobState {
  /** Where the package came from, as its manifest says. */
  source?: string
  /** The resources its items belong to. */
  resources: string[]
  summary: TransferPackageSummary
  blocking: string[]
  acknowledgementsRequired: TransferPackageWarningClass[]
  acknowledged?: TransferPackageWarningClass[]
  unknownKinds: string[]
  /** The person's choices the stored plan was built from. */
  decisions: Record<string, PackageItemDecision>
  dependencyChoices: Record<string, TransferPackageDependencyChoice>
}

/*------------------------------------------
 * The person's choices, and what the server says about a file under them
 *-----------------------------------------*/

/** The person's date-order choice for a field whose dates read either way. */
export type TransferDateOrder = 'mdy' | 'dmy'

/** What to do with one lookup value that names no record. */
export type TransferLookupChoice =
  | { action: 'create' }
  | { action: 'mapTo'; recordId: string }
  | { action: 'leaveBlank' }
  | { action: 'refuseRow' }

/** Everything the person has decided that changes how rows are read. */
export interface TransferReadChoices {
  /** Column → field id; a column left out is ignored. */
  mapping: Record<number, string>
  /** Field id → the order its ambiguous dates are read in. */
  dateOrders?: Record<string, TransferDateOrder>
  /** Field id → incoming value key → choice. */
  picklistChoices?: Record<string, Record<string, PicklistValueChoice>>
  /** Field id → incoming value key → choice. */
  lookupChoices?: Record<string, Record<string, TransferLookupChoice>>
  /** Match key field ids, in priority order. */
  matchKeys?: string[]
}

/** One kind of thing a parser did to a field's cells, counted over the file. */
export interface TransferDerivationCount {
  kind: DerivationKind
  /** The rule in a sentence, from the first occurrence. */
  note: string
  count: number
  flagged: boolean
  samples: { row: number; from: string; to: string }[]
}

/** One kind of cell a field could not read, counted over the file. */
export interface TransferProblemCount {
  code: DeriveProblemCode
  message: string
  count: number
  samples: { row: number; raw: string }[]
}

/** What reading one field's cells did, over the whole file. */
export interface TransferDerivationSummary {
  fieldId: string
  /** Cells that held a value. */
  filled: number
  /** Cells read as they were. */
  unchanged: number
  derivations: TransferDerivationCount[]
  problems: TransferProblemCount[]
  /** Cells whose day and month could be either way round; the person picks the order. */
  ambiguousDates: number
}

/**
 * A lookup column's values that name no record — or several — each with the
 * rows that carry it and the records it may mean (AGL-3541).
 */
export interface TransferLookupReview {
  fieldId: string
  /** Distinct values that named exactly one record. */
  resolved?: number
  unresolved: {
    value: string
    key: string
    count: number
    rows: number[]
    suggestions: { recordId: string; label: string }[]
  }[]
}

/** One row's match, for the matching step's lists. */
export interface TransferMatchRowView {
  row: number
  outcome: RowMatchOutcome
  /** A name for the row, from its own cells. */
  label?: string
}

/** Rows against existing records under the chosen keys. */
export interface TransferMatchReview {
  keys: MatchKeySpec[]
  summary: Record<RowMatchOutcome['kind'], number>
  /** Rows of each outcome, at most {@link TRANSFER_MATCH_ROWS_PER_KIND} of each. */
  rows: TransferMatchRowView[]
}

/** One field a matched record and the file disagree on. */
export interface TransferConflictField {
  fieldId: string
  before: unknown
  incoming: unknown
  /** What the policy makes of it now. */
  after: unknown
  mode: TransferFieldMode
  source: TransferPolicySource
}

/** A matched row whose file values differ from values the record already has. */
export interface TransferConflict {
  row: number
  recordId: string
  fields: TransferConflictField[]
}

/** A row more than one record matched. */
export interface TransferAmbiguity {
  row: number
  via: MatchedVia
  recordIds: string[]
}

/*------------------------------------------
 * A resource as the person sees it, and their remembered choices
 *-----------------------------------------*/

/** Which records an export reads. */
export type TransferExportScopeKind = 'selection' | 'filter' | 'all'

/** The records an export reads: the selected ids, the list's current filter, or every record. */
export type TransferExportScope =
  | { kind: 'selection'; ids: string[] }
  | { kind: 'filter'; filter: unknown }
  | { kind: 'all' }

/** The fields, records and format the person chose to export. */
export interface TransferExportChoice {
  resource: string
  /** Field ids, in the file's column order. */
  fieldIds: string[]
  scope: TransferExportScope
  format: TransferFormat
  /** A CSV starts with a byte-order mark, for spreadsheets. */
  bom: boolean
  /**
   * The CSV column name for a field, by field id, in place of its label — a
   * resource preset's `headers` (see `transferExportHeaders`).
   */
  headers?: Readonly<Record<string, string>>
}

/** Where a person's remembered choices live: `users/{uid}/transferPrefs/{resourceKey}`, a `TransferPrefs`. */
export const TRANSFER_PREFS_COLLECTION = 'transferPrefs'

/** The most selected ids one export reads. */
export const TRANSFER_EXPORT_SELECTION_MAX = 10_000

/** The rows an export asks the resource for per page. */
export const TRANSFER_EXPORT_PAGE_ROWS = 500

/**
 * The rows an export reads ahead, before the first byte, to count a
 * resource that cannot count itself: a file that fits is promised whole.
 */
export const TRANSFER_EXPORT_PREFETCH_ROWS = 5_000

/** The export choice a person made last, remembered per person and resource. */
export interface TransferExportPrefs {
  /** A built-in preset id, a saved preset's id, or `null` for a hand-picked list. */
  presetId: string | null
  fieldIds: string[]
  format: TransferFormat
  /** A CSV starts with a byte-order mark, for spreadsheets. */
  bom: boolean
  scope: TransferExportScopeKind
}

/** What is remembered for one person and resource. */
export interface TransferPrefs {
  export?: TransferExportPrefs
  /** Presets the person saved, in the order they saved them. */
  presets: TransferSavedPreset[]
}

/** What a resource offers to import and export, as the person may see it. */
export interface TransferResourceInfo {
  resource: TransferResourceDescriptor
  /** Every field in catalog order: standard, derived, custom, then system. */
  fields: TransferField[]
  /** The groups the fields are listed under, in order. */
  groups: TransferFieldGroup[]
  /** The keys a row may be matched on, in the default priority. */
  matchKeys: MatchKeySpec[]
  /** The match keys used when the person has not chosen (every key, in order, by default). */
  defaultMatchKeys?: string[]
  presetHints?: TransferPresetHints
  /** The resource's own presets, listed after the built-in ones. */
  resourcePresets?: TransferResourcePreset[]
  /** The owning plugin's rules, shown locked with their reasons. */
  locked: TransferLockedRule[]
  /** Other products' header spellings, from the owning plugin. */
  dictionaries?: TransferAliasDictionary[]
  prefs: TransferPrefs
  /** Whether the person may create a custom field from the mapping step. */
  canCreateCustomField?: boolean
}

/*------------------------------------------
 * Requests and responses
 *-----------------------------------------*/

/** Every request names its organization. */
export interface TransferOrgRequest {
  orgId: string
}

/** Every request after the upload names its job. */
export interface TransferJobRequest extends TransferOrgRequest {
  jobId: string
}

/** Where a job stands, for a progress bar. */
export interface TransferProgress {
  status: TransferJobStatus
  /** The next chunk to write. */
  chunk: number
  chunkCount: number
  rowsDone: number
  rowCount: number
  results: TransferResultSummary
}

/** `fields`: what a resource offers. Answers for import and export alike. */
export interface TransferFieldsRequest extends TransferOrgRequest {
  resource: string
  /** The site, for a host-scoped resource. */
  hostId?: string | null
}

export interface TransferFieldsResponse extends TransferResourceInfo {
  ok: true
}

/** `upload`: one file, or one part of it. */
export interface TransferUploadRequest extends TransferOrgRequest {
  resource: string
  /** The site, for a host-scoped resource. */
  hostId?: string | null
  fileName: string
  /** Detected from the file name, then the content, when absent. */
  format?: TransferFormat
  /** The file's text, or this part of it. */
  content: string
  /** This part's index, from 0; omit for a file sent whole. */
  part?: number
  /** How many parts the file is sent in; omit for a file sent whole. */
  parts?: number
  /** The job the first part made; required on every later part. */
  jobId?: string
  /** The CSV delimiter the person confirmed; detected when absent. Read from the first part. */
  delimiter?: TransferCsvDelimiter
  /** `false` when the CSV's first line is a row, not names. Read from the first part. */
  headerRow?: boolean
}

export interface TransferUploadResponse {
  ok: true
  job: TransferJobRecord
  /** Whether every part has landed and the file is stored. */
  complete: boolean
}

/**
 * `analyze`: read the file and propose a mapping. Re-run with `mapping` to
 * see the file under it: each mapped field's derivations, its picklist
 * values, and how the rows match existing records under `matchKeys`.
 */
export interface TransferAnalyzeRequest
  extends TransferJobRequest,
    Partial<Omit<TransferReadChoices, 'mapping'>> {
  mapping?: Record<number, string | null>
}

/** One mapped picklist column's values against the organization's list. */
export interface TransferPicklistAnalysis {
  fieldId: string
  picklistId: string
  spec: PicklistSpec
  set: PicklistValueSet
  matched: PicklistMatched[]
  unmatched: PicklistUnmatched[]
  /** The proposed choice for each unmatched value, by its key — shown, never applied unseen. */
  proposals: Record<string, PicklistValueChoice>
}

export interface TransferAnalyzeResponse {
  ok: true
  job: TransferJobRecord
  headers: string[]
  rowCount: number
  /** The first rows, as text, in column order. */
  samples: string[][]
  catalog: TransferFieldCatalog
  match: HeaderMatchResult
  /** The problems of the mapping analyzed (`mapping`, or the proposal). */
  mappingProblems: MappingProblems
  matchKeys: MatchKeySpec[]
  lockedRules: TransferLockedRule[]
  picklists: TransferPicklistAnalysis[]
  /** With `mapping`: what reading each mapped field did, over every row. */
  derivations?: TransferDerivationSummary[]
  /** With `mapping`: each mapped lookup column's values that name no record, with suggestions. */
  lookups?: TransferLookupReview[]
  /** With `mapping`: the rows against existing records. */
  matches?: TransferMatchReview
  /** Record id → a name for it, for the records `matches` names. */
  recordLabels?: Record<string, string>
}

/** Per mapped picklist field, the choice for each unmatched value by its key. */
export type TransferPicklistChoices = Record<string, Record<string, PicklistValueChoice>>

/** The person's choices a dry run is built from. */
export interface TransferPlanChoices extends Omit<TransferReadChoices, 'mapping'> {
  /** Column → field id; `null` leaves a column out. */
  mapping: Record<number, string | null>
  /** The match keys to use, by field id, in priority order; the resource's own order when absent. */
  matchKeys?: string[]
  /** The policy; the resource's locked rules are applied over it whatever it says. */
  policy?: Partial<Omit<TransferPolicy, 'locked'>>
  picklistChoices?: TransferPicklistChoices
  derive?: DeriveOptions
  /** What a plugin's extra wizard steps collected (a consent attestation), by step id. */
  extras?: Record<string, unknown>
}

/** `plan`: build the dry run. */
export interface TransferPlanRequest extends TransferJobRequest, TransferPlanChoices {
  action?: 'plan'
}

/** `plan` with `action: 'rows'`: one page of the stored dry run. */
export interface TransferPlanRowsRequest extends TransferJobRequest {
  action: 'rows'
  offset?: number
  limit?: number
  /** Only rows with these verdicts. */
  verdicts?: TransferRowVerdict[]
}

export interface TransferPlanRowsPage {
  rows: PlannedTransferRow[]
  offset: number
  /** The offset of the next page, or `null` after the last. */
  next: number | null
}

export interface TransferPlanResponse {
  ok: true
  job: TransferJobRecord
  summary: TransferPlanSummary
  warnings: TransferWarning[]
  acknowledgementsRequired: TransferWarningClass[]
  matchSummary: Record<RowMatchOutcome['kind'], number>
  invariantFailures: TransferPlanInvariantFailure[]
  invariantFailureCount: number
  picklistAdditions: Record<string, PicklistValue[]>
  /** The first page of planned rows. */
  rows: TransferPlanRowsPage
  /** Up to {@link TRANSFER_PLAN_SAMPLE_PER_VERDICT} rows of each verdict, in row order. */
  sample: PlannedTransferRow[]
  /** Matched rows whose file values differ from the record's, at most {@link TRANSFER_PLAN_CONFLICTS_MAX}. */
  conflicts: TransferConflict[]
  /** Every such row, counted. */
  conflictCount: number
  /** Rows more than one record matched. */
  ambiguous: TransferAmbiguity[]
  /** Record id → a name for it, for the records the sample, conflicts and ambiguous rows name. */
  recordLabels: Record<string, string>
}

export interface TransferPlanRowsResponse {
  ok: true
  rows: TransferPlanRowsPage
}

/** `apply`: write chunks until the request's budget runs out. */
export interface TransferApplyRequest extends TransferJobRequest {
  /** The warning classes the person acknowledged; required on the first call. */
  acknowledged?: TransferWarningClass[]
}

export interface TransferApplyResponse {
  ok: true
  job: TransferJobRecord
  progress: TransferProgress
  /** Every chunk is written; stop calling. */
  done: boolean
  /** The results of the chunks this call wrote. */
  results: TransferRowResult[]
}

/** `status`: where the job stands; `download: 'results'` answers the result file, `include: 'results'` adds every row's result. */
export interface TransferStatusRequest extends TransferJobRequest {
  download?: 'results'
  include?: 'results'
}

export interface TransferStatusResponse {
  ok: true
  job: TransferJobRecord
  progress: TransferProgress
  undo: {
    available: boolean
    /** When undo closes, or `null` before the job is applied. */
    expiresAt: number | null
    state: TransferUndoState | null
  }
  /** With `include: 'results'`: every written row's result, in row order. */
  rows?: TransferRowResult[]
}

/**
 * The header a result file carries with its row count, so the client can
 * tell a whole download from a cut-off one (`exportShortfall`).
 */
export const TRANSFER_EXPORT_ROWS_HEADER = 'X-Aglyn-Export-Rows'

/** The result file's columns after the file's own: what happened to the row, why, and the record. */
export const TRANSFER_RESULT_COLUMNS = ['Outcome', 'Reason', 'Record ID'] as const

/** One row of the result file, before it is written as CSV. */
export interface TransferResultFileRow {
  cells: string[]
  result: TransferRowResult | null
}

/** What the person decided for one record edited since the import. */
export type TransferUndoDecision = 'revert' | 'keep'

/** `undo` with `action: 'plan'`: what undo would do. Writes nothing. */
export interface TransferUndoPlanRequest extends TransferJobRequest {
  action: 'plan'
  offset?: number
  limit?: number
}

/** A record edited since the import: what it holds now, and what undo would put back. */
export interface TransferUndoConflict {
  row: number
  recordId: string
  /** A name for the record, from what it holds now. */
  label?: string
  action: 'created' | 'updated'
  /** The fields edited since the import. */
  fields: string[]
  /** Those fields as the record holds them now. */
  current: Record<string, unknown>
  /** What undo would restore them to; empty for a created record (undo deletes it). */
  restore: Record<string, unknown>
}

export interface TransferUndoPlanResponse {
  ok: true
  job: TransferJobRecord
  counts: TransferUndoCounts
  conflicts: TransferUndoConflict[]
  offset: number
  next: number | null
  expiresAt: number | null
}

/** `undo` with `action: 'apply'`: carry it out. Called again until `done`. */
export interface TransferUndoApplyRequest extends TransferJobRequest {
  action: 'apply'
  /** The person's decision per record id, for the conflicts the plan listed. */
  decisions?: Record<string, TransferUndoDecision>
  /** For an edited record the decisions do not name — one edited after the plan was read. */
  otherwise: TransferUndoDecision
}

export interface TransferUndoApplyResponse {
  ok: true
  job: TransferJobRecord
  undo: TransferUndoState
  done: boolean
}

/**
 * `export`: the chosen fields of the chosen records, streamed. The answer is
 * the file (`text/csv`, `application/json` or `application/x-ndjson`) with
 * the rows it promises in {@link TRANSFER_EXPORT_ROWS_HEADER} whenever the
 * resource could count them before the first byte, or a
 * {@link TransferErrorResponse}.
 */
export interface TransferExportRequest extends TransferOrgRequest, TransferExportChoice {
  /** The site, for a host-scoped resource. */
  hostId?: string | null
}

/*------------------------------------------
 * Workspace packages (AGL-3535): `POST /api/transfer/package`
 *-----------------------------------------*/

/** One item a workspace holds, for the export picker. */
export interface TransferPackageListItem {
  /** `<kind>/<id>`. */
  key: string
  kind: string
  id: string
  name?: string
  /** What it names, so "include what they need" can be shown before the file is made. */
  deps: PackageDependency[]
}

/** One package resource the workspace can move, and what it holds. */
export interface TransferPackageResourceList {
  key: string
  label: string
  pluginId: string
  description?: string
  items: TransferPackageListItem[]
  /** The resource's rules, shown with their reasons (an imported sequence is a draft). */
  rules: TransferPackageRuleView[]
}

/** A plugin's rule an import cannot change, with why. */
export interface TransferPackageRuleView {
  id: string
  label: string
  reason: string
}

/** `action: 'list'`: the package resources the workspace can move, and their items. */
export interface TransferPackageListRequest extends TransferOrgRequest {
  action: 'list'
  /** Only these resources; every one when absent. */
  resources?: string[]
}

export interface TransferPackageListResponse {
  ok: true
  resources: TransferPackageResourceList[]
}

/**
 * `action: 'export'`: the package file. `items` names item keys; absent,
 * every item of `resources` (or of every resource). `dependencies` adds
 * what the chosen items name that the workspace holds as package items.
 */
export interface TransferPackageExportRequest extends TransferOrgRequest {
  action: 'export'
  items?: string[]
  resources?: string[]
  dependencies?: boolean
}

export interface TransferPackageExportResponse {
  ok: true
  fileName: string
  package: TransferPackage
}

/**
 * `action: 'plan'`: what importing a package would do, writing nothing.
 * The first call carries `package` and makes the job; later calls name
 * `jobId` and carry the person's choices, and re-plan against the
 * workspace as it is then.
 */
export interface TransferPackagePlanRequest extends TransferOrgRequest {
  action: 'plan'
  jobId?: string
  /** The file's parsed JSON, on the first call. */
  package?: unknown
  fileName?: string
  decisions?: Record<string, PackageItemDecision>
  dependencyChoices?: Record<string, TransferPackageDependencyChoice>
}

export interface TransferPackagePlanResponse {
  ok: true
  job: TransferJobRecord
  items: TransferPackagePlanItem[]
  references: TransferPackageReference[]
  unknownKinds: string[]
  summary: TransferPackageSummary
  blocking: string[]
  acknowledgementsRequired: TransferPackageWarningClass[]
  /** Each resource's label and rules, by resource key. */
  resources: Record<string, { label: string; rules: TransferPackageRuleView[] }>
}

/** `action: 'apply'`: write the planned items. Called again until `done`. */
export interface TransferPackageApplyRequest extends TransferOrgRequest {
  action: 'apply'
  jobId: string
  acknowledged?: TransferPackageWarningClass[]
}

export interface TransferPackageApplyResponse {
  ok: true
  job: TransferJobRecord
  done: boolean
  results: TransferRowResult[]
}

/** What undo needs to reverse one package item. */
export interface TransferPackageUndoEntry {
  row: number
  key: string
  resource: string
  /** The id it was written under. */
  id: string
  name?: string
  action: 'created' | 'updated'
  /** A replaced item's content before the import. */
  previous?: unknown
  previousHash?: string
  /** The item's content hash once written, to tell a later edit from the import's own. */
  writtenHash?: string
}

/** An item edited since the import: undo asks before it overwrites or deletes it. */
export interface TransferPackageUndoConflict {
  row: number
  key: string
  resource: string
  id: string
  name?: string
  action: 'created' | 'updated'
}

/** `action: 'undoPlan'`: what undo would do. Writes nothing. */
export interface TransferPackageUndoPlanRequest extends TransferOrgRequest {
  action: 'undoPlan'
  jobId: string
}

export interface TransferPackageUndoPlanResponse {
  ok: true
  job: TransferJobRecord
  counts: TransferUndoCounts
  conflicts: TransferPackageUndoConflict[]
  expiresAt: number | null
}

/** `action: 'undo'`: carry undo out, each edited item as decided (`otherwise` for the rest). */
export interface TransferPackageUndoRequest extends TransferOrgRequest {
  action: 'undo'
  jobId: string
  /** By item id. */
  decisions?: Record<string, TransferUndoDecision>
  otherwise: TransferUndoDecision
}

export interface TransferPackageUndoResponse {
  ok: true
  job: TransferJobRecord
  undo: TransferUndoState
  done: boolean
}

/*------------------------------------------
 * The workspace's imports (AGL-3535): `POST /api/transfer/jobs`
 *-----------------------------------------*/

/** The most jobs one page of the history holds. */
export const TRANSFER_JOBS_PAGE_MAX = 50

/** `jobs`: the workspace's imports, newest first. */
export interface TransferJobsRequest extends TransferOrgRequest {
  limit?: number
  /** The `next` of the page before. */
  after?: number | null
  /** Also each site's package imports (`hosts/{hostId}/packageImports`), on the first page. */
  sitePackages?: boolean
}

/** The most package imports listed per site. */
export const TRANSFER_SITE_PACKAGE_IMPORTS_PER_SITE = 10

/** One site package import (AGL-3533), as the hub's history lists it. */
export interface TransferSitePackageImportSummary {
  hostId: string
  hostName: string | null
  importId: string
  status: 'applying' | 'applied' | 'refused' | 'failed' | 'undone'
  actorEmail: string | null
  source: string | null
  startedAt: number
  appliedAt: number | null
  undoneAt: number | null
  /** Items by decision. */
  counts: Record<string, number>
  items: number
  undo: { available: boolean; expiresAt: number | null }
  error: string | null
}

/** One import as the hub's history lists it. */
export interface TransferJobSummary {
  id: string
  resource: string
  /** The resource's label, or "Package". */
  label: string
  kind: TransferJob['kind']
  status: TransferJobStatus
  hostId: string | null
  fileName: string | null
  createdAt: number
  updatedAt: number
  createdBy: string
  /** The member's address, when the workspace still has them. */
  createdByEmail: string | null
  rowCount: number
  results: TransferResultSummary | null
  appliedAt: number | null
  undo: {
    available: boolean
    expiresAt: number | null
    status: TransferUndoState['status'] | null
  }
  /** The per-row result file can be downloaded (`status` with `download: 'results'`). */
  resultFile: boolean
  error: string | null
}

export interface TransferJobsResponse {
  ok: true
  jobs: TransferJobSummary[]
  /** With `sitePackages`: each site's latest package imports, newest first. */
  sitePackageImports?: TransferSitePackageImportSummary[]
  /** The `createdAt` to ask the next page `after`, or `null` after the last. */
  next: number | null
}

/** Why a request was refused. */
export type TransferErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'invalid'
  | 'tooLarge'
  | 'unsupportedFormat'
  | 'rejectedFile'
  | 'state'
  | 'busy'
  | 'acknowledgementsMissing'
  | 'choicesNeeded'
  | 'undoExpired'
  | 'rateLimited'
  | 'unavailable'
  | 'failed'

/** Every refusal's body. */
export interface TransferErrorResponse {
  error: string
  code: TransferErrorCode
  /** What the client needs to fix it: the missing acknowledgements, the mapping problems, the open picklist values. */
  details?: unknown
}
