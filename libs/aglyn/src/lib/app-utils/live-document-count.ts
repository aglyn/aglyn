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
 * How a plan allowance counts a collection whose delete is a SOFT delete
 * (AGL-3918).
 *
 * The rule: a deleted document frees its slot, an archived one keeps it.
 * Deleting stamps `deletedAt` and leaves the document in place (a tenant page
 * keeps grafting until its next revalidate, a past order still names the
 * product), so a plain `count()` charged a site for everything it had ever
 * deleted: a product deleted on Starter never gave its slot back, and the
 * Automation card read "4/25 workflows" beside a list of three. Archiving is a
 * status the owner can reverse in place, so an archived product or a disabled
 * workflow is still counted.
 *
 * ## Why total minus tombstones
 *
 * A live document has no `deletedAt` at all (created through
 * `/api/hosts/resources`) or an explicit `deletedAt: null` (every product
 * writer, a marketplace install). Firestore cannot match an absent field, so
 * `where('deletedAt', '==', null)` counts the second shape alone. The
 * TOMBSTONES are one shape — a value that is not `null` — and
 * `where('deletedAt', '!=', null)` matches exactly them, so the total less
 * that count is exactly the documents the server calls live. Two aggregates,
 * one billed read each at these sizes, on the automatic single-field index
 * `deletedAt` already has; no composite index.
 *
 * This module is SDK-agnostic: it names the Admin SDK's query shape
 * structurally so a plugin, core and the console reach it without a second
 * copy of the rule. The web SDK's counterpart is
 * `live-document-count.client.ts`.
 */

/** The field every soft-deleting collection stamps on delete. */
export const TOMBSTONE_FIELD = 'deletedAt'

/** The live count from the two aggregates, never below zero: they are separate reads, and a delete landing between them can make the second the larger. */
export function liveDocumentCount(total: number, tombstones: number): number {
  return Math.max(0, (Number(total) || 0) - (Number(tombstones) || 0))
}

/** Whether a stored document is live: no `deletedAt`, or `deletedAt: null`. */
export function isLiveDocument(deletedAt: unknown): boolean {
  return deletedAt == null
}

/** An aggregate query's snapshot, as the Admin SDK's `AggregateQuerySnapshot` answers it. */
export interface LiveCountSnapshot {
  data(): { count: number }
}

/** An aggregate query the Admin SDK can execute directly. */
export interface LiveCountAggregate {
  get(): Promise<LiveCountSnapshot>
}

/** A collection or query the Admin SDK can count and filter. */
export interface LiveCountQuery<A extends LiveCountAggregate> {
  count(): A
  where(field: string, op: '!=', value: null): { count(): A }
}

/**
 * The live documents [documents] matches: every one less the tombstones.
 *
 * `read` executes each aggregate, and defaults to executing it directly. A
 * create that counts and writes in one transaction passes
 * `(aggregate) => tx.get(aggregate)`, so both counts are the TRANSACTION's
 * reads and the lock they take serializes a concurrent create (AGL-2231).
 */
export async function countLiveDocuments<A extends LiveCountAggregate>(
  documents: LiveCountQuery<A>,
  read: (aggregate: A) => Promise<LiveCountSnapshot> = (aggregate) => aggregate.get(),
): Promise<number> {
  const [total, tombstones] = await Promise.all([
    read(documents.count()),
    read(documents.where(TOMBSTONE_FIELD, '!=', null).count()),
  ])
  return liveDocumentCount(total.data().count, tombstones.data().count)
}

/** The `source.type` a platform-seeded starter template carries (AGL-687). */
export const STARTER_TEMPLATE_SOURCE = 'starter'

/**
 * Of a site's deleted templates, how many `templatesPerHost`'s first count
 * included: `where('source.type', '!=', 'starter')` matches a template that
 * carries a `source.type` other than a starter's, and skips one without the
 * field. Subtracting these from that count leaves the live templates the
 * allowance counts, without the composite index a second inequality on
 * `deletedAt` beside it would need.
 */
export function deletedTemplatesCounted(
  tombstones: ReadonlyArray<{ get(field: string): unknown }>,
): number {
  return tombstones.filter((entry) => {
    const type = entry.get('source.type')
    return type != null && type !== STARTER_TEMPLATE_SOURCE
  }).length
}
