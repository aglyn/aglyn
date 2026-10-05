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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  buildMatchLookup,
  buildTransferPlan,
  isBlankTransferValue,
  matchLookupKey,
  planTransferUndo,
  TRANSFER_ID_FIELD,
  transferValuesEqual,
  withTransferResourceFindings,
  type BuildTransferPlanInput,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferFieldMode,
  type TransferPlan,
  type TransferResourceFinding,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferReadOptions,
  TransferRecordsHooks,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import {
  eventStatusOf,
  eventWrite,
  eventWriteProblem,
  type EventStatus,
  type EventWrite,
  type EventWriteInput,
} from '../model/event-write'
import {
  EVENT_CONTENT_FIELD_IDS,
  EVENTS_ALIASES,
  EVENTS_CATALOG,
  EVENTS_MATCH_KEYS,
} from './events-transfer-catalog'

/**
 * THE `events` TRANSFER RESOURCE: a site's calendar events, exported and
 * imported as records.
 *
 * Every write goes through `eventWrite` (`model/event-write.ts`), the rule
 * the Events page's editor stores through, so an imported event holds
 * exactly what the editor would have stored for the same values: the title
 * cut to its cap, an end not after the start replaced by start + one hour,
 * the cover description dropped without a cover. The editor's other check
 * is the shell's: the page only opens for a workspace holding the Event
 * Calendar add-on, and the transfer routes refuse every step for one that
 * does not (the declaration's `featureFlag`, AGL-3548).
 *
 * A host resource: events live under `hosts/{hostId}/events` and carry no
 * `visibleTo`. The transfer routes gate the site (`data.manage` on it), so
 * `scopeTokens` does not narrow a read here — a reader who reached the site
 * reads its events, as the Events page does.
 *
 * A deleted event (`deletedAt`, `status: 'deleted'`) is not an event: it is
 * never exported, counted or matched.
 */

/** What the resource needs; the console's declarations pass the Admin SDK's. */
export interface EventsTransferDeps {
  firestore: FirebaseFirestore.Firestore
  /** The SDK's field-delete sentinel (`FieldValue.delete()`). */
  deleteField(): unknown
  /** A stored timestamp for `ms` (`Timestamp.fromMillis`). */
  timestamp(ms: number): unknown
  /**
   * Throws the transfer's plan refusal for a workspace without the Event
   * Calendar add-on (AGL-3548). The transfer gate refuses every step for it
   * already (`featureFlag: "eventCalendar"`); `apply` asks again for the
   * sweep that resumes an import without the gate.
   */
  requireEntitled(orgId: string): Promise<void>
  now?(): number
  /** A new event id; `createResourceUid`, like the editor. */
  createId?(): string
}

/** Rows one page of a read answers when the export does not say. */
const READ_PAGE_ROWS = 500
/** Events one lookup scan reads at a time. */
const SCAN_PAGE_ROWS = 500
/** Documents one `getAll` reads. */
const GET_ALL_SLICE = 300
/** Time an event write needs; `apply` stops at a row boundary below it. */
const APPLY_ROW_RESERVE_MS = 1_500

type Data = Record<string, unknown>
type Values = Record<string, unknown>

function requireHost(ctx: TransferResourceContext): string {
  if (!ctx.hostId)
    throw new Error('Events belong to a site; no site was given.')
  return ctx.hostId
}

/** Whether a stored event was deleted (either half of the delete's write). */
export function isDeletedEvent(data: Data | null | undefined): boolean {
  return !data || Boolean(data['deletedAt']) || data['status'] === 'deleted'
}

function isoOfMs(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value).toISOString()
    : null
}

/** A stored timestamp (Admin or client `Timestamp`, `Date`, epoch ms) as ISO. */
function isoOfTimestamp(value: unknown): string | null {
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return isoOfMs((value as { toMillis(): number }).toMillis())
  }
  if (value instanceof Date) return isoOfMs(value.getTime())
  return isoOfMs(value)
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * A stored event as field values: what an export writes, what a match
 * compares and what undo checks. The title leads, so a row label reads it.
 */
export function eventFieldValues(id: string, data: Data): Values {
  return {
    title: textOf(data['title']),
    startsAt: isoOfMs(data['startsAtMs']),
    endsAt: isoOfMs(data['endsAtMs']),
    location: textOf(data['location']),
    organizer: textOf(data['organizer']),
    description: textOf(data['description']),
    coverImage: textOf(data['coverImage']),
    coverImageAlt: textOf(data['coverImageAlt']),
    // The editor reads a missing status as a draft and saves it as one.
    status: eventStatusOf(data['status']) ?? 'draft',
    createdAt: isoOfTimestamp(data['createdAt']),
    updatedAt: isoOfTimestamp(data['updatedAt']),
    [TRANSFER_ID_FIELD]: id,
  }
}

function msOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** Field values as the shared write rule's input, or why they cannot be written. */
function writeInputOf(values: Values): EventWriteInput | { problem: string } {
  const status: EventStatus | null = isBlankTransferValue(values['status'])
    ? 'draft'
    : eventStatusOf(values['status'])
  if (!status) return { problem: 'Status must be draft or published.' }
  const input: EventWriteInput = {
    title: String(values['title'] ?? ''),
    startsAtMs: msOf(values['startsAt']) ?? 0,
    endsAtMs: msOf(values['endsAt']),
    location: textOf(values['location']),
    organizer: textOf(values['organizer']),
    description: textOf(values['description']),
    coverImage: textOf(values['coverImage']),
    coverImageAlt: textOf(values['coverImageAlt']),
    status,
  }
  const problem = eventWriteProblem(input)
  return problem ? { problem } : input
}

/** The document a write leaves: `data` with the write's fields set and its removals gone. */
function afterWrite(data: Data, write: EventWrite): Data {
  const next: Data = { ...data, ...write.fields }
  for (const key of write.remove) delete next[key]
  return next
}

/** A write as an Admin update: the fields, the removals as deletes, the time. */
function updatePayload(
  deps: EventsTransferDeps,
  write: EventWrite,
  at: unknown,
): Data {
  return {
    ...write.fields,
    ...Object.fromEntries(write.remove.map((key) => [key, deps.deleteField()])),
    updatedAt: at,
  }
}

function pick(values: Values, fieldIds: readonly string[]): Values {
  return Object.fromEntries(
    fieldIds.map((fieldId) => [fieldId, values[fieldId] ?? null]),
  )
}

/** Each planned change's value by field id. */
function changesOf(row: PlannedTransferRow): Values {
  return Object.fromEntries(
    row.diff.map((change) => [change.fieldId, change.after]),
  )
}

/** The site's status filter, the one filter its list can be read by. */
function statusFilterOf(
  filter: TransferReadOptions['filter'],
): EventStatus | null {
  if (!filter) return null
  for (const key of Object.keys(filter)) {
    if (key !== 'status')
      throw new Error(`Events cannot be filtered by "${key}".`)
  }
  if (filter['status'] === undefined || filter['status'] === null) return null
  const status = eventStatusOf(filter['status'])
  if (!status)
    throw new Error('Events can be filtered by status: draft or published.')
  return status
}

function encodeCursor(startsAtMs: number, id: string): string {
  return JSON.stringify([startsAtMs, id])
}

function decodeCursor(cursor: string): [number, string] {
  const parsed: unknown = JSON.parse(cursor)
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'number' ||
    typeof parsed[1] !== 'string'
  ) {
    throw new Error('The events cursor could not be read.')
  }
  return [parsed[0], parsed[1]]
}

/** The resource's hooks: every records hook, `count` and `plan` included. */
export type EventsTransferResource = TransferRecordsHooks &
  Required<Pick<TransferRecordsHooks, 'count' | 'plan'>>

/**
 * The `events` resource over `deps`. Every hook takes the site from
 * `ctx.hostId`.
 */
export function createEventsTransferResource(
  deps: EventsTransferDeps,
): EventsTransferResource {
  const now = deps.now ?? Date.now
  const createId = deps.createId ?? createResourceUid
  const eventsOf = (hostId: string) =>
    deps.firestore.collection('hosts').doc(hostId).collection('events')

  /** Stored events by id; a missing id is absent. */
  async function readByIds(
    hostId: string,
    ids: readonly string[],
  ): Promise<Map<string, Data>> {
    const events = eventsOf(hostId)
    const found = new Map<string, Data>()
    const unique = [
      ...new Set(ids.filter((id) => typeof id === 'string' && id)),
    ]
    for (let at = 0; at < unique.length; at += GET_ALL_SLICE) {
      const refs = unique
        .slice(at, at + GET_ALL_SLICE)
        .map((id) => events.doc(id))
      if (!refs.length) continue
      for (const snapshot of await deps.firestore.getAll(...refs)) {
        if (snapshot.exists)
          found.set(snapshot.id, (snapshot.data() ?? {}) as Data)
      }
    }
    return found
  }

  /**
   * The site's events in list order — newest start first, then id — from
   * the `(status, startsAtMs)` composite. `status in [draft, published]` is
   * "not deleted"; an event deleted before the delete also wrote `status`
   * still carries `deletedAt`, and the reads drop it.
   */
  function listQuery(hostId: string, status: EventStatus | null) {
    const events = eventsOf(hostId)
    const filtered = status
      ? events.where('status', '==', status)
      : events.where('status', 'in', ['draft', 'published'])
    return filtered.orderBy('startsAtMs', 'desc').orderBy('__name__', 'desc')
  }

  /** Every event of the site that is not deleted, by id, read in pages. */
  async function scanEvents(hostId: string): Promise<Map<string, Data>> {
    const all = new Map<string, Data>()
    let after: string | null = null
    for (;;) {
      let page = eventsOf(hostId).orderBy('__name__').limit(SCAN_PAGE_ROWS)
      if (after) page = page.startAfter(after)
      const snapshot = await page.get()
      for (const doc of snapshot.docs) {
        const data = doc.data() as Data
        if (!isDeletedEvent(data)) all.set(doc.id, data)
      }
      if (snapshot.docs.length < SCAN_PAGE_ROWS) return all
      after = snapshot.docs[snapshot.docs.length - 1]?.id ?? null
      if (!after) return all
    }
  }

  async function findings(
    ctx: TransferResourceContext,
    plan: TransferPlan,
    existing: BuildTransferPlanInput['existing'],
  ): Promise<TransferResourceFinding[]> {
    const writes = plan.rows.filter(
      (row) => row.verdict === 'create' || row.verdict === 'update',
    )
    if (!writes.length) return []
    const found: TransferResourceFinding[] = []
    for (const row of writes) {
      const before = (row.recordId ? existing.get(row.recordId) : null) ?? {}
      const changes = changesOf(row)
      const after: Values = { ...before, ...changes }
      if (
        'status' in changes &&
        !isBlankTransferValue(changes['status']) &&
        !eventStatusOf(changes['status'])
      ) {
        found.push({
          row: row.index,
          fieldId: 'status',
          value: String(changes['status']),
          detail: 'Status must be draft or published.',
          refuse: true,
        })
        continue
      }
      const input = writeInputOf(after)
      if ('problem' in input) {
        found.push({ row: row.index, detail: input.problem, refuse: true })
        continue
      }
      if (
        !isBlankTransferValue(after['endsAt']) &&
        (input.endsAtMs ?? 0) <= input.startsAtMs
      ) {
        found.push({
          row: row.index,
          fieldId: 'endsAt',
          value: String(after['endsAt']),
          detail:
            'Ends at or before its start, so it will end one hour after it starts.',
        })
      }
    }
    return found
  }

  return {
    fields: () => EVENTS_CATALOG,
    matchKeys: EVENTS_MATCH_KEYS,
    aliases: EVENTS_ALIASES,

    async count(ctx, options) {
      const hostId = requireHost(ctx)
      const status = statusFilterOf(options.filter)
      if (options.ids) {
        const found = await readByIds(hostId, options.ids)
        return [...found.values()].filter((data) => !isDeletedEvent(data))
          .length
      }
      // Counted by reading, not by an aggregate: the legacy deletes that
      // carry `deletedAt` beside a live status have to be left out, or the
      // export's row count would promise rows the file never holds.
      let total = 0
      let cursor: [number, string] | null = null
      for (;;) {
        let page = listQuery(hostId, status)
          .select('deletedAt', 'startsAtMs')
          .limit(SCAN_PAGE_ROWS)
        if (cursor) page = page.startAfter(...cursor)
        const snapshot = await page.get()
        for (const doc of snapshot.docs) if (!doc.get('deletedAt')) total += 1
        const last = snapshot.docs[snapshot.docs.length - 1]
        if (snapshot.docs.length < SCAN_PAGE_ROWS || !last) return total
        cursor = [Number(last.get('startsAtMs')), last.id]
      }
    },

    async readPage(ctx, cursor, fieldIds, options = {}) {
      const hostId = requireHost(ctx)
      const size = Math.max(
        1,
        Math.min(options.pageSize ?? READ_PAGE_ROWS, READ_PAGE_ROWS),
      )
      if (options.ids) {
        // The selection, in the order it was made, a page of ids at a time.
        const offset = cursor ? Math.max(0, Number(cursor) || 0) : 0
        const ids = options.ids.slice(offset, offset + size)
        const found = await readByIds(hostId, ids)
        const rows = ids
          .filter((id) => found.has(id) && !isDeletedEvent(found.get(id)))
          .map((id) =>
            pick(eventFieldValues(id, found.get(id) as Data), fieldIds),
          )
        return {
          rows,
          next:
            offset + size < options.ids.length ? String(offset + size) : null,
        }
      }
      let page = listQuery(hostId, statusFilterOf(options.filter)).limit(size)
      if (cursor) page = page.startAfter(...decodeCursor(cursor))
      const snapshot = await page.get()
      const rows = snapshot.docs
        .filter((doc) => !isDeletedEvent(doc.data() as Data))
        .map((doc) =>
          pick(eventFieldValues(doc.id, doc.data() as Data), fieldIds),
        )
      const last = snapshot.docs[snapshot.docs.length - 1]
      return {
        rows,
        next:
          snapshot.docs.length < size || !last
            ? null
            : encodeCursor(Number(last.get('startsAtMs')), last.id),
      }
    },

    async lookup(ctx, requests) {
      const hostId = requireHost(ctx)
      const isId = (request: MatchLookupRequest) =>
        request.fieldId === TRANSFER_ID_FIELD &&
        request.normalizer === 'aglynId'
      const byId = requests.filter(isId)
      const byValue = requests.filter(
        (request) => !isId(request) && request.values.length,
      )
      const candidates = new Map<string, Data>()
      const wantedIds = byId.flatMap((request) => request.values)
      if (wantedIds.length) {
        for (const [id, data] of await readByIds(hostId, wantedIds)) {
          if (!isDeletedEvent(data)) candidates.set(id, data)
        }
      }
      // Title and start are not a query Firestore can answer for a list of
      // pairs, so the site's events are read once and matched here.
      if (byValue.length)
        for (const [id, data] of await scanEvents(hostId))
          candidates.set(id, data)

      const records = [...candidates].map(([id, data]) => ({
        id,
        values: eventFieldValues(id, data),
      }))
      const built = buildMatchLookup(records, requests)
      const lookup = new Map<string, string[]>()
      const matched = new Set<string>()
      for (const request of requests) {
        for (const value of request.values) {
          const key = matchLookupKey(request.fieldId, value)
          const ids = built.get(key)
          if (!ids?.length) continue
          lookup.set(key, ids)
          for (const id of ids) matched.add(id)
        }
      }
      const byRecord = new Map(
        records.map((record) => [record.id, record.values]),
      )
      return {
        lookup,
        records: new Map(
          [...matched].map((id) => [id, byRecord.get(id) as Values]),
        ),
      }
    },

    async plan(ctx, input) {
      // A status is matched without regard to case, so "Published" plans as
      // what is stored rather than as a change.
      const rows = input.rows.map((row) => {
        const status = row.values['status']
        const folded = eventStatusOf(status)
        return folded && folded !== status
          ? { ...row, values: { ...row.values, status: folded } }
          : row
      })
      const plan = buildTransferPlan({ ...input, rows })
      return withTransferResourceFindings(
        plan,
        await findings(ctx, plan, input.existing),
      )
    },

    async apply(ctx, chunk, writer) {
      const hostId = requireHost(ctx)
      await deps.requireEntitled(ctx.orgId)
      const events = eventsOf(hostId)
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      const pending: PlannedTransferRow[] = []
      for (const row of chunk.rows) {
        const earlier = await writer.alreadyApplied(row.index)
        if (earlier) results.push(earlier)
        else pending.push(row)
      }
      const current = await readByIds(
        hostId,
        pending
          .filter((row) => row.verdict === 'update' && row.recordId)
          .map((row) => row.recordId as string),
      )
      const fail = async (
        row: PlannedTransferRow,
        reason: string,
        message: string,
      ) => {
        const result: TransferRowResult = {
          row: row.index,
          outcome: 'failed',
          ...(row.recordId ? { recordId: row.recordId } : {}),
          reason,
          message,
        }
        await writer.markApplied(result)
        results.push(result)
      }

      for (const row of pending) {
        if (writer.timeLeftMs() < APPLY_ROW_RESERVE_MS) break
        const changes = changesOf(row)
        if (row.verdict === 'create') {
          const input = writeInputOf(changes)
          if ('problem' in input) {
            await fail(row, 'resourceRule', input.problem)
            continue
          }
          const write = eventWrite(input)
          const id = createId()
          const at = deps.timestamp(now())
          // `create`, not `set`: a fresh id that somehow exists is refused, never overwritten.
          await events
            .doc(id)
            .create({ ...write.fields, createdAt: at, updatedAt: at })
          const stored = eventFieldValues(id, afterWrite({}, write))
          const written = Object.fromEntries(
            EVENT_CONTENT_FIELD_IDS.filter(
              (fieldId) => !isBlankTransferValue(stored[fieldId]),
            ).map((fieldId) => [fieldId, stored[fieldId]]),
          )
          const result: TransferRowResult = {
            row: row.index,
            outcome: 'created',
            recordId: id,
          }
          const entry: TransferUndoEntry = {
            row: row.index,
            recordId: id,
            action: 'created',
            written,
          }
          await writer.markApplied(result, entry)
          results.push(result)
          undo.push(entry)
          continue
        }

        const id = row.recordId as string
        const data = current.get(id)
        if (!data || isDeletedEvent(data)) {
          await fail(
            row,
            'matchedRecordMissing',
            'The event was deleted after the dry run.',
          )
          continue
        }
        const before = eventFieldValues(id, data)
        const input = writeInputOf({ ...before, ...changes })
        if ('problem' in input) {
          await fail(row, 'resourceRule', input.problem)
          continue
        }
        // The record as it will be, so a blank the policy chose clears.
        const write = eventWrite(input, { clearBlank: true })
        const after = eventFieldValues(id, afterWrite(data, write))
        const touched = EVENT_CONTENT_FIELD_IDS.filter(
          (fieldId) => !transferValuesEqual(before[fieldId], after[fieldId]),
        )
        if (!touched.length) {
          const result: TransferRowResult = {
            row: row.index,
            outcome: 'unchanged',
            recordId: id,
          }
          await writer.markApplied(result)
          results.push(result)
          continue
        }
        await events
          .doc(id)
          .update(updatePayload(deps, write, deps.timestamp(now())))
        // A later row of this chunk matched to the same event reads what this one wrote.
        current.set(id, afterWrite(data, write))
        const modes: Record<string, TransferFieldMode> = {}
        const touchedIds = new Set<string>(touched)
        for (const change of row.diff)
          if (touchedIds.has(change.fieldId))
            modes[change.fieldId] = change.mode
        const result: TransferRowResult = {
          row: row.index,
          outcome: 'updated',
          recordId: id,
        }
        const entry: TransferUndoEntry = {
          row: row.index,
          recordId: id,
          action: 'updated',
          previous: pick(before, touched),
          written: pick(after, touched),
          modes,
        }
        await writer.markApplied(result, entry)
        results.push(result)
        undo.push(entry)
      }
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions) {
      const hostId = requireHost(ctx)
      const events = eventsOf(hostId)
      const current = await readByIds(
        hostId,
        snapshot.entries.map((entry) => entry.recordId),
      )
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      for (const entry of snapshot.entries) {
        const data = current.get(entry.recordId)
        const values =
          data && !isDeletedEvent(data)
            ? eventFieldValues(entry.recordId, data)
            : null
        const step = planTransferUndo(entry, values)
        if (
          step.action === 'conflict' &&
          decisions?.[entry.recordId] !== 'revert'
        ) {
          if (decisions?.[entry.recordId] === 'keep') {
            done.push({
              action: 'nothing',
              recordId: entry.recordId,
              why: 'alreadyReverted',
            })
          } else conflicts.push(step)
          continue
        }
        if (
          step.action === 'delete' ||
          (step.action === 'conflict' && entry.action === 'created')
        ) {
          // Removed outright rather than soft-deleted like the editor's
          // Delete: the import made it, and undo leaves the site as it was
          // before the import. Nothing refers to an event by id.
          await events.doc(entry.recordId).delete()
          done.push(step)
          continue
        }
        if (
          (step.action === 'restore' || step.action === 'conflict') &&
          values &&
          data
        ) {
          const input = writeInputOf({ ...values, ...step.values })
          if ('problem' in input) {
            throw new Error(
              `Event ${entry.recordId} cannot be restored: ${input.problem}`,
            )
          }
          const write = eventWrite(input, { clearBlank: true })
          await events
            .doc(entry.recordId)
            .update(updatePayload(deps, write, deps.timestamp(now())))
        }
        done.push(step)
      }
      return { done, conflicts }
    },
  }
}
