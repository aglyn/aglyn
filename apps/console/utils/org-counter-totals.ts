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
 * The three per-host monthly counters the rollup never carried (AGL-1134),
 * summed across the org's hosts for `month`.
 *
 * AGL-1134 asked for email sends and workflow/action runs "not currently
 * metered per org". They ARE counted — `hosts/{hostId}/counters/{name}`, one
 * document per counter whose FIELDS are `YYYY-MM` keys holding an integer —
 * and they are enforced per org: `usage-alerts` sums exactly these three and
 * threshold-checks them against `emailSendsPerMonth`, `workflowRunsPerMonth`
 * and `actionRunsPerMonth`. But that sum is computed in memory and thrown
 * away. Nothing has ever persisted an org-level figure, so there is no
 * history, nothing for the cost model to price, and no way to answer "how
 * much did this org actually use" after the fact.
 *
 * UNITS: plain COUNTS for the calendar month named by `month` — emails
 * handed to the sender, and workflow/action executions that actually ran.
 * Not bytes, not currency, and not a running total: each month's field is
 * independent, so summing months is a legitimate year-to-date and reading
 * one is that month alone.
 *
 * `emailSends` also picks up ORG-SCOPED mail when `orgRef` is supplied
 * (AGL-1438): invites, member-added, the welcome email and usage summaries
 * belong to the org and to no site, so they live at
 * `orgs/{orgId}/counters/emailSends` in the same `YYYY-MM` shape. Same unit —
 * one invite is one email is one receipt — so the two add. Omitting them
 * would leave this total with exactly the defect it was written to fix.
 *
 * Account and staff mail (password resets, verification, security alerts,
 * staff alerts) is counted at `meters/platform/counters/emailSends` and
 * deliberately NOT summed here: it is Aglyn's own cost, belongs to no
 * customer, and must not reach any org's rollup or COGS.
 *
 * NOT double-counted and not missed: the counter is keyed by month ON THE
 * DOCUMENT, so re-running this cron for a closed month reads the same field
 * and re-derives the same sum rather than accumulating. `reportedAt` guards
 * the write side separately.
 *
 * Known attribution edge, shared with every other meter here: a host that
 * changed orgs mid-month contributes its whole month to whichever org owns
 * it at rollup time. Recorded rather than fixed — `byOrg` is built from the
 * hosts' current `orgId`, so fixing it means dated ownership, not a change
 * to this function.
 *
 * One `getAll` rather than 3×N gets: this runs per org inside a chunked
 * sweep that has already 504'd once (AGL-1141), so a meter that costs an
 * extra round trip per host per counter is not worth its own data.
 */
export async function orgCounterTotals(
  firestore: FirebaseFirestore.Firestore,
  hostRefs: FirebaseFirestore.DocumentReference[],
  month: string,
  orgRef?: FirebaseFirestore.DocumentReference,
): Promise<{ emailSends: number; workflowRuns: number; actionRuns: number }> {
  const names = ['emailSends', 'workflowRuns', 'actionRuns'] as const
  const totals = { emailSends: 0, workflowRuns: 0, actionRuns: 0 }
  if (hostRefs.length === 0 && !orgRef) return totals
  const refs = hostRefs.flatMap((hostRef) =>
    names.map((name) => hostRef.collection('counters').doc(name)),
  )
  // One extra ref for the whole org, not one per host — org-scoped mail has
  // no site, so it cannot fan out and this stays inside the same round trip
  // the chunked sweep already pays for (AGL-1141).
  const orgCounterRef = orgRef
    ? orgRef.collection('counters').doc('emailSends')
    : null
  if (orgCounterRef) refs.push(orgCounterRef)
  const snapshots = await firestore.getAll(...refs)
  const hostSnapshotCount = hostRefs.length * names.length
  snapshots.forEach((snapshot, index) => {
    // The org counter is appended AFTER the host block, so the modulo pairing
    // must not run past the end of it — otherwise the org's email total would
    // land on whichever counter name the index happened to fall on.
    const name =
      index >= hostSnapshotCount ? 'emailSends' : names[index % names.length]
    const value = Number(snapshot.get(month) ?? 0)
    // A counter that has never been written is absent, and a corrupt one
    // must not become a negative meter — same posture as the cost model,
    // where a negative would read as a credit.
    if (Number.isFinite(value) && value > 0) totals[name] += value
  })
  return totals
}
