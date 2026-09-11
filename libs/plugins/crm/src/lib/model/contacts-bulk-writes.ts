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
 * What a bulk action on the contacts table does to each row (AGL-2603, and
 * through the server since AGL-2804).
 *
 * The bar over the table offers one act over many rows — tag them, hand them
 * to an owner, file them under a company, move them along the funnel, let
 * them go. A contact's tags, owner and company are one holder's records in
 * that holder's facet, and a facet is the server's to write: the rules cannot
 * tell one field of it from another, so they leave a client nothing there
 * but letting a holder go. So every act but that one is a request to a route,
 * and what this module decides is WHICH rows the request names — the bar
 * holds only the controls.
 *
 * ## A row with nothing to change is left out, and a row that cannot be
 * ## reached is REPORTED
 *
 * A row already carrying the tag, or already at the company, is left out of
 * the request silently: the route would write nothing, and a report saying
 * so would be noise. A row already at the tag cap, or whose company link the
 * table could not project, is left out and named by address — a count of
 * "398 of 400" is a number nobody can act on; an address is. The route asks
 * the same questions of the stored document, so a row that changed since the
 * table read it is still refused by name rather than slipped past.
 *
 * ## Letting go is still written here
 *
 * Removing a contact from a site drops that holder's facet, consent entries,
 * capture attribution and scope tokens — the one change to a facet a holder
 * may make client-direct. Those patches are built here and applied in
 * batches with a per-row fallback, so a refused row is named rather than
 * failing the other 399 with it.
 *
 * Pure apart from the Firestore sentinels the detach carries: the runner takes
 * its writers as ports, so the bar wires `writeBatch`/`updateDoc`/`deleteDoc`
 * in and a spec wires a ledger in.
 */

import {
  type ContactCompanyLinkState,
  planContactCompanyLink,
  planContactDetach,
} from '@aglyn/aglyn'
import { arrayRemove, deleteField } from 'firebase/firestore'
import {
  CRM_BULK_WRITE_CHUNK,
  chunked,
  runCrmBulkWrites,
} from './crm-bulk-writes'

/*
 * The runner and its chunk size are the shared ones (`crm-bulk-writes.ts`,
 * AGL-2621), under the names this module has always exported: the batch
 * cap and the per-row fallback are about Firestore, not about people.
 */
export const CONTACT_BULK_WRITE_CHUNK = CRM_BULK_WRITE_CHUNK
export { chunked }

/** The record page's cap on a holder's tags — the same number, so the two agree. */
export const CONTACT_TAGS_CAP = 20

/** As much of a table row as a bulk act reads. */
export interface ContactBulkRow {
  $id: string
  email?: string
  /**
   * The holder this row was flattened through (`ContactRecord.groupId`),
   * which a cross-holder reader — the organization-level list (AGL-2630) —
   * writes each row through, since no one viewing group covers every
   * selected person there.
   */
  groupId?: string
  /** A site of that holder's group — where the row's stage is moved (`ContactRecord.holderHostId`). */
  holderHostId?: string
  /** THIS holder's tags, already read through the facet by the table. */
  tags?: string[]
  /** The holder tokens — what `planContactDetach` counts. */
  visibleTo?: string[]
  /** The link state the company planner reads — see `ContactRecord.companyLink`. */
  companyLink?: ContactCompanyLinkState
}

/** One client-direct write to one contact document, named by the address it is about. */
export type ContactBulkWrite = { id: string; email: string } & (
  | { kind: 'update'; data: Record<string, unknown> }
  | { kind: 'delete' }
)

/** A row an action deliberately left alone, and why. */
export interface ContactBulkSkip {
  email: string
  reason: string
}

/** What a letting-go wants written, and what it declined to. */
export interface ContactBulkPlan {
  writes: ContactBulkWrite[]
  skipped: ContactBulkSkip[]
}

/** The rows a request to a route names, and the rows it leaves out by name. */
export interface ContactBulkSelection {
  rows: ContactBulkRow[]
  skipped: ContactBulkSkip[]
}

/** The address a report names a row by, falling back to the id. */
export const contactBulkAddressOf = (row: ContactBulkRow): string =>
  String(row.email || row.$id)

/**
 * A typed tag as the record page stores one, or `null` when nothing survives.
 *
 * Lowercased and trimmed because the record page lowercases and trims, and
 * `contactMatchesSegment` compares lowercased — a bulk "VIP" beside a typed
 * "vip" would otherwise be two tags on one list and one filter finding half
 * of them.
 */
export function normalizeBulkTag(input: string): string | null {
  const tag = input.trim().toLowerCase().slice(0, 60)
  return tag || null
}

/**
 * The rows adding one tag reaches.
 *
 * A row that already carries the tag is left out silently. A row already at
 * the cap without it is left out AND reported: the cap is the record page's,
 * and a bulk path that slipped past it would leave a tag the page's next
 * save silently drops.
 */
export function planAddTag(
  rows: readonly ContactBulkRow[],
  tag: string,
): ContactBulkSelection {
  const reached: ContactBulkRow[] = []
  const skipped: ContactBulkSkip[] = []
  for (const row of rows) {
    const held = (row.tags ?? []).map((held) => held.toLowerCase())
    if (held.includes(tag)) continue
    if (held.length >= CONTACT_TAGS_CAP) {
      skipped.push({
        email: contactBulkAddressOf(row),
        reason: `already has ${CONTACT_TAGS_CAP} tags`,
      })
      continue
    }
    reached.push(row)
  }
  return { rows: reached, skipped }
}

/** The rows taking one tag off reaches: the ones that carry it. */
export function planRemoveTag(
  rows: readonly ContactBulkRow[],
  tag: string,
): ContactBulkSelection {
  return {
    rows: rows.filter((row) =>
      (row.tags ?? []).map((held) => held.toLowerCase()).includes(tag),
    ),
    skipped: [],
  }
}

/**
 * The rows filing under one company reaches — or unlinking, with `null`
 * (AGL-2613).
 *
 * A row already where it was asked to be is left out silently, as a row
 * already tagged is. A row the table could not project a link state for is
 * left out AND named: whether its link would change cannot be told, and the
 * request is not the place to guess.
 */
export function planSetCompany(
  rows: readonly ContactBulkRow[],
  companyId: string | null,
): ContactBulkSelection {
  const reached: ContactBulkRow[] = []
  const skipped: ContactBulkSkip[] = []
  for (const row of rows) {
    if (!row.companyLink) {
      skipped.push({
        email: contactBulkAddressOf(row),
        reason: 'its company link could not be read',
      })
      continue
    }
    if (planContactCompanyLink(row.companyLink, companyId)) reached.push(row)
  }
  return { rows: reached, skipped }
}

/**
 * Let every row go — the record page's DELETE IS A DETACH, per row.
 *
 * `planContactDetach` decides for each document whether this holder is the
 * last one (delete) or one of several (drop this group's facet, consent
 * entries, capture attribution and scope tokens). The `arrayRemove` and
 * `deleteField` sentinels are the ones the record page writes, so a row
 * detached here and a row detached there are the same document afterwards.
 *
 * ⛔ Not the erasure path: a privacy erasure removes the person everywhere
 * regardless of holders.
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
        return { id: row.$id, email: contactBulkAddressOf(row), kind: 'delete' as const }
      }
      return {
        id: row.$id,
        email: contactBulkAddressOf(row),
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

/**
 * The shared runner over contact writes — batched, with a per-row pass for
 * the chunk that failed (`crm-bulk-writes.ts`) — reporting by ADDRESS, which
 * is the name a contacts report lists a row under.
 */
export async function runContactBulkWrites(
  writers: ContactBulkWriters,
  writes: readonly ContactBulkWrite[],
  chunkSize: number = CONTACT_BULK_WRITE_CHUNK,
): Promise<ContactBulkOutcome> {
  const outcome = await runCrmBulkWrites(
    writers,
    writes,
    (write) => write.email,
    chunkSize,
  )
  return {
    done: outcome.done,
    refused: outcome.refused.map((row) => ({ email: row.label, error: row.error })),
  }
}
