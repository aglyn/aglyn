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
 * THE STAFF ORGANIZATIONS LIST'S AI SPEND COLUMN, AS DATA (AGL-2984).
 *
 * The list draws this plugin's column through its `staffOrgsListColumn`
 * zone: one read of the page's orgs through `/api/ai/admin/orgs-spend`, a
 * cell per row, and a header that sorts the page by the figures. The parts
 * all three share live here — the wire, the number a sort compares, the text
 * a cell shows, and the request's id list — free of React and of the Admin
 * SDK, so the route, the hook and the specs read one definition.
 */

/** The most org ids one request may name — past the list's largest page. */
export const STAFF_ORGS_AI_SPEND_MAX_IDS = 100

/** What `/api/ai/admin/orgs-spend` answers. */
export interface StaffOrgsAiSpendWire {
  /** The month the figures describe, `YYYY-MM` in UTC. */
  month: string
  /**
   * This month's provider spend in USD, by org id. `null` where the org has
   * no usage document for the month or the read failed, never `0`: "spent
   * nothing" and "not measured" stay distinct, and the column exists to find
   * the org that IS spending.
   */
  spendUsd: Record<string, number | null>
}

/**
 * What a sort compares: a NUMBER, or `null` for an unmeasured org. The text
 * a cell shows would sort `$10.0000` before `$9.0000`.
 */
export function aiSpendSortValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * What a cell shows: four decimals, because a month that really cost eight
 * cents must not read as `$0.00`, and a dash for an unmeasured org — never
 * `$0`.
 */
export function aiSpendCell(value: unknown): string {
  const spend = aiSpendSortValue(value)
  return spend === null ? '—' : `$${spend.toFixed(4)}`
}

/**
 * Two spends in a direction, with the unmeasured LAST in both: an org that
 * has not touched AI this month belongs at the bottom of a column whose
 * point is finding the one that has, whichever way it is read.
 */
function compareAiSpend(
  a: unknown,
  b: unknown,
  direction: 'asc' | 'desc',
): number {
  const left = aiSpendSortValue(a)
  const right = aiSpendSortValue(b)
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return direction === 'desc' ? right - left : left - right
}

/** Dearest first; an unmeasured org last. */
export function byAiSpendDesc(a: unknown, b: unknown): number {
  return compareAiSpend(a, b, 'desc')
}

/** Cheapest first; an unmeasured org still last. */
export function byAiSpendAsc(a: unknown, b: unknown): number {
  return compareAiSpend(a, b, 'asc')
}

/**
 * The list's rows in a direction by their org's spend — the comparator the
 * column's header hands the list. A row whose org the answer does not name
 * reads as unmeasured.
 */
export function aiSpendRowComparator(
  spendUsd: Readonly<Record<string, number | null>>,
  direction: 'asc' | 'desc',
): (a: { $id?: unknown }, b: { $id?: unknown }) => number {
  const spendOf = (row: { $id?: unknown }) => spendUsd[String(row?.$id ?? '')]
  return (a, b) => compareAiSpend(spendOf(a), spendOf(b), direction)
}

/** Between ids in the `orgIds` parameter. */
const ORG_ID_SEPARATOR = ','

/**
 * The query string asking for a set of orgs. Each id is encoded on its own
 * before the join, so an id holding the separator survives the split.
 */
export function staffOrgsAiSpendQuery(orgIds: readonly string[]): string {
  return new URLSearchParams({
    orgIds: orgIds
      .map((orgId) => encodeURIComponent(orgId))
      .join(ORG_ID_SEPARATOR),
  }).toString()
}

/** A document id Firestore accepts for an org. */
function isOrgDocumentId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 1500 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  )
}

/** The org ids a request names, or why it names none a read should serve. */
export interface StaffOrgIdsAsk {
  /** Distinct and in the order asked; empty when the ask is refused. */
  orgIds: string[]
  /** Why the ask is refused, or `null` when it is not. */
  error: string | null
}

/**
 * The org ids a request names. An empty ask, more than
 * {@link STAFF_ORGS_AI_SPEND_MAX_IDS} ids, and an id no org document could
 * have are refused before any of them reaches a read.
 */
export function parseStaffOrgIds(raw: unknown): StaffOrgIdsAsk {
  const refuse = (error: string): StaffOrgIdsAsk => ({ orgIds: [], error })
  const orgIds = new Set<string>()
  for (const part of String(raw ?? '').split(ORG_ID_SEPARATOR)) {
    if (!part) continue
    let orgId: string
    try {
      orgId = decodeURIComponent(part)
    } catch {
      return refuse('Invalid orgIds')
    }
    if (!isOrgDocumentId(orgId)) return refuse('Invalid orgIds')
    orgIds.add(orgId)
    if (orgIds.size > STAFF_ORGS_AI_SPEND_MAX_IDS) {
      return refuse(`At most ${STAFF_ORGS_AI_SPEND_MAX_IDS} orgIds`)
    }
  }
  if (orgIds.size === 0) return refuse('Missing orgIds')
  return { orgIds: [...orgIds], error: null }
}
