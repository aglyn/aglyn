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
 * A SITE'S SUPPRESSION LIST, IMPORTED AND EXPORTED (AGL-3529) — the server
 * half of `email.suppressions`.
 *
 * ## An import only ever adds
 *
 * Suppressions arrive from a former provider's export, a spreadsheet of
 * people who asked by phone, a complaint log. Each address the list does
 * not hold is added as the Add drawer adds one (`server-suppressions.ts`):
 * filed under `emailSuppressionKey`, the one derivation every reader and
 * writer shares, with reason `manual` — a person on the team added it — and
 * who did it.
 *
 * An address the list already holds is left EXACTLY as it is. A bounce that
 * has been on the list for a month must not be relabeled `manual` and lose
 * the reason a merchant needs to see before removing it, so the write is a
 * `create` that refuses an existing entry rather than a merge over it, and
 * no field choice in the wizard can say otherwise (`SUPPRESSION_KEPT_REASON`).
 *
 * And nothing here removes one — not the import, and not its undo: the
 * import writes no undo entry, so Undo reports nothing to take back. An
 * opt-out recorded by mistake is removed by hand on the Suppressions card,
 * which names the reason before it does.
 *
 * ## Who may
 *
 * The site's own list, so the transfer gate's `data.manage` on the site is
 * the boundary — the same population the rules let write
 * `hosts/{hostId}/suppressions`. A collaborator who reaches the site reads
 * its list; the export route has already refused one who does not.
 */

import {
  TRANSFER_ID_FIELD,
  matchLookupKey,
  normalizeMatchValue,
  type MatchLookupRequest,
  type PlannedTransferRow,
  type TransferRowResult,
} from '@aglyn/aglyn/data-transfer'
import type {
  TransferApplyResult,
  TransferLookupResult,
  TransferReadOptions,
  TransferReadPage,
  TransferRecordsHooks,
  TransferResourceContext,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { emailSearchTokens, emailSuppressionKey, firebaseAdmin } from '@aglyn/tenant-data-admin'
import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { FieldValue } from 'firebase-admin/firestore'
import { MANUAL_SUPPRESSION_REASON, SUPPRESSION_NOTE_MAX } from '../server-suppressions'
import { countExisting } from './transfer-reads.server'
import {
  SUPPRESSION_ALIASES,
  SUPPRESSION_LOCKED_RULES,
  SUPPRESSION_MATCH_KEYS,
  suppressionCatalog,
} from './email-transfer-catalog'

/** Below this much of a chunk's budget, a write stops at a row boundary. */
const APPLY_RESERVE_MS = 2_000

/** The site's suppression list. */
function suppressionsOf(ctx: TransferResourceContext): FirebaseFirestore.CollectionReference {
  if (!ctx.hostId) throw new TransferEngineError('invalid', 400, 'Suppressions belong to a site; name the site.')
  return firebaseAdmin.app().firestore().collection('hosts').doc(ctx.hostId).collection('suppressions')
}

/** A stored time as ISO text, or `null`. */
function isoOf(value: unknown): string | null {
  const stamp = value as { toDate?: () => Date } | null | undefined
  return stamp && typeof stamp.toDate === 'function' ? stamp.toDate().toISOString() : null
}

/** One entry by field id. `Since` is `createdAt`, the date the person actually left. */
export function suppressionValues(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  return {
    [TRANSFER_ID_FIELD]: id,
    email: text(data['email']),
    note: text(data['note']),
    // An absent reason is an unsubscribe — what it has always meant.
    reason: text(data['reason']) ?? 'unsubscribe',
    suppressedAt: isoOf(data['createdAt']) ?? isoOf(data['suppressedAt']),
    carriedFromHostId: text(data['carriedFromHostId']),
  }
}

/** The entries holding each requested address or id. */
export async function lookupSuppressions(
  ctx: TransferResourceContext,
  requests: readonly MatchLookupRequest[],
): Promise<TransferLookupResult> {
  const suppressions = suppressionsOf(ctx)
  const lookup = new Map<string, string[]>()
  const records = new Map<string, Readonly<Record<string, unknown>>>()
  for (const request of requests) {
    const ids =
      request.fieldId === 'email'
        ? request.values.map((value) => ({ value, id: emailSuppressionKey(value) }))
        : request.fieldId === TRANSFER_ID_FIELD
          ? request.values.map((value) => ({ value, id: value }))
          : []
    const wanted = ids.filter((entry): entry is { value: string; id: string } => !!entry.id && !entry.id.includes('/'))
    for (let at = 0; at < wanted.length; at += 300) {
      const chunk = wanted.slice(at, at + 300)
      const snapshots = await suppressions.firestore.getAll(...chunk.map((entry) => suppressions.doc(entry.id)))
      snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) return
        const entry = chunk[index] as { value: string; id: string }
        lookup.set(matchLookupKey(request.fieldId, entry.value), [snapshot.id])
        records.set(snapshot.id, suppressionValues(snapshot.id, snapshot.data() as Record<string, unknown>))
      })
    }
  }
  return { lookup, records }
}

/** Adds each new address; an address already suppressed is left as it is. */
export async function applySuppressions(
  ctx: TransferResourceContext,
  chunk: { rows: PlannedTransferRow[] },
  writer: Parameters<TransferRecordsHooks['apply']>[2],
): Promise<TransferApplyResult> {
  const suppressions = suppressionsOf(ctx)
  const results: TransferRowResult[] = []
  for (const row of chunk.rows) {
    const done = await writer.alreadyApplied(row.index)
    if (done) {
      results.push(done)
      continue
    }
    if (writer.timeLeftMs() < APPLY_RESERVE_MS) break
    const result = await addSuppression(ctx, suppressions, row)
    await writer.markApplied(result)
    results.push(result)
  }
  // No undo: an import never takes a suppression away, and neither does its undo.
  return { results, undo: [] }
}

/** One row: a new entry, or the existing one left alone. */
async function addSuppression(
  ctx: TransferResourceContext,
  suppressions: FirebaseFirestore.CollectionReference,
  row: PlannedTransferRow,
): Promise<TransferRowResult> {
  const value = (fieldId: string) => row.diff.find((change) => change.fieldId === fieldId)?.after
  const email = normalizeMatchValue('email', value('email'))
  const key = email ? emailSuppressionKey(email) : null
  if (row.verdict !== 'create' || !email || !key) {
    return { row: row.index, outcome: 'unchanged', ...(row.recordId ? { recordId: row.recordId } : {}) }
  }
  const note = String(value('note') ?? '')
    .trim()
    .slice(0, SUPPRESSION_NOTE_MAX)
  try {
    await suppressions.doc(key).create({
      email,
      // What the list's search and Address filter query (AGL-3321).
      emailTokens: emailSearchTokens(email),
      reason: MANUAL_SUPPRESSION_REASON,
      ...(note ? { note } : {}),
      // WHO recorded it, and from which import: a suppression is evidence.
      suppressedByUid: ctx.actorUid ?? null,
      ...(ctx.jobId ? { importJobId: ctx.jobId } : {}),
      createdAt: FieldValue.serverTimestamp(),
      suppressedAt: FieldValue.serverTimestamp(),
    })
    return { row: row.index, outcome: 'created', recordId: key }
  } catch (error) {
    // Suppressed since the dry run: the entry that is there stays as it is.
    if ((error as { code?: unknown })?.code === 6 || /already exists/i.test(String((error as Error)?.message))) {
      return { row: row.index, outcome: 'unchanged', recordId: key, message: 'Already suppressed; left as it was.' }
    }
    throw error
  }
}

/** The card's predicates an export may carry: its own fields and operators only. */
export function readSuppressionFilter(
  filter: Readonly<Record<string, unknown>> | undefined,
): Array<{ path: string; op: FirebaseFirestore.WhereFilterOp; value: unknown }> {
  const clauses = Array.isArray(filter?.['filters']) ? (filter?.['filters'] as unknown[]) : []
  return clauses.map((clause) => {
    const { path, op, value } = (clause ?? {}) as { path?: unknown; op?: unknown; value?: unknown }
    const strings = (list: unknown) => Array.isArray(list) && list.length <= 30 && list.every((item) => typeof item === 'string')
    if (path === 'emailTokens' && op === 'array-contains' && typeof value === 'string') return { path, op, value }
    if (path === 'reason' && op === '==' && typeof value === 'string') return { path, op, value }
    if (path === 'reason' && op === 'in' && strings(value)) return { path, op, value }
    if (path === 'createdAt' && (op === '<' || op === '<=' || op === '>' || op === '>=') && typeof value === 'string') {
      const at = new Date(value)
      if (!Number.isNaN(at.getTime())) return { path, op, value: at }
    }
    throw new TransferEngineError('invalid', 400, 'The filter could not be read.')
  })
}

/** The query for an export's filter, and the order it is read in. */
function suppressionQuery(
  suppressions: FirebaseFirestore.CollectionReference,
  options: TransferReadOptions | undefined,
): { query: FirebaseFirestore.Query; byDate: boolean } {
  const clauses = readSuppressionFilter(options?.filter)
  let query: FirebaseFirestore.Query = suppressions
  for (const clause of clauses) query = query.where(clause.path, clause.op, clause.value)
  // A date range reads in the card's own order; anything else by id, which
  // every entry has — `createdAt` is absent on none written today, but the
  // id order cannot drop a row whatever a writer once did.
  return { query, byDate: clauses.some((clause) => clause.path === 'createdAt') }
}

/** One page of the list, holding only the chosen fields. */
export async function readSuppressionPage(
  ctx: TransferResourceContext,
  cursor: string | null,
  fieldIds: readonly string[],
  options?: TransferReadOptions,
): Promise<TransferReadPage> {
  const suppressions = suppressionsOf(ctx)
  const size = Math.min(Math.max(options?.pageSize ?? 500, 1), 500)
  let docs: FirebaseFirestore.DocumentSnapshot[]
  let next: string | null
  if (options?.ids) {
    const start = cursor ? Number(cursor) : 0
    const ids = options.ids.slice(start, start + size).filter((id) => id && !id.includes('/'))
    docs = ids.length ? (await suppressions.firestore.getAll(...ids.map((id) => suppressions.doc(id)))).filter((doc) => doc.exists) : []
    next = start + size < options.ids.length ? String(start + size) : null
  } else {
    const { query, byDate } = suppressionQuery(suppressions, options)
    let page = (byDate ? query.orderBy('createdAt', 'desc') : query.orderBy('__name__')).limit(size)
    if (cursor) page = byDate ? page.startAfter(await suppressions.doc(cursor).get()) : page.startAfter(cursor)
    const snapshot = await page.get()
    docs = snapshot.docs
    next = snapshot.docs.length === size ? (snapshot.docs[snapshot.docs.length - 1]?.id ?? null) : null
  }
  const rows = docs.map((doc) => {
    const values = suppressionValues(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
    return Object.fromEntries(fieldIds.map((fieldId) => [fieldId, values[fieldId] ?? null]))
  })
  return { rows, next }
}

/** How many entries an export reads. */
export async function countSuppressions(ctx: TransferResourceContext, options: TransferReadOptions): Promise<number> {
  if (options.ids) return countExisting(suppressionsOf(ctx), options.ids)
  const counted = await suppressionQuery(suppressionsOf(ctx), options).query.count().get()
  return Number(counted.data().count ?? 0)
}

/** `email.suppressions`, as the framework asks it. */
export const suppressionsTransferResource: TransferRecordsHooks = {
  fields: () => suppressionCatalog(),
  matchKeys: SUPPRESSION_MATCH_KEYS,
  aliases: SUPPRESSION_ALIASES,
  lockedRules: () => SUPPRESSION_LOCKED_RULES,
  count: countSuppressions,
  readPage: readSuppressionPage,
  lookup: lookupSuppressions,
  apply: applySuppressions,
  // Nothing to take back: the import writes no undo entry (see the module note).
  revert: async () => ({ done: [], conflicts: [] }),
}
