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
 * The shapes are the core's (`@aglyn/aglyn/data-transfer`) wherever the core
 * has one — a `HeaderMatchResult`, a `TransferPlan`, a `TransferJob` — and
 * the rest are what a wizard step needs that no core function returns by
 * itself: a whole file's derivations counted, a picklist column against the
 * organization's list, the conflicts a policy would decide.
 *=========================================*/

import type {
  DerivationKind,
  DeriveProblemCode,
  HeaderMatchResult,
  MatchKeySpec,
  MatchedVia,
  PicklistMatchResult,
  PicklistValueChoice,
  RowMatchOutcome,
  TransferAliasDictionary,
  TransferField,
  TransferFieldGroup,
  TransferFieldMode,
  TransferFormat,
  TransferJob,
  TransferLockedRule,
  TransferPlan,
  TransferPolicy,
  TransferPolicySource,
  TransferPresetHints,
  TransferResourceDescriptor,
  TransferResultSummary,
  TransferRowResult,
  TransferSavedPreset,
  TransferUndoStep,
  TransferWarningClass,
} from '@aglyn/aglyn/data-transfer'
import type {
  PicklistSpec,
  PicklistValueSet,
} from '@aglyn/aglyn/app-utils/picklists'

/*------------------------------------------
 * Fields and preferences
 *-----------------------------------------*/

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
  /** The match keys used when the person has not chosen (a prefix of `matchKeys` by default). */
  defaultMatchKeys?: string[]
  presetHints?: TransferPresetHints
  /** The owning plugin's rules, shown locked with their reasons. */
  locked: TransferLockedRule[]
  /** Other products' header spellings, from the owning plugin. */
  dictionaries?: TransferAliasDictionary[]
  prefs: TransferPrefs
  /** Whether the person may create a custom field from the mapping step. */
  canCreateCustomField?: boolean
}

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

export type TransferDelimiter = ',' | ';' | '\t' | '|'

export interface TransferUploadRequest {
  resource: string
  fileName: string
  /** The file decoded with `settings.encoding`. */
  text: string
  /** The size of the file as chosen, in bytes. */
  bytes: number
  settings: TransferFileSettings
}

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

export interface TransferAnalyzeRequest extends Partial<TransferReadChoices> {
  jobId: string
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

/** A picklist column against the organization's list. */
export interface TransferPicklistReview {
  fieldId: string
  spec: PicklistSpec
  set: PicklistValueSet
  result: PicklistMatchResult
}

/** A lookup column's values that name no record. */
export interface TransferLookupReview {
  fieldId: string
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
  /** Some rows of each outcome, for the lists; `rows` may be a sample of a large file. */
  rows: TransferMatchRowView[]
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
  picklists?: TransferPicklistReview[]
  lookups?: TransferLookupReview[]
  /** Present once match keys were sent. */
  matches?: TransferMatchReview
  /** Record id → a name for it. */
  recordLabels?: Record<string, string>
}

/*------------------------------------------
 * Plan (the dry run) and conflicts
 *-----------------------------------------*/

export interface TransferPlanRequest extends TransferReadChoices {
  jobId: string
  policy: TransferPolicy
  /** What a plugin's extra wizard steps collected (a consent attestation). */
  extras?: Record<string, unknown>
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

export interface TransferPlanResponse {
  job: TransferJob
  plan: TransferPlan
  conflicts: TransferConflict[]
  ambiguous: TransferAmbiguity[]
  recordLabels?: Record<string, string>
}

/*------------------------------------------
 * Apply, results and undo
 *-----------------------------------------*/

export interface TransferApplyRequest {
  jobId: string
  /** The warning classes the person acknowledged; the server refuses without every one. */
  acknowledged: TransferWarningClass[]
}

/** One chunk applied. The browser calls again until `done`. */
export interface TransferApplyStep {
  job: TransferJob
  /** This chunk's results. */
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

/** A record edited since the import, which undo would otherwise overwrite. */
export interface TransferUndoConflict {
  recordId: string
  label?: string
  step: Extract<TransferUndoStep, { action: 'conflict' }>
  /** The values the record holds now, for the fields in question. */
  current: Record<string, unknown>
}

/** For each conflicted record: keep what it holds now, or restore it anyway. */
export type TransferUndoResolution = 'keep' | 'restore'

export interface TransferUndoRequest {
  jobId: string
  /** `preview` says what undo would do; `apply` does it. */
  mode: 'preview' | 'apply'
  /** Record id → choice, for every conflict the preview listed. */
  resolutions?: Record<string, TransferUndoResolution>
}

export interface TransferUndoResponse {
  job: TransferJob
  restore: number
  delete: number
  nothing: number
  conflicts: TransferUndoConflict[]
}

/*------------------------------------------
 * Export
 *-----------------------------------------*/

export type TransferExportScopeKind = 'selection' | 'filter' | 'all'

export type TransferExportScope =
  | { kind: 'selection'; ids: string[] }
  | { kind: 'filter'; filter: unknown }
  | { kind: 'all' }

export interface TransferExportRequest {
  resource: string
  fieldIds: string[]
  scope: TransferExportScope
  format: TransferFormat
  bom: boolean
}

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
 * The server, as the kit sees it. The job engine (AGL-3524) implements it
 * over `api/transfer/*`; {@link createMemoryTransferClient} implements it
 * in memory.
 */
export interface TransferClient {
  /** The resource's fields, match keys, locked rules and the person's preferences. */
  fields(request: { resource: string }): Promise<TransferResourceInfo>
  /** Stores the file as a new draft job. */
  upload(request: TransferUploadRequest): Promise<TransferJob>
  /** Reads the job's file: header proposals, then — given choices — values and matches. */
  analyze(request: TransferAnalyzeRequest): Promise<TransferAnalysis>
  /** The dry run: every row planned under the choices, nothing written. */
  plan(request: TransferPlanRequest): Promise<TransferPlanResponse>
  /** Writes the next chunk of a planned job. */
  apply(request: TransferApplyRequest): Promise<TransferApplyStep>
  /** The job as stored. */
  status(request: { jobId: string }): Promise<TransferJob>
  /** Every row's result. */
  results(request: { jobId: string }): Promise<TransferResults>
  /** Previews or runs the undo of an applied job. */
  undo(request: TransferUndoRequest): Promise<TransferUndoResponse>
  /** Writes the chosen fields of the chosen records to a file. */
  export(request: TransferExportRequest): Promise<TransferExportResponse>
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
