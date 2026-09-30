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

import type { CollectionReference } from 'firebase-admin/firestore'

/*
 * THE STORED `suspended` FLAG ON `orgs/{orgId}` AND `hosts/{hostId}` (AGL-3416).
 *
 * The staff Organizations and Sites lists filter Suspended by EQUALITY on
 * this boolean. The suspension itself is the `suspended*` family
 * (`suspendedAt`, `suspendedUntilMs`, …), and "suspended" means the family
 * is an ACTIVE lock: `suspendedAt` set, and no numeric `suspendedUntilMs`
 * that has passed — the definition the rules (`suspensionActive`), the
 * tenant (`isLockdownActive`) and the site status chip share. No query can
 * ask that: `suspendedAt != null` is a range, which the lists' one range
 * (Created) leaves no room for, and "the window has not closed" is a range
 * on a field untimed locks do not carry.
 *
 * So the answer is stored, and kept true at the three moments it can change:
 *
 *   created    `createOrganization` and `claimHostForOrg` write `false`, and
 *              a one-time backfill stamped the orgs and sites written before
 *              them (`docs/SELF_HOSTING.md`). A query cannot find a document
 *              by a field it lacks, so `is Not suspended` needs every
 *              unsuspended document to say so.
 *   written    every writer of the family writes the flag in the same call:
 *              `applyOrgLockdown` and `applyHostLockdown` on lock and lift,
 *              and the abuse-report route when it schedules or cancels a
 *              counter-notice put-back.
 *   lapsed     a timed lock ends with NO write, so its flag outlives it.
 *              `settleLapsedSuspensions` clears every such flag before a
 *              list runs a query that asks about it — so the answer is
 *              exact at the moment the query runs, not at the moment the
 *              lock was written.
 *
 * The rules deny the flag to every client write, beside the family it
 * mirrors.
 */

/** The stored flag's field name, on both documents. */
export const SUSPENDED_FIELD = 'suspended'

/**
 * Whether a `suspended*` family is an active lock at `nowMs`. Pure.
 *
 * No expiry means indefinite; a malformed (non-numeric) expiry keeps the
 * lock, as the rules' `suspensionActive` does.
 */
export function suspensionInForce(
  suspendedAt: unknown,
  suspendedUntilMs: unknown,
  nowMs: number = Date.now(),
): boolean {
  if (suspendedAt == null || suspendedAt === false) return false
  return !(typeof suspendedUntilMs === 'number' && suspendedUntilMs <= nowMs)
}

/** How many flags one settle pass clears per read. */
const SETTLE_PAGE = 400

/** How many reads one settle may take before it stops. */
const SETTLE_MAX_PAGES = 5

/**
 * Clear the flag on every document whose timed lock has lapsed, so an
 * equality on it answers for this moment. Returns how many were cleared.
 *
 * Reads only the documents that need a write — `suspended == true` with an
 * expiry at or before now, one composite per collection — and each write
 * takes its document out of the next read, so no cursor is needed. The
 * family itself is left as written: every enforcing reader already treats a
 * passed expiry as over, and the staff audit trail keeps what was imposed.
 *
 * A pass that hits its bound reports `bounded: true`; the next list request
 * settles the rest.
 */
export async function settleLapsedSuspensions(
  collection: CollectionReference,
  nowMs: number = Date.now(),
): Promise<{ cleared: number; bounded: boolean }> {
  let cleared = 0
  for (let page = 0; page < SETTLE_MAX_PAGES; page += 1) {
    const snapshot = await collection
      .where(SUSPENDED_FIELD, '==', true)
      .where('suspendedUntilMs', '<=', nowMs)
      .limit(SETTLE_PAGE)
      .get()
    if (snapshot.empty) return { cleared, bounded: false }
    const batch = collection.firestore.batch()
    for (const doc of snapshot.docs) batch.update(doc.ref, { [SUSPENDED_FIELD]: false })
    await batch.commit()
    cleared += snapshot.size
    if (snapshot.size < SETTLE_PAGE) return { cleared, bounded: false }
  }
  return { cleared, bounded: true }
}

/**
 * What a list says when one request could not clear every lapsed lock, so a
 * Suspended answer that may still include some of them says so.
 */
export const LAPSED_SUSPENSIONS_NOTICE =
  'More timed suspensions have lapsed than one request clears, so Suspended ' +
  'may still include some of them. Refresh to clear the rest.'

/** Whether a staff list request carries a clause on the flag. */
export function asksAboutSuspension(clauses: ReadonlyArray<{ field: string }>): boolean {
  return clauses.some((clause) => clause.field === SUSPENDED_FIELD)
}
