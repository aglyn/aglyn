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
 * tell one field of it from another. So every act is a request to a route,
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
 */

import {
  type ContactCompanyLinkState,
  planContactCompanyLink,
} from '@aglyn/aglyn'

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
  /** The holder tokens the row is shared with. */
  visibleTo?: string[]
  /** The link state the company planner reads — see `ContactRecord.companyLink`. */
  companyLink?: ContactCompanyLinkState
}

/** A row an action deliberately left alone, and why. */
export interface ContactBulkSkip {
  email: string
  reason: string
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
