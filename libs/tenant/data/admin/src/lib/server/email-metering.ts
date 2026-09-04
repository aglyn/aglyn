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
 * The org-level campaign meter, and the ONLY figure `emailSendsPerMonth` is
 * enforced against since AGL-2267.
 *
 * ## Why a second counter and not the per-host one
 *
 * `hosts/{hostId}/counters/campaignEmailSends` is per SITE. `emailSendsPerMonth`
 * is an ORG entitlement. An org with N sites therefore received N × the cap it
 * bought — invisible on Free and Starter (`hostLimit: 1`) and growing with the
 * plan, so the customers who paid most got the most cap they had not paid for.
 *
 * The per-host counter is UNCHANGED and still written, by `meterHostEmail`, on
 * the delivered count. It is per-site history and it feeds the cost meter;
 * nothing about it was wrong except being asked a question about an org.
 *
 * ## Why folding the existing per-site counters in was rejected
 *
 * Summing N site counters into one org total retroactively puts multi-site
 * paying customers over a limit they have been under all along — a limit that
 * then refuses a campaign they had every reason to expect to send, days after
 * they bought the plan. This counter therefore STARTS EMPTY, and the campaign
 * cap effectively restarts once for the month this ships.
 *
 * That is the same transition `campaignEmailSends` itself was given, and the
 * same reasoning: it loosens for at most one month, which is the correct
 * direction to be wrong in, and it needs no production measurement of who is
 * currently over — a measurement that could only be taken against live
 * customer data and would have blocked the fix indefinitely.
 */
export const ORG_CAMPAIGN_EMAIL_SENDS_COUNTER = CAMPAIGN_EMAIL_SENDS_COUNTER

/** A granted claim on the org's monthly campaign allowance. */
export interface CampaignSendReservation {
  orgId: string
  month: string
  /** Messages claimed up front. */
  reserved: number
}

export type ReserveCampaignSendsResult =
  | { ok: true; reservation: CampaignSendReservation; used: number; limit: number }
  | { ok: false; used: number; limit: number }

/** Reads an org-scoped monthly counter field, clamped like every other. */
function readMonthField(snapshot: any, month: string): number {
  const used = Number((snapshot?.exists ? snapshot.get(month) : 0) ?? 0)
  return Number.isFinite(used) && used > 0 ? Math.floor(used) : 0
}

/**
 * The enforceable figure for an ORG this month: campaign sends alone.
 *
 * Read-only. Used by the campaign composer's recipient preview, which must
 * not reserve anything (AGL-2178 — "nothing has been written above this
 * line"), and by anything that reports headroom.
 */
export async function orgCampaignEmailSendsForMonth(
  orgId: string,
  month: string,
  firestore?: any,
): Promise<number> {
  if (!orgId) return 0
  const db = firestore ?? firebaseAdmin.app().firestore()
  const snapshot = await db
    .collection('orgs')
    .doc(orgId)
    .collection('counters')
    .doc(ORG_CAMPAIGN_EMAIL_SENDS_COUNTER)
    .get()
  return readMonthField(snapshot, month)
}

/**
 * Claims `count` campaign sends against the org's monthly allowance, ATOMICALLY.
 *
 * ## Why a reservation and not a check
 *
 * The cap used to be read before the send and incremented after delivery, so
 * two concurrent campaigns both passed the same reading and both sent — the
 * cap was advisory in exactly the conditions it existed for. **A read-then-write
 * cap is not a cap.**
 *
 * The transaction reads the counter and writes an ABSOLUTE value derived from
 * that read, deliberately not `FieldValue.increment`. Firestore aborts and
 * re-runs the callback when a document the transaction read has moved, so a
 * second sender that starts inside the first one's window re-reads the raised
 * figure and is refused. An increment would be atomic on the number and
 * useless for the decision, because the decision is made from a value the
 * write never proves it still held.
 *
 * A refused reservation writes NOTHING.
 *
 * ## Why reserve-then-reconcile rather than reserve-and-keep
 *
 * A campaign reserves against a PARTIAL delivery: `sendEmail` reports per
 * message, and only some of a 500-address batch may go out. Keeping the whole
 * reservation would charge a customer's allowance for mail that never left.
 * So the claim is taken in full up front — that is what makes it a cap — and
 * {@link reconcileCampaignSendReservation} gives back the difference once the
 * delivered count is known.
 *
 * **The failure mode is stated rather than hidden**: if the process dies
 * between reserving and reconciling, the org is charged for the undelivered
 * remainder for the rest of that calendar month. That is conservative in the
 * direction this issue cares about — it can only ever refuse more mail, never
 * let more out — and it self-heals at the month boundary, because each month
 * is an independent field on the document.
 *
 * `limit` may be `Infinity` (`UNLIMITED`), which admits everything.
 */
export async function reserveCampaignEmailSends(options: {
  orgId: string
  month: string
  count: number
  limit: number
  firestore?: any
}): Promise<ReserveCampaignSendsResult> {
  const count = Math.max(0, Math.floor(Number(options.count) || 0))
  const limit = Number(options.limit)
  // A plan-less or unresolvable org must not be a bypass. The caller resolves
  // free-tier entitlements for it (AGL-247) and the cap is 0, so an empty
  // orgId that reached here means the counter has nowhere to live — refuse
  // rather than send unbounded.
  if (!options.orgId) {
    return { ok: false, used: 0, limit: Number.isFinite(limit) ? limit : 0 }
  }
  const db = options.firestore ?? firebaseAdmin.app().firestore()
  const ref = db
    .collection('orgs')
    .doc(options.orgId)
    .collection('counters')
    .doc(ORG_CAMPAIGN_EMAIL_SENDS_COUNTER)

  return db.runTransaction(async (tx: any) => {
    const snapshot = await tx.get(ref)
    const used = readMonthField(snapshot, options.month)
    if (used + count > limit) return { ok: false, used, limit }
    tx.set(ref, { [options.month]: used + count }, { merge: true })
    return {
      ok: true,
      reservation: { orgId: options.orgId, month: options.month, reserved: count },
      used,
      limit,
    }
  })
}

/**
 * Returns the undelivered part of a reservation.
 *
 * Also a transaction, and also an absolute write from its own read: a refund
 * computed from a stale figure would undo a reservation another campaign took
 * in the meantime, which is the same defect one direction over.
 *
 * **Never throws** and never drives the counter below zero. This runs after
 * mail has already gone out; a bookkeeping failure must not turn a delivered
 * campaign into a 500, exactly like `recordEmailSends` above. The cost of
 * swallowing it is that the org keeps a claim it did not use for the rest of
 * the month, which is the safe direction.
 */
export async function reconcileCampaignSendReservation(
  reservation: CampaignSendReservation | null | undefined,
  delivered: number,
  firestore?: any,
): Promise<void> {
  if (!reservation?.orgId) return
  const sent = Math.max(0, Math.floor(Number(delivered) || 0))
  const refund = Math.max(0, reservation.reserved - sent)
  if (refund <= 0) return
  try {
    const db = firestore ?? firebaseAdmin.app().firestore()
    const ref = db
      .collection('orgs')
      .doc(reservation.orgId)
      .collection('counters')
      .doc(ORG_CAMPAIGN_EMAIL_SENDS_COUNTER)
    await db.runTransaction(async (tx: any) => {
      const snapshot = await tx.get(ref)
      const used = readMonthField(snapshot, reservation.month)
      tx.set(
        ref,
        { [reservation.month]: Math.max(0, used - refund) },
        { merge: true },
      )
    })
  } catch (error) {
    console.error('campaign reservation reconcile failed', error)
  }
}

/**
 * Volume above the plan's included band, in emails — RE-EXPORTED, not defined
 * here, the same move AGL-2155 made for the bandwidth helpers.
 *
 * The definition moved down to `@aglyn/aglyn/app-utils/plan-entitlements`
 * because the billing page has to render the overage BEFORE it is charged,
 * and that page is a client component which cannot import this module: the
 * Admin SDK comes with it. A second copy of the subtraction on the client is
 * the shape where the readout and the invoice quietly stop agreeing.
 *
 * Re-exported so every server caller keeps importing it from the module it
 * always did — one definition, no drift, no import churn.
 *
 * @see priceEmailSendOverage — what the excess costs, at the plan's rate.
 */
export { emailSendsOverage } from '@aglyn/aglyn/app-utils/plan-entitlements'

export default recordEmailSends
