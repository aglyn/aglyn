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
 * Six console routes, all `POST` with a JSON body (`Content-Type:
 * application/json`) carrying `orgId`, and the caller's ID token as
 * `Authorization: Bearer …`:
 *
 *   upload  → a job in `draft`, the file stored (in parts when it is large)
 *   analyze → `analyzed`: the header proposal, samples, picklist values
 *   plan    → `planned`: the dry run over every row; `action: 'rows'` pages it
 *   apply   → `applying` … `applied`: chunks written until the time budget
 *             runs out; called again until `done`
 *   status  → the job, its progress and counts; `download: 'results'`
 *             answers the per-row result file as CSV instead of JSON
 *   undo    → `action: 'plan'` lists what undo would do and the records
 *             edited since; `action: 'apply'` carries it out with the
 *             person's decisions, called again until `done`
 *
 * Every refusal is a {@link TransferErrorResponse} with an HTTP status and a
 * {@link TransferErrorCode} a client can branch on. The job itself is also
 * readable from Firestore at `orgs/{orgId}/transferJobs/{jobId}` (as a
 * {@link TransferJobRecord}) by the members the routes admit, so a progress
 * panel can listen instead of polling.
 *
 * These are types and constants only; the engine is the console's
 * (`@aglyn/tenant-data-admin/server/transfer-jobs`) and the client is the
 * UI kit's.
 *=========================================*/

import type { PicklistSpec, PicklistValue, PicklistValueSet } from '../app-utils/picklists'
import type { DeriveOptions } from './derive'
import type { TransferFieldCatalog } from './field-catalog'
import type { HeaderMatchResult, MappingProblems } from './header-match'
import type { TransferJob, TransferJobStatus, TransferResultSummary, TransferRowResult } from './job'
import type { MatchKeySpec, RowMatchOutcome } from './match'
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
import type { TransferLockedRule, TransferPolicy } from './policy'
import type { TransferFormat } from './resource'

/** Where each route is served. */
export const TRANSFER_API_ROUTES = {
  upload: '/api/transfer/upload',
  analyze: '/api/transfer/analyze',
  plan: '/api/transfer/plan',
  apply: '/api/transfer/apply',
  status: '/api/transfer/status',
  undo: '/api/transfer/undo',
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
  counts: TransferUndoCounts
}

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
  /** The file's header, once analyzed. */
  headers?: string[]
  /** The person's choices the stored plan was built from. */
  picklistChoices?: TransferPicklistChoices
  derive?: DeriveOptions
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
}

export interface TransferUploadResponse {
  ok: true
  job: TransferJobRecord
  /** Whether every part has landed and the file is stored. */
  complete: boolean
}

/** `analyze`: read the file and propose a mapping. Re-run with `mapping` to see a changed mapping's picklist values. */
export interface TransferAnalyzeRequest extends TransferJobRequest {
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
}

/** Per mapped picklist field, the choice for each unmatched value by its key. */
export type TransferPicklistChoices = Record<string, Record<string, PicklistValueChoice>>

/** The person's choices a dry run is built from. */
export interface TransferPlanChoices {
  /** Column → field id; `null` leaves a column out. */
  mapping: Record<number, string | null>
  /** The match keys to use, by field id, in priority order; the resource's own order when absent. */
  matchKeys?: string[]
  /** The policy; the resource's locked rules are applied over it whatever it says. */
  policy?: Partial<Omit<TransferPolicy, 'locked'>>
  picklistChoices?: TransferPicklistChoices
  derive?: DeriveOptions
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
}

/** `status`: where the job stands; `download: 'results'` answers the result file. */
export interface TransferStatusRequest extends TransferJobRequest {
  download?: 'results'
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
