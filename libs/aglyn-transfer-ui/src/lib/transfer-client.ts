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
 * THE TRANSFER CLIENT — everything the kit asks of the server, as one interface.
 *
 * The kit never fetches. A surface hands it a `TransferClient`, and every
 * read and write goes through it: the console's implementation calls the
 * job engine's routes (`api/transfer/*`), the specs and stories use
 * {@link createMemoryTransferClient}, which runs the same core in memory.
 *
 * Every shape that crosses the wire is the core's
 * (`@aglyn/aglyn/data-transfer`, `transfer-api.ts` and `review.ts`) and is
 * re-exported here, so the kit, the console's client and the job engine
 * cannot disagree. What is defined here is the client's own side of it:
 * requests without the organization (the client is bound to one), the file
 * as the browser read it, and the views a step renders, each composed of
 * the core's shapes.
 *=========================================*/

import type {
  TransferAmbiguity,
  TransferApplyRequest,
  TransferConflict,
  TransferCsvDelimiter,
  TransferDerivationSummary,
  TransferExportChoice,
  TransferField,
  TransferFormat,
  TransferJob,
  TransferLookupReview,
  TransferMatchReview,
  TransferPicklistAnalysis,
  TransferPlan,
  TransferPolicy,
  TransferPrefs,
  TransferReadChoices,
  TransferResourceInfo,
  TransferResultSummary,
  TransferRowResult,
  TransferUndoConflict,
  TransferUndoCounts,
  TransferUndoDecision,
  HeaderMatchResult,
} from '@aglyn/aglyn/data-transfer'

export type {
  TransferAmbiguity,
  TransferConflict,
  TransferConflictField,
  TransferDateOrder,
  TransferDerivationCount,
  TransferDerivationSummary,
  TransferExportChoice,
  TransferExportPrefs,
  TransferExportScope,
  TransferExportScopeKind,
  TransferLookupChoice,
  TransferLookupReview,
  TransferMatchReview,
  TransferMatchRowView,
  TransferPicklistAnalysis,
  TransferPrefs,
  TransferProblemCount,
  TransferReadChoices,
  TransferResourceInfo,
  TransferUndoConflict,
  TransferUndoCounts,
  TransferUndoDecision,
} from '@aglyn/aglyn/data-transfer'

/** A route's request as the client sends it: the client names the organization itself. */
export type TransferClientRequest<T> = Omit<T, 'orgId'>

/*------------------------------------------
 * Upload and analysis
 *-----------------------------------------*/

/** How the person confirmed the file is read. */
export interface TransferFileSettings {
  format: TransferFormat
  /** The text encoding the bytes were decoded with. */
  encoding: TransferEncoding
  /** The cell separator, for CSV. */
  delimiter: TransferDelimiter
  /** The first line holds the column names, for CSV. */
  headerRow: boolean
}

export type TransferEncoding =
  'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export type TransferDelimiter = TransferCsvDelimiter

/** A file as the browser read it, to store as a new job. */
export interface TransferFileUpload {
  resource: string
  fileName: string
  /** The file decoded with `settings.encoding`. */
  text: string
  /** The size of the file as chosen, in bytes. */
  bytes: number
  settings: TransferFileSettings
}

/** Read the job's file; with choices, under them. */
export interface TransferAnalysisRequest extends Partial<TransferReadChoices> {
  jobId: string
}

/** How the file reads, and what the server proposes. */
export interface TransferAnalysis {
  job: TransferJob
  headers: string[]
  /** The first rows of the file, cells in column order. */
  sampleRows: unknown[][]
  rowCount: number
  /** Header proposals: confidence, reason, alternatives, conflicts. */
  proposal: HeaderMatchResult
  /** Present once a mapping was sent. */
  derivations?: TransferDerivationSummary[]
  picklists?: TransferPicklistAnalysis[]
  lookups?: TransferLookupReview[]
  /** Present once a mapping was sent. */
  matches?: TransferMatchReview
  /** Record id → a name for it. */
  recordLabels?: Record<string, string>
}

/*------------------------------------------
 * Plan (the dry run) and conflicts
 *-----------------------------------------*/

export interface TransferDryRunRequest extends TransferReadChoices {
  jobId: string
  policy: TransferPolicy
  /** What a plugin's extra wizard steps collected (a consent attestation). */
  extras?: Record<string, unknown>
}

/** The dry run as the review steps show it. */
export interface TransferDryRun {
  job: TransferJob
  /**
   * The summary, warnings and acknowledgements cover every row; `rows` is
   * every planned row, or — when `rowsComplete` is false — some rows of each
   * verdict.
   */
  plan: TransferPlan
  /** `false` when `plan.rows` holds a sample of a larger file. */
  rowsComplete?: boolean
  conflicts: TransferConflict[]
  /** Every conflict, counted, when `conflicts` lists only the first of them. */
  conflictCount?: number
  ambiguous: TransferAmbiguity[]
  recordLabels?: Record<string, string>
}

/*------------------------------------------
 * Apply, results and undo
 *-----------------------------------------*/

/** One call's chunks applied. The browser calls again until `done`. */
export interface TransferApplyStep {
  job: TransferJob
  /** The results of the chunks this call wrote. */
  results: TransferRowResult[]
  rowsDone: number
  rowCount: number
  done: boolean
}

export interface TransferResults {
  job: TransferJob
  summary: TransferResultSummary
  rows: TransferRowResult[]
}

/**
 * `preview` says what undo would do; `apply` does it, with the person's
 * decision for each record edited since (`keep` it as it is now, or
 * `revert` it anyway) and `otherwise` for one edited after the preview.
 */
export type TransferUndoRequest =
  | { jobId: string; mode: 'preview' }
  | {
      jobId: string
      mode: 'apply'
      decisions: Record<string, TransferUndoDecision>
      otherwise?: TransferUndoDecision
    }

export interface TransferUndoResponse {
  job: TransferJob
  /** What undo would do (preview) or did (apply), counted. */
  counts: TransferUndoCounts
  /** The records edited since the import, each needing a decision. */
  conflicts: TransferUndoConflict[]
  /** Undo has finished (apply only). */
  done: boolean
}

/*------------------------------------------
 * Export
 *-----------------------------------------*/

export interface TransferExportResponse {
  fileName: string
  rowCount: number
  body: Blob
}

/*------------------------------------------
 * The client
 *-----------------------------------------*/

export interface TransferCustomFieldRequest {
  resource: string
  label: string
  type: TransferField['type']
}

/**
 * The server, as the kit sees it. The console implements it over
 * `api/transfer/*`; {@link createMemoryTransferClient} implements it in
 * memory.
 */
export interface TransferClient {
  /** The resource's fields, match keys, locked rules and the person's preferences. */
  fields(request: { resource: string }): Promise<TransferResourceInfo>
  /** Stores the file as a new draft job. */
  upload(request: TransferFileUpload): Promise<TransferJob>
  /** Reads the job's file: header proposals, then — given choices — values and matches. */
  analyze(request: TransferAnalysisRequest): Promise<TransferAnalysis>
  /** The dry run: every row planned under the choices, nothing written. */
  plan(request: TransferDryRunRequest): Promise<TransferDryRun>
  /** Writes the next chunks of a planned job. */
  apply(
    request: TransferClientRequest<TransferApplyRequest>,
  ): Promise<TransferApplyStep>
  /** The job as stored. */
  status(request: { jobId: string }): Promise<TransferJob>
  /** Every row's result. */
  results(request: { jobId: string }): Promise<TransferResults>
  /** Previews or runs the undo of an applied job. */
  undo(request: TransferUndoRequest): Promise<TransferUndoResponse>
  /** Writes the chosen fields of the chosen records to a file. */
  export(request: TransferExportChoice): Promise<TransferExportResponse>
  /** Remembers the person's choices for a resource. */
  savePrefs(request: {
    resource: string
    prefs: Partial<TransferPrefs>
  }): Promise<TransferPrefs>
  /** Creates a custom field; absent where the surface cannot. */
  createCustomField?(
    request: TransferCustomFieldRequest,
  ): Promise<TransferField>
}
