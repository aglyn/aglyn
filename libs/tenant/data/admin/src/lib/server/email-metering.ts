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

import { firebaseAdmin } from './firebase-admin'

/**
 * The email meters (AGL-1438). **Two of them, deliberately.**
 *
 * Before this, `hosts/{hostId}/counters/emailSends` was written by exactly one
 * caller — the marketing campaign sender. Workflows, commerce, bookings and
 * invites all called `sendEmail` and counted nothing, so the counter that named
 * itself "email sends" held campaign sends alone. Two things followed from
 * that: `emailSendsPerMonth` under-enforced, and the COGS figure AGL-1134
 * started recording off this counter under-reported real email cost by however
 * much non-campaign volume an org sent.
 *
 * UNITS: plain COUNTS — one per recipient address handed to the sender —
 * for the calendar month named by the `YYYY-MM` FIELD on the counter document.
 * Not bytes, not currency, not a running total: each month's field is
 * independent, so summing months is a legitimate year-to-date and reading one
 * is that month alone. Same unit as `workflowRuns`/`actionRuns` beside it, and
 * the same unit `orgCounterTotals` sums, so a campaign of 300 and 300 workflow
 * notifications are the same 300 on the meter.
 *
 * ### `emailSends` — the COST meter. Counts everything. Gates nothing.
 *
 * Every `sendEmail` call site increments this, whatever sent it. It is what the
 * monthly rollup carries for COGS, and it is RECORDED, NOT PRICED — there is
 * still no per-email rate anywhere, so it enters neither `billedCents` nor
 * `costUsd` nor `ORG_COGS_UNIT_RATES_USD`. Pricing it is a decision with an
 * invoice month behind it.
 *
 * ### `campaignEmailSends` — the ENFORCEABLE meter. Counts campaigns only.
 *
 * `emailSendsPerMonth` is checked against this and nothing else. A campaign is
 * discretionary: refusing one at the cap is the outcome the plan sells, the
 * customer sees a clear message, and they upgrade or wait.
 *
 * **Transactional mail is never blocked by a quota, at any tier.** Password
 * resets, invites, order confirmations, booking reminders and workflow
 * notifications send regardless of counter state; they count toward cost and
 * cannot be refused. The failure modes are not symmetric — a blocked password
 * reset locks somebody out of their own account, and the message explaining
 * why is itself an email that will not send; a dropped order confirmation
 * reads to the buyer as a failed order. That converts a billing event into an
 * outage on somebody else's business, where the overage it saved was bounded
 * and billable. It is the same fail-open posture the rest of this codebase
 * takes: rate limiting fails soft, robots/sitemap fail open so a transient
 * error cannot de-index a customer's site.
 *
 * ### Not double-counted
 *
 * One call site, one call to this function, and a campaign send increments BOTH
 * counters from that single call rather than incrementing `emailSends` here and
 * again somewhere else. The counter is keyed by month ON THE DOCUMENT, so
 * nothing accumulates across a re-read, and the rollup re-derives rather than
 * adds. A meter that double-counts is worse than no meter, because it looks
 * authoritative (AGL-1402).
 *
 * ### Transition note
 *
 * `campaignEmailSends` starts empty. For the month this ships, campaign volume
 * already sent is recorded only under the old `emailSends`, so the campaign cap
 * effectively restarts once. That loosens for at most one month, which is the
 * correct direction to be wrong in — the alternative, seeding the enforceable
 * meter from a counter that now also holds transactional mail, would refuse
 * campaigns because of order confirmations.
 */

/** Every send, whatever produced it. The cost meter. */
export const EMAIL_SENDS_COUNTER = 'emailSends'

/** Campaign sends alone. The only meter `emailSendsPerMonth` may refuse. */
export const CAMPAIGN_EMAIL_SENDS_COUNTER = 'campaignEmailSends'

/** Top-level home for platform-scoped meters: `meters/platform/counters/*`. */
export const PLATFORM_METER_COLLECTION = 'meters'
export const PLATFORM_METER_DOC = 'platform'

/**
 * Who the send is attributed to.
 *
 * - `host` — a site sent it: campaigns, receipts, booking mail, workflow
 *   notifications, member mail. Rolls up to the owning org.
 * - `org` — the org sent it with no site involved: invites, member-added,
 *   the welcome mail, usage summaries, erasure notices.
 * - `platform` — Aglyn's own account and staff mail: password resets and
 *   verification (which happen before any org is known), new-device and
 *   passkey alerts, staff alerts, the system-email test send. Real cost, but
 *   not any one customer's, so it is counted apart from every org rollup and
 *   never reaches a COGS figure or an invoice.
 */
export type EmailMeterScope =
  | { kind: 'host'; hostId: string }
  | { kind: 'org'; orgId: string }
  | { kind: 'platform' }

/**
 * Whether a quota may refuse this send.
 *
 * `campaign` is the ONLY discretionary class. Everything else is
 * `transactional`, which means: count it, never gate on it.
 */
export type EmailSendClass = 'campaign' | 'transactional'

export interface RecordEmailSendsOptions {
  scope: EmailMeterScope
  /** Emails actually handed to the sender. Zero and negatives are no-ops. */
  count: number
  sendClass: EmailSendClass
  /** `YYYY-MM`; defaults to the current UTC month. */
  month?: string
  /** Injectable for tests; defaults to the Admin SDK's Firestore. */
  firestore?: any
}

/** The counters document for a scope, e.g. `hosts/{id}/counters/emailSends`. */
export function emailMeterRef(
  firestore: any,
  scope: EmailMeterScope,
  counter: string,
): any {
  if (scope.kind === 'host') {
    return firestore
      .collection('hosts')
      .doc(scope.hostId)
      .collection('counters')
      .doc(counter)
  }
  if (scope.kind === 'org') {
    return firestore
      .collection('orgs')
      .doc(scope.orgId)
      .collection('counters')
      .doc(counter)
  }
  return firestore
    .collection(PLATFORM_METER_COLLECTION)
    .doc(PLATFORM_METER_DOC)
    .collection('counters')
    .doc(counter)
}

/** Current calendar month as `YYYY-MM`, matching every other counter here. */
export function currentMeterMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Records `count` emails against the cost meter, and against the campaign
 * meter too when the send was a campaign.
 *
 * **Never throws.** Metering is bookkeeping that runs after mail has already
 * gone out — a counter write that fails must not turn a delivered receipt into
 * a 500 for the buyer, and must certainly not be able to stop the next send.
 * Failures are logged and swallowed, the same posture `sendEmail` itself takes.
 */
export async function recordEmailSends(
  options: RecordEmailSendsOptions,
): Promise<void> {
  const { scope, sendClass } = options
  const count = Math.floor(Number(options.count))
  // A send that did not happen is not a cost. `sendEmail` reports `sent` per
  // message, and callers pass the delivered count, so 0 is the ordinary
  // outcome of an unconfigured environment rather than an error.
  if (!Number.isFinite(count) || count <= 0) return
  if (scope.kind === 'host' && !scope.hostId) return
  if (scope.kind === 'org' && !scope.orgId) return

  const month = options.month || currentMeterMonth()
  try {
    const firestore = options.firestore ?? firebaseAdmin.app().firestore()
    const increment = firebaseAdmin.firestore.FieldValue.increment(count)
    const counters =
      sendClass === 'campaign'
        ? [EMAIL_SENDS_COUNTER, CAMPAIGN_EMAIL_SENDS_COUNTER]
        : [EMAIL_SENDS_COUNTER]
    await Promise.all(
      counters.map((counter) =>
        emailMeterRef(firestore, scope, counter).set(
          { [month]: increment },
          { merge: true },
        ),
      ),
    )
  } catch (error) {
    console.error('email meter write failed', error)
  }
}

/**
 * One transactional (or, with `sendClass`, campaign) send attributed to a site.
 *
 * The overwhelmingly common call — `await meterHostEmail(hostId)` right after
 * a `sendEmail` — so it reads as one line at every call site and there is one
 * place to change if the counter ever moves.
 */
export function meterHostEmail(
  hostId: string,
  count = 1,
  sendClass: EmailSendClass = 'transactional',
): Promise<void> {
  return recordEmailSends({
    scope: { kind: 'host', hostId },
    count,
    sendClass,
  })
}

/** Org-scoped transactional mail: invites, welcome, usage summaries. */
export function meterOrgEmail(orgId: string, count = 1): Promise<void> {
  return recordEmailSends({
    scope: { kind: 'org', orgId },
    count,
    sendClass: 'transactional',
  })
}

/**
 * Account and staff mail that belongs to no org at send time — a password
 * reset knows only an address, and a staff alert has no customer at all.
 */
export function meterPlatformEmail(count = 1): Promise<void> {
  return recordEmailSends({
    scope: { kind: 'platform' },
    count,
    sendClass: 'transactional',
  })
}

/**
 * The enforceable figure for a site this month: campaign sends alone.
 *
 * Reads the campaign meter and NOT `emailSends`, which now also holds every
 * receipt and password reset the site sent. Enforcing the plan's cap against
 * that total is exactly the behaviour this issue exists to prevent.
 */
export async function campaignEmailSendsForMonth(
  hostRef: any,
  month: string,
): Promise<number> {
  const snapshot = await hostRef
    .collection('counters')
    .doc(CAMPAIGN_EMAIL_SENDS_COUNTER)
    .get()
  const used = Number(snapshot.get(month) ?? 0)
  // An absent counter is 0, and a corrupt negative must not read as unused
  // headroom that a cap then honours.
  return Number.isFinite(used) && used > 0 ? used : 0
}

/**
 * Volume above the plan's included band, in emails.
 *
 * Transactional mail is never refused, so an org CAN and will finish a month
 * over its included allowance. That is not an error and not a failed send —
 * it is the overage the cap chose not to enforce, and recording it is what
 * keeps it from being a surprise at invoicing. `UNLIMITED` (and any
 * non-positive limit, which is how "no included allowance" is expressed)
 * yields 0 rather than the whole month's volume.
 */
export function emailSendsOverage(total: number, limit: number): number {
  const sends = Number(total)
  const included = Number(limit)
  if (!Number.isFinite(sends) || sends <= 0) return 0
  if (!Number.isFinite(included) || included <= 0) return 0
  return Math.max(0, sends - included)
}

export default recordEmailSends
