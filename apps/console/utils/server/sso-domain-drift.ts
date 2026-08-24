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
 * Shaping the SSO domain re-verification sweep's findings (AGL-1210).
 *
 * Pure, and separate from the route for the reason every sibling here is: the
 * route needs Firestore and DNS to run at all, and the thing most worth
 * testing is what the sweep CONCLUDES — above all that it refuses to conclude
 * anything from an outage.
 */

/** What one live routing domain's re-check established. */
export type SsoDomainOutcome =
  /** The challenge record still proves ownership. The healthy majority. */
  | 'proven'
  /** Conclusively failing, but not for long enough to report yet. */
  | 'counting'
  /** Failing conclusively, repeatedly, for weeks. Somebody is told. */
  | 'drifted'
  /** DNS did not answer. Establishes NOTHING, and is counted as nothing. */
  | 'unreachable'
  /** Staff-attested, never DNS-proven — there is no record to re-check. */
  | 'skipped-attested'
  /** A live routing doc with no claim behind it. Reported, never acted on. */
  | 'orphan-routing'

export interface SsoDomainDriftEntry {
  orgId: string
  domain: string
  outcome: SsoDomainOutcome
  /** Conclusive failures in a row, after this probe. */
  consecutiveFailures: number
  /** Whole days since the run began. Null when there is no run. */
  daysFailing: number | null
  /** What the lookup saw instead — "gone" and "somebody else's" differ. */
  records: string[]
}

export interface SsoDriftSummary {
  checked: number
  proven: number
  counting: number
  unreachable: number
  skipped: number
  /** The rows a human has to decide about. Nothing was revoked for them. */
  drifted: SsoDomainDriftEntry[]
  /** Routing docs with no claim document behind them. */
  orphans: SsoDomainDriftEntry[]
  /**
   * Did this sweep establish anything at all?
   *
   * A run where every probe came back `unreachable` must NOT render as
   * "0 drifted" — that is a swallowed query reported as a measured zero, and
   * it reads as a clean bill of health for a check that never ran. The board
   * and the response both need the third state.
   */
  inconclusive: boolean
}

export function summariseSsoDrift(
  entries: readonly SsoDomainDriftEntry[],
): SsoDriftSummary {
  const of = (outcome: SsoDomainOutcome) =>
    entries.filter((entry) => entry.outcome === outcome)
  const conclusive = entries.filter(
    (entry) =>
      entry.outcome === 'proven' ||
      entry.outcome === 'counting' ||
      entry.outcome === 'drifted',
  )
  const probed = conclusive.length + of('unreachable').length
  return {
    checked: entries.length,
    proven: of('proven').length,
    counting: of('counting').length,
    unreachable: of('unreachable').length,
    skipped: of('skipped-attested').length,
    drifted: of('drifted'),
    orphans: of('orphan-routing'),
    // Only a sweep that PROBED something and learned nothing is inconclusive.
    // A sweep with nothing to probe (no SSO orgs, or every domain attested)
    // is idle, not blind, and must read green — the `usage-email` lesson from
    // the cron board one subsystem over.
    inconclusive: probed > 0 && conclusive.length === 0,
  }
}

/**
 * What the org's own admins are told, in words, before anything breaks.
 *
 * Deliberately explicit that NOTHING HAS CHANGED YET. The failure mode of a
 * warning like this is a customer reading it as an outage notice and paging
 * their own on-call at 3am over a DNS record they can fix on Monday.
 */
export function driftOrgEmailText(
  entry: SsoDomainDriftEntry,
  origin: string,
): string {
  const seen = entry.records.length
    ? `We did see other TXT records at that name, so the zone is answering — ` +
      `the challenge record specifically is what is no longer there.`
    : `We saw no TXT record at that name at all.`
  return [
    `Single sign-on for ${entry.domain} is still working. Nothing has been ` +
      `turned off, and nothing will be turned off automatically.`,
    ``,
    `When you set up SSO for ${entry.domain}, you proved you owned it by ` +
      `publishing a DNS TXT record. We re-check that record periodically. It ` +
      `has now failed ${entry.consecutiveFailures} checks in a row` +
      (entry.daysFailing === null ? `` : ` over ${entry.daysFailing} days`) +
      `.`,
    ``,
    seen,
    ``,
    `This usually means the record was tidied up during a DNS migration. It ` +
      `matters because the record is how we know your organization still ` +
      `controls ${entry.domain} — and that is what stops anyone else routing ` +
      `sign-ins for it.`,
    ``,
    `Please restore it, or remove the domain if you no longer use it:`,
    `${origin}/settings/sso`,
  ].join('\n')
}

/** The staff-side line. Terse, and says the one thing staff must not assume. */
export function driftStaffAlertText(
  summary: SsoDriftSummary,
  origin: string,
): string {
  const rows = summary.drifted
    .map(
      (entry) =>
        `  ${entry.domain} (org ${entry.orgId}) — ${entry.consecutiveFailures} ` +
        `consecutive failures` +
        (entry.daysFailing === null ? '' : ` over ${entry.daysFailing} days`),
    )
    .join('\n')
  return [
    `${summary.drifted.length} SSO domain(s) no longer prove ownership by DNS.`,
    ``,
    rows,
    ``,
    `ROUTING IS UNCHANGED. These domains still send their sign-ins to the ` +
      `org's IdP. This job never revokes — revoking is a human decision, ` +
      `because a revoke logs out everyone at that domain.`,
    ``,
    `The org's admins have been emailed. Give them time to restore the ` +
      `record before considering revocation.`,
    ``,
    `${origin}/admin/orgs`,
  ].join('\n')
}
