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

import { FieldValue } from 'firebase-admin/firestore'

/**
 * THE RUN METERS (AGL-3472): where a workflow run and an action run are
 * counted, and the figure each monthly band is enforced against.
 *
 * `workflowRunsPerMonth` and `actionRunsPerMonth` are WORKSPACE bands: the
 * plan sells one allowance to the organization, and the cost model prices it
 * once per organization. Compared against one SITE's counter, the band would
 * be handed to every site whole — the real cap the band times the number of
 * sites, so a hundred-site workspace runs a hundred times what it bought.
 *
 * So each run is counted twice, in ONE batched write:
 *
 * - `hosts/{hostId}/counters/{counter}` — the site's share, as always. The
 *   usage sweep, the usage alerts and the cost rollup sum it across the
 *   workspace's sites, and it is the per-site history.
 * - `orgs/{orgId}/counters/{counter}` — the workspace's total, which the band
 *   is enforced against. Same shape: one integer per `YYYY-MM` field.
 *
 * Because both move in the same commit, the org figure and the sum of the
 * site figures are one number from the month the org counter was seeded on.
 *
 * ## Seeding
 *
 * Started empty, the org counter would hand an existing workspace a fresh
 * band in the middle of a month its sites had already been running in. The
 * first gate that finds it without `seededFrom` therefore seeds it: one
 * query for the workspace's sites, one `getAll` of their counters, inside a
 * transaction that writes the month's sum and `seededFrom`. From then on every
 * run reaches it through {@link recordRuns}, so it is complete for every later
 * month as well — a workspace is seeded once, never once a month.
 *
 * A run counted before the seed (a flow resuming, which is counted and never
 * gated) can create the month's field first. The seed overwrites it with the
 * sites' sum, which already holds that run, so nothing is counted twice.
 *
 * A site with no organization — unindexed, which the billing lookup answers
 * as no owner — has no workspace to share a band with, and keeps the site
 * counter as its figure, exactly as before.
 */

/** The two run meters, each named for its per-site and per-org counter. */
export type RunCounter = 'workflowRuns' | 'actionRuns'

/**
 * The org counter's marker: the first month (`YYYY-MM`) it holds every run
 * of. Absent, or later than the month asked about, and the counter is not yet
 * the workspace's figure for it.
 */
export const ORG_RUN_COUNTER_SEEDED_FROM = 'seededFrom'

/** The `YYYY-MM` field every run counter keys a calendar month by (UTC). */
export function runMonthKey(at: Date | number = new Date()): string {
  return new Date(at).toISOString().slice(0, 7)
}

/** `orgs/{orgId}/counters/{counter}` — the workspace's run total. */
export function orgRunCounterRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  counter: RunCounter,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection('counters')
    .doc(counter)
}

/**
 * A month's count off a counter snapshot. An absent counter is 0, and a
 * corrupt negative must not read as headroom a cap then honors.
 */
function monthCount(
  snapshot: FirebaseFirestore.DocumentSnapshot | undefined,
  month: string,
): number {
  const value = Number(snapshot?.get(month) ?? 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Whether the org counter holds every run of `month`. */
function holdsMonth(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  month: string,
): boolean {
  const from = snapshot.exists
    ? snapshot.get(ORG_RUN_COUNTER_SEEDED_FROM)
    : undefined
  return typeof from === 'string' && from <= month
}

export interface RunMeterScope {
  firestore: FirebaseFirestore.Firestore
  /** The site the run belongs to. */
  hostRef: FirebaseFirestore.DocumentReference
  /** The organization that owns the site; absent for an unindexed site. */
  orgId: string | null | undefined
  counter: RunCounter
  /** `YYYY-MM` — {@link runMonthKey}. */
  month: string
}

/**
 * The runs the band has already spent this month: the WORKSPACE's total,
 * which is what `workflowRunsPerMonth` and `actionRunsPerMonth` sell.
 *
 * Read-then-run-then-count, like every run gate here before it: a run is not
 * reserved, so two events inside the same moment can both pass the last
 * slot. The overshoot that buys is bounded by concurrency, and making it
 * exact would mean holding a transaction open across the run itself.
 */
export async function runsUsedThisMonth(scope: RunMeterScope): Promise<number> {
  const { firestore, hostRef, orgId, counter, month } = scope
  if (!orgId) {
    // Read exactly as the site gate always read it: a field that is no
    // number refuses nothing rather than everything.
    const snapshot = await hostRef.collection('counters').doc(counter).get()
    return Number(snapshot.get(month) ?? 0)
  }
  const ref = orgRunCounterRef(firestore, orgId, counter)
  const snapshot = await ref.get()
  if (holdsMonth(snapshot, month)) return monthCount(snapshot, month)
  return await seedOrgRunCounter(firestore, ref, orgId, counter, month)
}

/**
 * Seeds the workspace's counter from its sites' counters for `month`, once.
 *
 * The sites are found outside the transaction — which sites a workspace has
 * is not what the seed has to be exact about — and their counters are read
 * inside it, beside the org counter, so a run counted on any of them while
 * the seed is being taken makes it retry rather than be lost or doubled. A
 * second gate that lost the race reads the winner's figure and writes nothing.
 */
async function seedOrgRunCounter(
  firestore: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  orgId: string,
  counter: RunCounter,
  month: string,
): Promise<number> {
  const sites = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .get()
  const siteCounters = sites.docs.map((site) =>
    site.ref.collection('counters').doc(counter),
  )
  return await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(ref)
    if (holdsMonth(current, month)) return monthCount(current, month)
    const counted = siteCounters.length
      ? await transaction.getAll(...siteCounters)
      : []
    const used = counted.reduce(
      (sum, snapshot) => sum + monthCount(snapshot, month),
      0,
    )
    transaction.set(
      ref,
      { [month]: used, [ORG_RUN_COUNTER_SEEDED_FROM]: month },
      { merge: true },
    )
    return used
  })
}

/**
 * Counts `count` runs on the site's counter and the workspace's, in one
 * batched write, so the two cannot disagree about a run.
 *
 * Never throws: it runs after the work it counts has happened, and a counter
 * write that fails must not turn a run that happened into an error for the
 * request that set it off.
 */
export async function recordRuns(
  scope: RunMeterScope & { count: number },
): Promise<void> {
  const { firestore, hostRef, orgId, counter, month, count } = scope
  if (!(count > 0)) return
  const siteCounter = hostRef.collection('counters').doc(counter)
  const increment = { [month]: FieldValue.increment(count) }
  try {
    if (!orgId) {
      await siteCounter.set(increment, { merge: true })
      return
    }
    const batch = firestore.batch()
    batch.set(siteCounter, increment, { merge: true })
    batch.set(orgRunCounterRef(firestore, orgId, counter), increment, {
      merge: true,
    })
    await batch.commit()
  } catch {
    // Swallowed by contract — see above.
  }
}
