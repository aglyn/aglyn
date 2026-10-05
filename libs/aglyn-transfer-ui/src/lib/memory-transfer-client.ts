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
 * AN IN-MEMORY TRANSFER CLIENT — the whole job engine, with no server.
 *
 * Runs the same core the job engine runs (header matching, derivations,
 * picklist resolution, record matching, the plan, chunked apply with undo
 * snapshots) over records held in memory. The kit's specs and stories drive
 * the wizard and the export dialog through it; a surface can also use it to
 * show the wizard before its resource has a server half.
 *=========================================*/

import { escapeCsvCell } from '@aglyn/aglyn/app-utils/csv'
import {
  TRANSFER_CHUNK_ROWS,
  buildMatchLookup,
  buildTransferFieldCatalog,
  buildTransferPlan,
  canApplyTransferPlan,
  collectPicklistValues,
  createTransferPolicy,
  customTransferField,
  deriveDate,
  deriveTransferCell,
  isBlankTransferValue,
  isTransferFieldWritable,
  mapTransferRow,
  matchHeaders,
  matchPicklistValues,
  matchRows,
  planTransferUndo,
  resolveFieldPolicy,
  resolvePicklistCell,
  resolvePicklistChoices,
  resolveMultiPicklistCell,
  summarizeMatches,
  summarizeTransferResults,
  textSimilarity,
  transferChunkRanges,
  transitionTransferJob,
  applyFieldPolicy,
  transferValuesEqual,
} from '@aglyn/aglyn/data-transfer'
import type {
  FieldDerivation,
  FieldProblem,
  MatchKeySpec,
  PicklistResolution,
  PlannedTransferRow,
  RowMatchOutcome,
  TransferAliasDictionary,
  TransferCatalogInput,
  TransferField,
  TransferJob,
  TransferJobStatus,
  TransferLockedRule,
  TransferPlan,
  TransferPlanRow,
  TransferPresetHints,
  TransferResourceDescriptor,
  TransferRowNote,
  TransferRowResult,
  TransferUndoEntry,
} from '@aglyn/aglyn/data-transfer'
import { picklistLabelKey } from '@aglyn/aglyn/app-utils/picklists'
import type {
  PicklistSpec,
  PicklistValueSet,
} from '@aglyn/aglyn/app-utils/picklists'

import type {
  TransferAnalysis,
  TransferAnalyzeRequest,
  TransferClient,
  TransferConflict,
  TransferDerivationSummary,
  TransferExportRequest,
  TransferFileSettings,
  TransferLookupReview,
  TransferPicklistReview,
  TransferPlanRequest,
  TransferPrefs,
  TransferReadChoices,
  TransferUndoConflict,
} from './transfer-client'
import { parseTransferText } from './transfer-file'

/** A record the memory client holds. */
export interface MemoryTransferRecord {
  id: string
  values: Record<string, unknown>
}

/** A record a lookup field may name. */
export interface MemoryLookupRecord {
  id: string
  label: string
  values: Record<string, unknown>
}

export interface MemoryTransferClientOptions {
  resource: TransferResourceDescriptor
  catalog: TransferCatalogInput
  matchKeys: MatchKeySpec[]
  defaultMatchKeys?: string[]
  presetHints?: TransferPresetHints
  locked?: TransferLockedRule[]
  dictionaries?: TransferAliasDictionary[]
  /** Picklist id → the list's spec and the organization's values. */
  picklists?: Record<string, { spec: PicklistSpec; set: PicklistValueSet }>
  records?: MemoryTransferRecord[]
  /** Lookup target resource key → the records a lookup may name. */
  lookupTargets?: Record<string, MemoryLookupRecord[]>
  /** A name for a record, for lists; defaults to its first text value. */
  recordLabel?: (record: MemoryTransferRecord) => string
  prefs?: TransferPrefs
  /** Rows per applied chunk; default {@link TRANSFER_CHUNK_ROWS}. */
  chunkRows?: number
  /** Row index → a message the apply step fails that row with. */
  applyFailures?: Record<number, string>
  canCreateCustomField?: boolean
  now?: () => number
}

interface MemoryJobState {
  job: TransferJob
  text: string
  settings: TransferFileSettings
  plan?: TransferPlan
  choices?: TransferReadChoices
  picklistResolutions?: Map<string, PicklistResolution>
  results: TransferRowResult[]
  undo: TransferUndoEntry[]
}

/** The memory client, with its records exposed for a spec to read. */
export interface MemoryTransferClient extends TransferClient {
  readonly records: Map<string, MemoryTransferRecord>
  readonly lookupTargets: Record<string, MemoryLookupRecord[]>
}

const clone = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)

const SAMPLES = 5

/** A client that keeps everything in memory (see the block header). */
export function createMemoryTransferClient(
  options: MemoryTransferClientOptions,
): MemoryTransferClient {
  const now = options.now ?? (() => Date.now())
  const records = new Map(
    (options.records ?? []).map((record) => [record.id, clone(record)]),
  )
  const lookupTargets = clone(options.lookupTargets ?? {})
  const picklists = clone(options.picklists ?? {})
  const custom = [...(options.catalog.custom ?? [])]
  let prefs: TransferPrefs = clone(options.prefs ?? { presets: [] })
  const jobs = new Map<string, MemoryJobState>()
  let nextJob = 1
  let nextRecord = 1

  const catalog = () =>
    buildTransferFieldCatalog({ ...options.catalog, custom })
  const fieldsById = () => catalog().byId
  const label = (record: MemoryTransferRecord): string => {
    if (options.recordLabel) return options.recordLabel(record)
    const text = Object.values(record.values).find(
      (value) => typeof value === 'string' && value.trim(),
    )
    return typeof text === 'string' ? text : record.id
  }
  const recordLabels = (ids: Iterable<string>): Record<string, string> => {
    const labels: Record<string, string> = {}
    for (const id of ids) {
      const record = records.get(id)
      if (record) labels[id] = label(record)
    }
    return labels
  }
  const state = (jobId: string): MemoryJobState => {
    const found = jobs.get(jobId)
    if (!found) throw new Error(`No import "${jobId}".`)
    return found
  }
  const move = (
    entry: MemoryJobState,
    to: TransferJobStatus,
    patch: Partial<TransferJob> = {},
  ): void => {
    entry.job =
      entry.job.status === to &&
      to !== 'applying' &&
      to !== 'analyzed' &&
      to !== 'planned'
        ? { ...entry.job, ...patch, updatedAt: now() }
        : transitionTransferJob(entry.job, to, now(), patch)
  }
  const parsed = (entry: MemoryJobState) =>
    parseTransferText(entry.text, entry.settings)
  const keySpecs = (ids: readonly string[] | undefined): MatchKeySpec[] =>
    (
      ids ??
      options.defaultMatchKeys ??
      options.matchKeys.map((key) => key.fieldId)
    )
      .map((id) => options.matchKeys.find((key) => key.fieldId === id))
      .filter((key): key is MatchKeySpec => Boolean(key))

  /** Every row read under the choices: values, derivations, problems and notes. */
  const readRows = (entry: MemoryJobState, choices: TransferReadChoices) => {
    const byId = fieldsById()
    const file = parsed(entry)
    const resolutions = new Map<string, PicklistResolution>()
    const reviews: TransferPicklistReview[] = []
    const lookups: TransferLookupReview[] = []
    const mapped = Object.values(choices.mapping)
      .map((fieldId) => byId.get(fieldId))
      .filter((field): field is TransferField => Boolean(field))

    const rows: (TransferPlanRow & { cells: Record<string, unknown> })[] =
      file.rows.map((cells, index) => {
        const raw = mapTransferRow(cells, choices.mapping)
        const values: Record<string, unknown> = {}
        const derivations: FieldDerivation[] = []
        const problems: FieldProblem[] = []
        for (const [fieldId, cell] of Object.entries(raw)) {
          const field = byId.get(fieldId)
          if (!field) continue
          const order = choices.dateOrders?.[fieldId]
          const result = deriveTransferCell(
            field,
            cell,
            order ? { date: { order }, dateTime: { order } } : {},
          )
          if (!result.ok) {
            problems.push({
              fieldId,
              raw: String(cell ?? ''),
              ...result.problem!,
            })
            continue
          }
          values[fieldId] = result.value
          for (const derivation of result.derivations)
            derivations.push({ fieldId, ...derivation })
        }
        return { index, values, derivations, problems, notes: [], cells: raw }
      })

    for (const field of mapped) {
      if (field.type !== 'picklist' && field.type !== 'multiPicklist') continue
      const list = field.picklistId ? picklists[field.picklistId] : undefined
      if (!list) continue
      const incoming = collectPicklistValues(
        rows.map((row) => ({ row: row.index, value: row.values[field.id] })),
      )
      const result = matchPicklistValues(list.set, incoming)
      reviews.push({
        fieldId: field.id,
        spec: list.spec,
        set: list.set,
        result,
      })
      const resolution = resolvePicklistChoices(
        list.spec,
        list.set,
        result,
        choices.picklistChoices?.[field.id] ?? {},
      )
      resolutions.set(field.id, resolution)
      for (const row of rows) {
        const value = row.values[field.id]
        if (isBlankTransferValue(value)) continue
        const notes = row.notes as TransferRowNote[]
        const unmatched = (raw: unknown) =>
          result.unmatched.find((entry) => entry.key === picklistLabelKey(raw))
        if (Array.isArray(value)) {
          const outcome = resolveMultiPicklistCell(resolution, value)
          for (const item of value) {
            const miss = unmatched(item)
            if (!miss) continue
            const choice = choices.picklistChoices?.[field.id]?.[miss.key]
            notes.push({
              class:
                choice?.action === 'addValue'
                  ? 'newPicklistValue'
                  : 'unmatchedPicklist',
              fieldId: field.id,
              value: String(item),
              refuse: outcome.kind === 'refuse',
            })
          }
          ;(row.values as Record<string, unknown>)[field.id] =
            outcome.kind === 'values' ? outcome.labels : null
        } else {
          const outcome = resolvePicklistCell(resolution, value)
          const miss = unmatched(value)
          if (miss) {
            const choice = choices.picklistChoices?.[field.id]?.[miss.key]
            notes.push({
              class:
                choice?.action === 'addValue'
                  ? 'newPicklistValue'
                  : 'unmatchedPicklist',
              fieldId: field.id,
              value: String(value),
              refuse: outcome.kind === 'refuse',
            })
          }
          ;(row.values as Record<string, unknown>)[field.id] =
            outcome.kind === 'value' ? outcome.label : null
        }
      }
    }

    for (const field of mapped) {
      if (field.type !== 'lookup' || !field.lookup) continue
      const targets = lookupTargets[field.lookup.resource] ?? []
      const by = field.lookup.by
      const find = (value: string) =>
        targets.find((target) =>
          by.some(
            (key) =>
              String(target.values[key] ?? '')
                .trim()
                .toLowerCase() === value.toLowerCase(),
          ),
        )
      const unresolved = new Map<
        string,
        TransferLookupReview['unresolved'][number]
      >()
      for (const row of rows) {
        const value = row.values[field.id]
        if (isBlankTransferValue(value)) continue
        const text = String(value).trim()
        const target = find(text)
        if (target) {
          ;(row.values as Record<string, unknown>)[field.id] = target.id
          continue
        }
        const key = text.toLowerCase()
        const seen = unresolved.get(key)
        if (seen) {
          seen.count += 1
          if (seen.rows.length < SAMPLES) seen.rows.push(row.index)
        } else {
          unresolved.set(key, {
            value: text,
            key,
            count: 1,
            rows: [row.index],
            suggestions: targets
              .map((candidate) => ({
                recordId: candidate.id,
                label: candidate.label,
                score: textSimilarity(text, candidate.label),
              }))
              .filter((candidate) => candidate.score >= 0.6)
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .map(({ recordId, label: name }) => ({ recordId, label: name })),
          })
        }
        const choice = choices.lookupChoices?.[field.id]?.[key]
        if (choice?.action === 'mapTo')
          (row.values as Record<string, unknown>)[field.id] = choice.recordId
        else if (choice?.action === 'create')
          (row.values as Record<string, unknown>)[field.id] = `new:${text}`
        else (row.values as Record<string, unknown>)[field.id] = null
        ;(row.notes as TransferRowNote[]).push({
          class: 'unresolvedLookup',
          fieldId: field.id,
          value: text,
          refuse: choice?.action === 'refuseRow',
          detail:
            choice?.action === 'create'
              ? 'Created'
              : choice?.action === 'mapTo'
                ? 'Mapped'
                : undefined,
        })
      }
      lookups.push({ fieldId: field.id, unresolved: [...unresolved.values()] })
    }

    return { file, rows, reviews, lookups, resolutions }
  }

  const summarizeDerivations = (
    rows: ReturnType<typeof readRows>['rows'],
    mapping: Record<number, string>,
  ): TransferDerivationSummary[] => {
    const byId = fieldsById()
    return [...new Set(Object.values(mapping))]
      .map((fieldId) => byId.get(fieldId))
      .filter((field): field is TransferField => Boolean(field))
      .map((field) => {
        const summary: TransferDerivationSummary = {
          fieldId: field.id,
          filled: 0,
          unchanged: 0,
          derivations: [],
          problems: [],
          ambiguousDates: 0,
        }
        for (const row of rows) {
          const raw = row.cells[field.id]
          if (isBlankTransferValue(raw)) continue
          summary.filled += 1
          const own = (row.derivations ?? []).filter(
            (entry) => entry.fieldId === field.id,
          )
          const problems = (row.problems ?? []).filter(
            (entry) => entry.fieldId === field.id,
          )
          if (!own.length && !problems.length) summary.unchanged += 1
          for (const entry of own) {
            const tally = summary.derivations.find(
              (count) => count.kind === entry.kind,
            )
            if (tally) {
              tally.count += 1
              tally.flagged ||= entry.flagged
              if (tally.samples.length < SAMPLES)
                tally.samples.push({
                  row: row.index,
                  from: entry.from,
                  to: entry.to,
                })
            } else {
              summary.derivations.push({
                kind: entry.kind,
                note: entry.note,
                count: 1,
                flagged: entry.flagged,
                samples: [{ row: row.index, from: entry.from, to: entry.to }],
              })
            }
          }
          for (const entry of problems) {
            const tally = summary.problems.find(
              (count) => count.code === entry.code,
            )
            if (tally) {
              tally.count += 1
              if (tally.samples.length < SAMPLES)
                tally.samples.push({ row: row.index, raw: entry.raw })
            } else {
              summary.problems.push({
                code: entry.code,
                message: entry.message,
                count: 1,
                samples: [{ row: row.index, raw: entry.raw }],
              })
            }
          }
          if (
            (field.type === 'date' || field.type === 'datetime') &&
            deriveDate(raw).derivations.some(
              (entry) => entry.kind === 'ambiguousDate',
            )
          ) {
            summary.ambiguousDates += 1
          }
        }
        return summary
      })
  }

  const matchesFor = (
    rows: readonly TransferPlanRow[],
    keys: MatchKeySpec[],
  ) => {
    const lookup = buildMatchLookup(records.values(), keys)
    return matchRows(
      rows.map((row) => row.values),
      keys,
      lookup,
    )
  }

  const client: MemoryTransferClient = {
    records,
    lookupTargets,

    async fields() {
      const built = catalog()
      return clone({
        resource: options.resource,
        fields: built.fields,
        groups: built.groups,
        matchKeys: options.matchKeys,
        ...(options.defaultMatchKeys
          ? { defaultMatchKeys: options.defaultMatchKeys }
          : {}),
        ...(options.presetHints ? { presetHints: options.presetHints } : {}),
        locked: options.locked ?? [],
        ...(options.dictionaries ? { dictionaries: options.dictionaries } : {}),
        prefs,
        canCreateCustomField: Boolean(options.canCreateCustomField),
      })
    },

    async upload(request) {
      const limit = options.resource.limits?.maxBytes
      if (limit && request.bytes > limit)
        throw new Error('This file is larger than this import allows.')
      const id = `job-${nextJob++}`
      const at = now()
      const file = parseTransferText(request.text, request.settings)
      if (file.error) throw new Error(file.error)
      const job: TransferJob = {
        id,
        resource: request.resource,
        kind: 'records',
        direction: 'import',
        format: request.settings.format,
        status: 'draft',
        orgId: 'memory',
        createdBy: 'memory',
        createdAt: at,
        updatedAt: at,
        fileName: request.fileName,
        rowCount: file.rows.length,
      }
      jobs.set(id, {
        job,
        text: request.text,
        settings: request.settings,
        results: [],
        undo: [],
      })
      return clone(job)
    },

    async analyze(request: TransferAnalyzeRequest) {
      const entry = state(request.jobId)
      const file = parsed(entry)
      const built = catalog()
      const analysis: TransferAnalysis = {
        job: entry.job,
        headers: file.headers,
        sampleRows: file.rows.slice(0, 20),
        rowCount: file.rows.length,
        proposal: matchHeaders(file.headers, built.fields, {
          dictionaries: options.dictionaries,
          samples: file.rows.slice(0, 50),
        }),
      }
      if (request.mapping) {
        const choices: TransferReadChoices = {
          ...request,
          mapping: request.mapping,
        }
        const read = readRows(entry, choices)
        analysis.derivations = summarizeDerivations(read.rows, request.mapping)
        analysis.picklists = read.reviews
        analysis.lookups = read.lookups
        const keys = keySpecs(request.matchKeys)
        const outcomes = matchesFor(read.rows, keys)
        const ids = new Set<string>()
        for (const outcome of outcomes) {
          if (outcome.kind === 'matched') ids.add(outcome.recordId)
          if (outcome.kind === 'ambiguous')
            outcome.recordIds.forEach((id) => ids.add(id))
        }
        analysis.matches = {
          keys,
          summary: summarizeMatches(outcomes),
          rows: outcomes.map((outcome, index) => ({
            row: index,
            outcome,
            label: rowLabel(read.rows[index]?.values),
          })),
        }
        analysis.recordLabels = recordLabels(ids)
        move(entry, 'analyzed', {
          mapping: request.mapping,
          matchKeys: keys.map((key) => key.fieldId),
        })
      } else if (entry.job.status === 'draft') {
        move(entry, 'analyzed')
      }
      analysis.job = entry.job
      return clone(analysis)
    },

    async plan(request: TransferPlanRequest) {
      const entry = state(request.jobId)
      const read = readRows(entry, request)
      const keys = keySpecs(request.matchKeys)
      const outcomes = matchesFor(read.rows, keys)
      const policy = createTransferPolicy({
        ...request.policy,
        locked: options.locked ?? [],
      })
      const existing = new Map(
        [...records.values()].map((record) => [record.id, record.values]),
      )
      const built = catalog()
      const plan = buildTransferPlan({
        fields: built.fields,
        rows: read.rows,
        matches: outcomes,
        existing,
        policy,
      })
      const conflicts: TransferConflict[] = []
      const ids = new Set<string>()
      outcomes.forEach((outcome: RowMatchOutcome, index) => {
        const row = read.rows[index]!
        const chosen = policy.rows[index]?.recordId
        const recordId =
          chosen ?? (outcome.kind === 'matched' ? outcome.recordId : null)
        if (outcome.kind === 'ambiguous')
          outcome.recordIds.forEach((id) => ids.add(id))
        if (!recordId) return
        ids.add(recordId)
        const record = records.get(recordId)
        if (!record) return
        const fields = Object.entries(row.values).flatMap(
          ([fieldId, incoming]) => {
            const field = built.byId.get(fieldId)
            if (!field || !isTransferFieldWritable(field)) return []
            const before = record.values[fieldId]
            if (
              isBlankTransferValue(incoming) ||
              isBlankTransferValue(before) ||
              transferValuesEqual(before, incoming)
            )
              return []
            const resolved = resolveFieldPolicy(policy, index, field)
            return [
              {
                fieldId,
                before,
                incoming,
                after: applyFieldPolicy(resolved, before, incoming).after,
                mode: resolved.mode,
                source: resolved.source,
              },
            ]
          },
        )
        if (fields.length) conflicts.push({ row: index, recordId, fields })
      })
      entry.plan = plan
      entry.choices = { ...request }
      if (entry.job.status === 'draft') move(entry, 'analyzed')
      entry.picklistResolutions = read.resolutions
      move(entry, 'planned', {
        policy: request.policy,
        summary: plan.summary,
        mapping: request.mapping,
        matchKeys: keys.map((key) => key.fieldId),
      })
      return clone({
        job: entry.job,
        plan,
        conflicts,
        ambiguous: outcomes.flatMap((outcome, index) =>
          outcome.kind === 'ambiguous'
            ? [{ row: index, via: outcome.via, recordIds: outcome.recordIds }]
            : [],
        ),
        recordLabels: recordLabels(ids),
      })
    },

    async apply(request) {
      const entry = state(request.jobId)
      const plan = entry.plan
      if (!plan) throw new Error('This import has not been planned.')
      if (
        entry.job.status === 'planned' &&
        !canApplyTransferPlan(plan, request.acknowledged)
      ) {
        throw new Error(
          'Every warning must be acknowledged before this import is applied.',
        )
      }
      if (entry.job.status === 'planned') {
        // Values the person chose to add go into the organization's lists before any row names them.
        for (const [fieldId, resolution] of entry.picklistResolutions ?? []) {
          const picklistId = fieldsById().get(fieldId)?.picklistId
          if (picklistId && picklists[picklistId] && resolution.added.length)
            picklists[picklistId].set = resolution.set
        }
      }
      const ranges = transferChunkRanges(
        plan.rows.length,
        options.chunkRows ?? TRANSFER_CHUNK_ROWS,
      )
      const cursor = entry.job.cursor ?? { chunk: 0, rowsDone: 0 }
      const range = ranges[cursor.chunk]
      if (!range) {
        move(entry, 'applied')
        return clone({
          job: entry.job,
          results: [],
          rowsDone: plan.rows.length,
          rowCount: plan.rows.length,
          done: true,
        })
      }
      move(entry, 'applying', { acknowledged: request.acknowledged })
      const results = plan.rows
        .slice(range.start, range.end)
        .map((row) => applyRow(entry, row))
      entry.results.push(...results)
      const next = { chunk: cursor.chunk + 1, rowsDone: range.end }
      const done = next.chunk >= ranges.length
      move(entry, 'applying', { cursor: next, chunkCount: ranges.length })
      if (done) move(entry, 'applied')
      return clone({
        job: entry.job,
        results,
        rowsDone: range.end,
        rowCount: plan.rows.length,
        done,
      })
    },

    async status({ jobId }) {
      return clone(state(jobId).job)
    },

    async results({ jobId }) {
      const entry = state(jobId)
      return clone({
        job: entry.job,
        summary: summarizeTransferResults(entry.results),
        rows: entry.results,
      })
    },

    async undo(request) {
      const entry = state(request.jobId)
      let restore = 0
      let remove = 0
      let nothing = 0
      const conflicts: TransferUndoConflict[] = []
      for (const undo of entry.undo) {
        const record = records.get(undo.recordId)
        const step = planTransferUndo(undo, record?.values ?? null)
        if (step.action === 'conflict') {
          const current: Record<string, unknown> = {}
          for (const fieldId of step.fields)
            current[fieldId] = record?.values[fieldId] ?? null
          conflicts.push({
            recordId: undo.recordId,
            ...(record ? { label: label(record) } : {}),
            step,
            current,
          })
          if (
            request.mode === 'apply' &&
            request.resolutions?.[undo.recordId] === 'restore'
          ) {
            if (undo.action === 'created') records.delete(undo.recordId)
            else if (record) Object.assign(record.values, step.values)
          }
          continue
        }
        if (step.action === 'nothing') nothing += 1
        if (step.action === 'restore') {
          restore += 1
          if (request.mode === 'apply' && record)
            Object.assign(record.values, step.values)
        }
        if (step.action === 'delete') {
          remove += 1
          if (request.mode === 'apply') records.delete(undo.recordId)
        }
      }
      if (request.mode === 'apply') {
        const unresolved = conflicts.filter(
          (conflict) => !request.resolutions?.[conflict.recordId],
        )
        if (unresolved.length)
          throw new Error(
            'Choose what to do with every record edited since the import.',
          )
        move(entry, 'undone')
      }
      return clone({
        job: entry.job,
        restore,
        delete: remove,
        nothing,
        conflicts,
      })
    },

    async export(request: TransferExportRequest) {
      const byId = fieldsById()
      const all = [...records.values()]
      const chosen =
        request.scope.kind === 'selection'
          ? all.filter((record) =>
              (request.scope as { ids: string[] }).ids.includes(record.id),
            )
          : request.scope.kind === 'filter' &&
              typeof request.scope.filter === 'function'
            ? all.filter(
                request.scope.filter as (
                  record: MemoryTransferRecord,
                ) => boolean,
              )
            : all
      const valueOf = (
        record: MemoryTransferRecord,
        fieldId: string,
      ): unknown =>
        fieldId === 'id' ? record.id : (record.values[fieldId] ?? null)
      let body: string
      if (request.format === 'csv') {
        const cell = (value: unknown): string =>
          escapeCsvCell(
            value === null || value === undefined
              ? ''
              : Array.isArray(value)
                ? value.join(', ')
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value),
          )
        const lines = [
          request.fieldIds
            .map((id) => cell(byId.get(id)?.label ?? id))
            .join(','),
          ...chosen.map((record) =>
            request.fieldIds.map((id) => cell(valueOf(record, id))).join(','),
          ),
        ]
        body = `${request.bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`
      } else {
        const objects = chosen.map((record) =>
          Object.fromEntries(
            request.fieldIds.map((id) => [id, valueOf(record, id)]),
          ),
        )
        body =
          request.format === 'json'
            ? JSON.stringify(objects, null, 2)
            : objects.map((object) => JSON.stringify(object)).join('\n') + '\n'
      }
      const type =
        request.format === 'csv'
          ? 'text/csv'
          : request.format === 'json'
            ? 'application/json'
            : 'application/x-ndjson'
      return {
        fileName: `${request.resource}.${request.format}`,
        rowCount: chosen.length,
        body: new Blob([body], { type }),
      }
    },

    async savePrefs(request) {
      prefs = {
        ...prefs,
        ...clone(request.prefs),
        presets: clone(request.prefs.presets ?? prefs.presets),
      }
      return clone(prefs)
    },

    ...(options.canCreateCustomField
      ? {
          async createCustomField(request: {
            label: string
            type: TransferField['type']
          }) {
            const key =
              request.label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_|_$/g, '') || `field_${custom.length + 1}`
            const definition = { key, label: request.label, type: request.type }
            custom.push(definition)
            return customTransferField(definition)
          },
        }
      : {}),
  }

  function rowLabel(
    values: Readonly<Record<string, unknown>> | undefined,
  ): string | undefined {
    if (!values) return undefined
    const text = Object.values(values).find(
      (value) => typeof value === 'string' && value.trim(),
    )
    return typeof text === 'string' ? text : undefined
  }

  function applyRow(
    entry: MemoryJobState,
    row: PlannedTransferRow,
  ): TransferRowResult {
    const failure = options.applyFailures?.[row.index]
    if (failure && (row.verdict === 'create' || row.verdict === 'update')) {
      return { row: row.index, outcome: 'failed', message: failure }
    }
    const written: Record<string, unknown> = {}
    for (const change of row.diff) written[change.fieldId] = change.after
    if (row.verdict === 'create') {
      const id = `rec-new-${nextRecord++}`
      records.set(id, { id, values: clone(written) })
      entry.undo.push({
        row: row.index,
        recordId: id,
        action: 'created',
        written,
      })
      return { row: row.index, outcome: 'created', recordId: id }
    }
    if (row.verdict === 'update' && row.recordId) {
      const record = records.get(row.recordId)
      if (!record)
        return {
          row: row.index,
          outcome: 'failed',
          recordId: row.recordId,
          message: 'The record no longer exists.',
        }
      const previous: Record<string, unknown> = {}
      for (const change of row.diff)
        previous[change.fieldId] = record.values[change.fieldId] ?? null
      Object.assign(record.values, clone(written))
      entry.undo.push({
        row: row.index,
        recordId: row.recordId,
        action: 'updated',
        previous,
        written,
        modes: Object.fromEntries(
          row.diff.map((change) => [change.fieldId, change.mode]),
        ),
      })
      return { row: row.index, outcome: 'updated', recordId: row.recordId }
    }
    if (row.verdict === 'unchanged')
      return {
        row: row.index,
        outcome: 'unchanged',
        ...(row.recordId ? { recordId: row.recordId } : {}),
      }
    if (row.verdict === 'skip')
      return {
        row: row.index,
        outcome: 'skipped',
        ...(row.reason ? { reason: row.reason } : {}),
      }
    return {
      row: row.index,
      outcome: 'failed',
      ...(row.reason ? { reason: row.reason } : {}),
    }
  }

  return client
}
