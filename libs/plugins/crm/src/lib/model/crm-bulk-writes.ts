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

/**
 * HOW A BULK ACTION IS APPLIED, whichever CRM collection it is over
 * (AGL-2621).
 *
 * The contacts bar settled the shape (AGL-2603): one act over many rows is
 * a PLAN of per-row writes, applied in batches with a per-row fallback, and
 * whatever the store refused comes back NAMED — by the address, the company,
 * the deal's title — never as a count. Companies, deals and tasks each have
 * a bar now, and each bar's runner would be the same forty lines with a
 * different noun. So the runner lives here once, parametric over what a
 * write is called, and `contacts-bulk-writes.ts` stands on it under the
 * names it always exported.
 *
 * ## Two kinds of act
 *
 * A write to the document — an owner, a tag, a due date, a delete — goes
 * through {@link runCrmBulkWrites}: batched, and re-applied row by row when a
 * batch fails, because a batch that fails names no row. An act with a side
 * effect outside the document — a deal's stage, a task's completion, an
 * assignment that notifies — goes through its ROUTE, one request per row, and
 * {@link runCrmBulkCalls} is the same tally over those: each refusal is named
 * by the row and carries the route's own sentence. A route that takes the
 * whole selection at once and answers per row — the organization-level task
 * routes (AGL-2637) — is tallied by {@link runCrmBulkBatch} from its answers.
 *
 * Pure apart from the Firestore SDK the writer factory binds: the runners
 * take their writers as ports, so a spec wires a ledger in.
 */

import {
  deleteDoc,
  type DocumentReference,
  type Firestore,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

/**
 * The Firestore batch cap is 500 writes; 400 leaves room for the sentinel
 * transforms a patch carries, which the cap counts as writes of their own.
 * The same margin the datasets card keeps.
 */
export const CRM_BULK_WRITE_CHUNK = 400

/**
 * One write to one document, named for the report — the name a person
 * recognizes the row by, which is what a refusal is listed under.
 */
export type CrmBulkWrite = { id: string; label: string } & (
  | { kind: 'update'; data: Record<string, unknown> }
  | { kind: 'delete' }
)

/** A row an action deliberately left alone, and why. */
export interface CrmBulkSkip {
  label: string
  reason: string
}

/** What one action wants written, and what it declined to. */
export interface CrmBulkPlan<W = CrmBulkWrite> {
  writes: W[]
  skipped: CrmBulkSkip[]
}

/** The writers the runner needs — Firestore's, or a spec's ledger. */
export interface CrmBulkWriters<W> {
  /** Apply every write atomically, or throw. */
  commitBatch: (writes: readonly W[]) => Promise<void>
  /** Apply one write, or throw. */
  commitOne: (write: W) => Promise<void>
}

export interface CrmBulkOutcome {
  /** Rows written, or requests answered. */
  done: number
  /** Rows the store or the route refused, by label, with the reason given. */
  refused: Array<{ label: string; error: string }>
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

/** Whatever the store or the route threw, as one sentence a report can carry. */
export function bulkRefusalReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'permission-denied') return 'not permitted'
  if (code === 'not-found') return 'no longer exists'
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : 'the write failed'
}

/**
 * Apply the writes in chunks, and re-apply a failed chunk row by row.
 *
 * The batch is the fast path and the common one: four hundred patches in
 * one round trip. The fallback is the honest one: a batch that fails names
 * no row, so the only way to say WHICH of four hundred was refused is to
 * ask about each. The chunk that failed is the only one that pays for that;
 * the others commit as batches.
 */
export async function runCrmBulkWrites<W>(
  writers: CrmBulkWriters<W>,
  writes: readonly W[],
  labelOf: (write: W) => string,
  chunkSize: number = CRM_BULK_WRITE_CHUNK,
): Promise<CrmBulkOutcome> {
  const outcome: CrmBulkOutcome = { done: 0, refused: [] }
  for (const chunk of chunked(writes, chunkSize)) {
    try {
      await writers.commitBatch(chunk)
      outcome.done += chunk.length
      continue
    } catch {
      // Fall through to the per-row pass below.
    }
    for (const write of chunk) {
      try {
        await writers.commitOne(write)
        outcome.done += 1
      } catch (error) {
        outcome.refused.push({ label: labelOf(write), error: bulkRefusalReason(error) })
      }
    }
  }
  return outcome
}

/**
 * One request per row, in order, tallied the same way.
 *
 * In ORDER rather than in parallel: the routes these calls reach each
 * verify a session, resolve a membership and emit an event, and two hundred
 * of them fired at once is a burst the console's request budget is not
 * sized for. A refusal carries the route's own sentence, which is written
 * for the person reading it.
 */
export async function runCrmBulkCalls<T>(
  items: readonly T[],
  labelOf: (item: T) => string,
  call: (item: T) => Promise<unknown>,
): Promise<CrmBulkOutcome> {
  const outcome: CrmBulkOutcome = { done: 0, refused: [] }
  for (const item of items) {
    try {
      await call(item)
      outcome.done += 1
    } catch (error) {
      outcome.refused.push({ label: labelOf(item), error: bulkRefusalReason(error) })
    }
  }
  return outcome
}

/** What a batch route answers for one row: written, or refused with a sentence. */
export interface CrmBulkAnswer {
  id: string
  ok: boolean
  error?: string
}

/**
 * One request for the whole selection, answered per row (AGL-2637).
 *
 * The tally is read off the answers rather than off N calls, in the rows'
 * own order. A row the answer does not mention was not written — a route
 * that dropped it silently would otherwise read as success — and is refused
 * by name. A request refused WHOLE (no session, no reach over the org) is
 * every row refused with the route's one sentence, which is what the same
 * selection through {@link runCrmBulkCalls} would have said N times.
 */
export async function runCrmBulkBatch<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  labelOf: (item: T) => string,
  call: (items: readonly T[]) => Promise<readonly CrmBulkAnswer[]>,
): Promise<CrmBulkOutcome> {
  const outcome: CrmBulkOutcome = { done: 0, refused: [] }
  if (!items.length) return outcome
  let answers: readonly CrmBulkAnswer[]
  try {
    answers = await call(items)
  } catch (error) {
    const reason = bulkRefusalReason(error)
    for (const item of items) outcome.refused.push({ label: labelOf(item), error: reason })
    return outcome
  }
  const byId = new Map(answers.map((answer) => [answer.id, answer]))
  for (const item of items) {
    const answer = byId.get(idOf(item))
    if (answer?.ok) outcome.done += 1
    else {
      outcome.refused.push({
        label: labelOf(item),
        error: answer?.error || 'the write failed',
      })
    }
  }
  return outcome
}

/**
 * The Firestore writers for a collection whose bulk writes touch ONE
 * document each — companies, deals, tasks. The contacts bar keeps its own
 * pair, because a contact's company link moves a count on a second document
 * and that count has to land in the same commit.
 */
export function crmBulkWriters(
  firestore: Firestore,
  refFor: (id: string) => DocumentReference,
): CrmBulkWriters<CrmBulkWrite> {
  return {
    commitBatch: async (writes) => {
      const batch = writeBatch(firestore)
      for (const write of writes) {
        if (write.kind === 'delete') batch.delete(refFor(write.id))
        else batch.update(refFor(write.id), write.data)
      }
      await batch.commit()
    },
    commitOne: async (write) => {
      if (write.kind === 'delete') await deleteDoc(refFor(write.id))
      else await updateDoc(refFor(write.id), write.data)
    },
  }
}

/**
 * The report under a bar: what the plan skipped on purpose, then what the
 * store refused, one line each, named. `null` when there is nothing to say,
 * so the bar renders no empty alert.
 */
export function bulkReport(
  plan: Pick<CrmBulkPlan<unknown>, 'skipped'>,
  outcome: CrmBulkOutcome,
): CrmBulkSkip[] | null {
  const left: CrmBulkSkip[] = [
    ...plan.skipped,
    ...outcome.refused.map((row) => ({ label: row.label, reason: row.error })),
  ]
  return left.length ? left : null
}
