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
 * What a bulk action on the contacts table WRITES, and how it is applied
 * (AGL-2603).
 *
 * The bar over the table offers one act over many rows — tag them, hand them
 * to an owner, move them along the funnel, let them go — and each act is the
 * same write the profile drawer makes for one person, repeated. This module
 * holds the repetition so the bar holds only the controls: the patches are
 * built here from the rows the table already has, and applied here in
 * batches with a per-row fallback, so the bar cannot spell a facet path
 * differently from the drawer and cannot lose track of which row was refused.
 *
 * ## Every write lands in the holder's FACET
 *
 * A contact row is shared by every site in the org; the tags, the owner and
 * the stage are one holder's business records on it. So every patch is a
 * dotted path through {@link contactFacetPath} — a nested object would
 * replace the whole map and take every other holder's records with it — and
 * the tag writes are `arrayUnion`/`arrayRemove` rather than a rewritten
 * array, because the rows the bar reads came off a listener that may be
 * behind the server, and a bulk action must not roll back what another
 * console just saved.
 *
 * ## A refused row is REPORTED, never hidden
 *
 * A batch commits all or nothing, so one row the rules refuse — a scoped
 * member reaching a contact outside their tokens, a row deleted since the
 * listener read it — fails the other 399 with it. The runner re-applies a
 * failed chunk one row at a time, so the rows that could be written are, and
 * the ones that could not are handed back BY ADDRESS. A count of "398 of 400"
 * is a number nobody can act on; an address is.
 *
 * Pure apart from the Firestore sentinels: the runner takes its writers as
 * ports, so the bar wires `writeBatch`/`updateDoc`/`deleteDoc` in and a spec
 * wires a ledger in.
 */

import {
  contactFacetPath,
  planContactDetach,
  type ContactLifecycleStage,
} from '@aglyn/aglyn'
import { arrayRemove, arrayUnion, deleteField } from 'firebase/firestore'

/**
 * The Firestore batch cap is 500 writes; 400 leaves room for the sentinel
 * transforms a facet patch carries, which the cap counts as writes of their
 * own. The same margin the datasets card keeps.
 */
export const CONTACT_BULK_WRITE_CHUNK = 400

/** The drawer's cap on a holder's tags — the same number, so the two agree. */
export const CONTACT_TAGS_CAP = 20

/** As much of a table row as a bulk write reads. */
export interface ContactBulkRow {
  $id: string
  email?: string
  /** THIS holder's tags, already read through the facet by the table. */
  tags?: string[]
  /** The holder tokens — what `planContactDetach` counts. */
  visibleTo?: string[]
}

/** One write to one contact document, named by the address it is about. */
export type ContactBulkWrite = { id: string; email: string } & (
  | { kind: 'update'; data: Record<string, unknown> }
  | { kind: 'delete' }
)

/** A row an action deliberately left alone, and why. */
export interface ContactBulkSkip {
  email: string
  reason: string
}

/** What one action wants written, and what it declined to. */
export interface ContactBulkPlan {
  writes: ContactBulkWrite[]
  skipped: ContactBulkSkip[]
}

/** The address a report names a row by, falling back to the id. */
const addressOf = (row: ContactBulkRow): string =>
  String(row.email || row.$id)

/**
 * A typed tag as the drawer stores one, or `null` when nothing survives.
 *
 * Lowercased and trimmed because the drawer lowercases and trims, and
 * `contactMatchesSegment` compares lowercased — a bulk "VIP" beside a typed
 * "vip" would otherwise be two tags on one list and one filter finding half
 * of them.
 */
export function normalizeBulkTag(input: string): string | null {
  const tag = input.trim().toLowerCase().slice(0, 60)
  return tag || null
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  return chunks
}

/**
 * Add one tag to every row's facet.
 *
 * A row that already carries the tag is skipped silently — `arrayUnion`
 * would write nothing, and a report saying so would be noise. A row already
 * at the cap without it is skipped AND reported: the cap is the drawer's,
 * and a bulk path that slipped past it would leave a tag the drawer's next
 * save silently drops.
 */
export function planAddTag(
  rows: readonly ContactBulkRow[],
  groupId: string,
  tag: string,
  nowMs: number,
): ContactBulkPlan {
  const writes: ContactBulkWrite[] = []
  const skipped: ContactBulkSkip[] = []
  for (const row of rows) {
    const held = (row.tags ?? []).map((held) => held.toLowerCase())
    if (held.includes(tag)) continue
    if (held.length >= CONTACT_TAGS_CAP) {
      skipped.push({
        email: addressOf(row),
        reason: `already has ${CONTACT_TAGS_CAP} tags`,
      })
      continue
    }
    writes.push({
      id: row.$id,
      email: addressOf(row),
      kind: 'update',
      data: {
        [contactFacetPath(groupId, 'tags')]: arrayUnion(tag),
        updatedAt: new Date(nowMs),
      },
    })
  }
  return { writes, skipped }
}

/** Take one tag off every row's facet; rows without it are left alone. */
export function planRemoveTag(
  rows: readonly ContactBulkRow[],
  groupId: string,
  tag: string,
  nowMs: number,
): ContactBulkPlan {
  const writes: ContactBulkWrite[] = []
  for (const row of rows) {
    const held = (row.tags ?? []).map((held) => held.toLowerCase())
    if (!held.includes(tag)) continue
    writes.push({
      id: row.$id,
      email: addressOf(row),
      kind: 'update',
      data: {
        [contactFacetPath(groupId, 'tags')]: arrayRemove(tag),
        updatedAt: new Date(nowMs),
      },
    })
  }
  return { writes, skipped: [] }
}

/**
 * Set one scalar of the facet on every row: the owner or the stage.
 *
 * An empty owner CLEARS the field rather than writing an empty string, so
 * "unassigned" has one shape — absent — for the audience matcher, which
 * reads a blank as "owned by nobody" and must not find `''`.
 */
export function planSetFacetField(
  rows: readonly ContactBulkRow[],
  groupId: string,
  field: 'ownerUid' | 'lifecycleStage',
  value: string | ContactLifecycleStage | null,
  nowMs: number,
): ContactBulkPlan {
  return {
    writes: rows.map((row) => ({
      id: row.$id,
      email: addressOf(row),
      kind: 'update',
      data: {
        [contactFacetPath(groupId, field)]: value ? value : deleteField(),
        updatedAt: new Date(nowMs),
      },
    })),
    skipped: [],
  }
}

/**
 * Let every row go — the drawer's DELETE IS A DETACH, per row.
 *
 * `planContactDetach` decides for each document whether this holder is the
 * last one (delete) or one of several (drop this group's facet, consent
 * entries, capture attribution and scope tokens). The `arrayRemove` and
 * `deleteField` sentinels are the ones the drawer writes, so a row detached
 * here and a row detached there are the same document afterwards.
 *
 * ⛔ Not the erasure path, for the reason the drawer's comment gives: a
 * privacy erasure removes the person everywhere regardless of holders.
 */
export function planDetach(
  rows: readonly ContactBulkRow[],
  group: { groupId: string; hostIds: readonly string[] },
  nowMs: number,
): ContactBulkPlan {
  return {
    writes: rows.map((row) => {
      // Only the holder tokens reach the plan: that is all it reads, and a
      // projected table row carries fields the detach must not consult.
      const plan = planContactDetach({ visibleTo: row.visibleTo ?? [] }, group)
      if (plan.action === 'delete') {
        return { id: row.$id, email: addressOf(row), kind: 'delete' as const }
      }
      return {
        id: row.$id,
        email: addressOf(row),
        kind: 'update' as const,
        data: {
          ...Object.fromEntries(plan.remove.map((path) => [path, deleteField()])),
          visibleTo: arrayRemove(...plan.removeTokens),
          capturedByHostIds: arrayRemove(...plan.removeHostIds),
          updatedAt: new Date(nowMs),
        },
      }
    }),
    skipped: [],
  }
}

/** The writers the runner needs — Firestore's, or a spec's ledger. */
export interface ContactBulkWriters {
  /** Apply every write atomically, or throw. */
  commitBatch: (writes: readonly ContactBulkWrite[]) => Promise<void>
  /** Apply one write, or throw. */
  commitOne: (write: ContactBulkWrite) => Promise<void>
}

export interface ContactBulkOutcome {
  /** Rows written. */
  done: number
  /** Rows the store refused, by address, with the reason it gave. */
  refused: Array<{ email: string; error: string }>
}

/** Whatever the store threw, as one sentence a snackbar can carry. */
const reasonOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'permission-denied') return 'not permitted'
  if (code === 'not-found') return 'no longer exists'
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : 'the write failed'
}

/**
 * Apply the writes in chunks, and re-apply a failed chunk row by row.
 *
 * The batch is the fast path and the common one: four hundred facet patches
 * in one round trip. The fallback is the honest one: a batch that fails
 * names no row, so the only way to say WHICH of four hundred was refused is
 * to ask about each. The chunk that failed is the only one that pays for
 * that; the others commit as batches.
 */
export async function runContactBulkWrites(
  writers: ContactBulkWriters,
  writes: readonly ContactBulkWrite[],
  chunkSize: number = CONTACT_BULK_WRITE_CHUNK,
): Promise<ContactBulkOutcome> {
  const outcome: ContactBulkOutcome = { done: 0, refused: [] }
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
        outcome.refused.push({ email: write.email, error: reasonOf(error) })
      }
    }
  }
  return outcome
}
