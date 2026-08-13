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
 * `orgLibraryBytes` is the ONE exception and is named so it cannot be mistaken
 * for one of the three (AGL-1473). It is BYTES, CUMULATIVE, and read off the
 * counter's `bytes` field rather than a `YYYY-MM` one — the same shape and the
 * same meaning as `hosts/{id}/counters/media.bytes`, which `hostUsage` already
 * reads. It lives here only because it rides the same `getAll`; see the ref
 * block below for why that matters.
 *
 * `emailSends` also picks up ORG-SCOPED mail when `orgRef` is supplied
 * (AGL-1438): invites, member-added, the welcome email and usage summaries
 * belong to the org and to no site, so they live at
 * `orgs/{orgId}/counters/emailSends` in the same `YYYY-MM` shape. Same unit —
 * one invite is one email is one receipt — so the two add. Omitting them
 * would leave this total with exactly the defect it was written to fix.
 *
 * `orgLibraryBytes` is that same defect one scope over (AGL-1473).
 * `resolveMediaScope` serves two libraries and the counter follows the scope:
 * a site upload moves `hosts/{id}/counters/media`, an org DAM upload moves
 * `orgs/{id}/counters/media`. Both are enforced against `storagePerHostMb`;
 * only the first was ever summed by anything that turns bytes into money. So
 * org-library bytes were gated at upload and then dropped before pricing —
 * measured, refused when over cap, and invisible to the invoice.
 *
 * It is NOT summed into anything here, and must not be: bytes are not sends.
 * The caller adds it to the storage meter as one more snapshot, where it is
 * the same unit as every host's `media.bytes`.
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
): Promise<{
  emailSends: number
  workflowRuns: number
  actionRuns: number
  /** BYTES stored in the org library, cumulative — not a count, not monthly. */
  orgLibraryBytes: number
}> {
  const names = ['emailSends', 'workflowRuns', 'actionRuns'] as const
  const totals = {
    emailSends: 0,
    workflowRuns: 0,
    actionRuns: 0,
    orgLibraryBytes: 0,
  }
  if (hostRefs.length === 0 && !orgRef) return totals
  const refs = hostRefs.flatMap((hostRef) =>
    names.map((name) => hostRef.collection('counters').doc(name)),
  )
  // Two extra refs for the whole org, not two per host — org-scoped mail and
  // the org library both have no site, so neither can fan out and this stays
  // inside the same round trip the chunked sweep already pays for (AGL-1141).
  //
  // ORDER IS LOAD-BEARING and the reader below depends on it: the two org refs
  // are appended, in this order, AFTER the host block. Everything past
  // `hostSnapshotCount` is read by position, because the modulo pairing that
  // serves the host block would otherwise assign an org total to whichever
  // counter name the index happened to fall on — which is how one appended ref
  // becomes an email bill for a photo library.
  const orgAppended: Array<'emailSends' | 'media'> = []
  if (orgRef) {
    refs.push(orgRef.collection('counters').doc('emailSends'))
    orgAppended.push('emailSends')
    refs.push(orgRef.collection('counters').doc('media'))
    orgAppended.push('media')
  }
  const snapshots = await firestore.getAll(...refs)
  const hostSnapshotCount = hostRefs.length * names.length
  snapshots.forEach((snapshot, index) => {
    if (index >= hostSnapshotCount) {
      const appended = orgAppended[index - hostSnapshotCount]
      // The org library counter is keyed by `bytes`, NOT by month — it is a
      // running total of what is stored, exactly like every host's. Reading
      // `month` here would report 0 for every org that exists.
      const raw = Number(
        snapshot.get(appended === 'media' ? 'bytes' : month) ?? 0,
      )
      if (!Number.isFinite(raw) || raw <= 0) return
      if (appended === 'media') totals.orgLibraryBytes += raw
      else totals.emailSends += raw
      return
    }
    const name = names[index % names.length]
    const value = Number(snapshot.get(month) ?? 0)
    // A counter that has never been written is absent, and a corrupt one
    // must not become a negative meter — same posture as the cost model,
    // where a negative would read as a credit.
    if (Number.isFinite(value) && value > 0) totals[name] += value
  })
  return totals
}
