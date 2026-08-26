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
 * Flat platform ceilings on the two host subcollections an ANONYMOUS VISITOR
 * can create documents in (AGL-1529).
 *
 * ## the decision, 2026-08-23, in his own words
 *
 * > A platform-wide ceiling — **not a plan dimension**, so "unlimited member
 * > accounts on every plan" stays true, because **an abuse control is not
 * > something we sell**. Same instrument already approved twice: **AGL-1655**
 * > for forms and **AGL-2155** for bandwidth.
 *
 * ## Why it is not a plan dimension, and must never become one
 *
 * AGL-889 decided member accounts are UNLIMITED on every plan as a PRICING
 * matter, and `/pricing` says so. A cap that varied by plan would make that
 * sentence false the moment it shipped. So there is no `OrgEntitlements` key
 * here, no `PLAN_ENTITLEMENTS` row, no band and nothing to re-price: every
 * plan, free through enterprise, gets the same number, and the number exists
 * only to answer the question `checkFormSubmissionAbuseCeiling`'s docblock
 * poses — *"is this still a customer's traffic at all?"* A plan gate asks
 * whether the customer bought this; this asks whether a customer is involved.
 *
 * ## The hole this closes
 *
 * `hosts/{hostId}/siteMembers` and `hosts/{hostId}/leads` were bounded by
 * NOTHING. Both are written on behalf of anonymous visitors on a public site
 * (`membershipRegisterHandler`, the two bookings lead paths), and the only
 * bound was `visitorWriteRateLimitRefusal` — keyed on (host, IP), fails soft,
 * and bounds the RATE rather than the TOTAL. That is verbatim the sentence
 * AGL-2265 used as its reason for adding the free-workspace ceiling, and the
 * shape AGL-2266 closed for `actions` and `entries`: unbounded Firestore
 * documents behind a $0 subscription.
 *
 * ## Why the shape here is the FLAT family, not the MULTIPLE family
 *
 * The two ceilings Zach named as precedent — `FORM_ABUSE_CEILING_*` and
 * `BANDWIDTH_ABUSE_CEILING_*` — are both `max(floor, included × 10)`. They
 * can be, because forms and bandwidth each have an *included band* on the
 * price list to multiply. Members and leads have no included band by
 * construction (that is the whole point of AGL-889), so there is nothing to
 * multiply and a multiple would have to invent a plan dimension to have an
 * operand — the exact thing the decision forbids.
 *
 * The repo already has the family for that case, and those same docblocks
 * point at it: `WEBHOOK_MAX_PER_HOST` (AGL-1360), `NON_PAGE_SCREEN_MAX_PER_HOST`
 * (AGL-1399), `ACTIONS_MAX_PER_HOST` / `ENTRIES_MAX_PER_COLLECTION` (AGL-2266),
 * `AUTHORS_MAX_PER_HOST` (AGL-2486) — *"a flat PLATFORM cap with no
 * `OrgEntitlements` key, no variation by plan, and nothing on the price list
 * to explain."* So the two named precedents supply the POSTURE (containment,
 * not capacity; a trip is an incident, not a quota; the refusal must be
 * visible to the host and opaque to the visitor) and the flat family supplies
 * the SHAPE. They do not disagree; they answer different halves.
 *
 * ## A TOTAL, not a monthly count — the one place the posture differs
 *
 * `FORM_ABUSE_CEILING` and `BANDWIDTH_ABUSE_CEILING` both count a month and
 * therefore self-clear at the month boundary with nobody doing anything. These
 * count LIVE DOCUMENTS, which do not. The refusal counters below are still
 * month-keyed — that is a rate of refusals, and it is what the owner's notice
 * reports — but the ceiling itself is cleared by deleting members or leads (or
 * by support raising it), and the owner's notice must not promise a date. A
 * notice that said "accepting again on 1 September" would be a promise the
 * platform does not keep.
 */

/**
 * How many member accounts one site may hold (AGL-1529). the figure.
 *
 * Sized to the busiest plausible membership site rather than to today's data,
 * which is the only property a flat ceiling needs. A site member is a human
 * who chose a password on ONE site; 50,000 of them is a large membership
 * roster — larger than anything on the platform and larger than anything the
 * beta will produce — while a script wants millions and reaches this in an
 * afternoon. Every account past it is refused, none is billed, and none of
 * it changes what any plan includes.
 *
 * Counted as LIVE documents, so removing a member in the inbox frees the
 * slot. Counting tombstones would be AGL-1173's bug one collection over.
 */
export const SITE_MEMBERS_MAX_PER_HOST = 50_000

/**
 * How many lead records one site may hold (AGL-1529).
 *
 * **Deliberately NOT the same number as {@link SITE_MEMBERS_MAX_PER_HOST}**,
 * because they are different objects with different accumulation:
 *
 *  - A member is DEDUPED by email — one address is one member document, ever.
 *  - A lead is APPEND-ONLY and deduped by nothing. Every sign-up writes one,
 *    and so does every booking (`libs/plugins/bookings/src/lib/server.ts`
 *    writes one on the free path and one on the paid-checkout path), so one
 *    returning customer legitimately produces many.
 *
 * So on any real site the lead collection outgrows the member collection, and
 * equal numbers would make the LEAD ceiling the one that trips first — on a
 * site doing nothing wrong, refusing a record for a reason that has nothing
 * to do with the visitor in front of it. 4× keeps the member ceiling the
 * binding one on the path they share while still being a bound: 200,000 lead
 * rows at ~200 bytes is ~40 MB, which is a number, and unbounded is not.
 */
export const LEADS_MAX_PER_HOST = 200_000

/**
 * Refusal code carried by the sign-up 429 (AGL-1529).
 *
 * The dispatcher's per-(host, IP) rate limiter answers 429 too, so the STATUS
 * discriminates nothing — this code is the whole discriminator, and one means
 * "slow down" while the other means "this site is not taking new accounts".
 * Shared rather than restated so producer and consumer cannot drift, exactly
 * as `FORM_ABUSE_CEILING_CODE` is.
 */
export const SITE_MEMBER_CEILING_CODE = 'site-member-ceiling'

/**
 * The visitor's sentence, under the three rules `FORM_UNAVAILABLE_MESSAGE`
 * established (AGL-1666) and for the identical reason: the person reading it
 * is a stranger to the site and NOT our customer.
 *
 *  1. **It does not blame them.** They filled the form in correctly. Nothing
 *     about their address, their password or their retry is the reason.
 *  2. **It does not explain.** "Unusual volume", "this site is at its member
 *     limit", or anything naming Aglyn, tells a stranger something about the
 *     site owner's account that the owner never chose to publish — and names
 *     a platform the visitor did not come here to hear about.
 *  3. **It does not sound successful.** It says, in as many words, that the
 *     account was not created, so nobody walks away believing they have one
 *     and waiting for an email that is never coming.
 */
export const SITE_MEMBER_UNAVAILABLE_MESSAGE =
  'This site isn’t accepting new accounts right now, so your account was ' +
  'not created. Please try again later.'

/** The verdict every enforcement point below asks for. */
export interface VisitorRecordCeilingResult {
  /** True once the live document count has REACHED the ceiling. */
  exceeded: boolean
  /** The ceiling that was compared against. Always a finite integer. */
  ceiling: number
  /** The count that was compared, floored at 0. */
  used: number
}

/**
 * Is this site at a flat visitor-record ceiling?
 *
 * The ceiling is an explicit argument rather than read from a table, so the
 * suite can re-drive the SAME usage against a ceiling one higher and require
 * it to succeed — the causation leg of `free-tier-caps-refuse.spec.ts`, which
 * is the only thing that distinguishes "refused by THIS cap" from "refuses
 * everything". No production caller passes anything but the two constants
 * above; {@link checkSiteMemberCeiling} and {@link checkLeadCeiling} bind them.
 *
 * `strictNullChecks` is OFF repo-wide, so both inputs are normalised rather
 * than trusted, and the two directions are deliberately NOT symmetric:
 *
 *  - `used` folds a missing/NaN count to 0, matching `checkBandwidthAbuseCeiling`.
 *    An unreadable count must not refuse a site; the count is read inside a
 *    transaction that throws rather than returning nothing, so this is a
 *    belt, not a path.
 *  - `ceiling` folds a missing/NaN ceiling to 0, and a ceiling of 0 REFUSES
 *    EVERYTHING. `0` is a legitimate ceiling meaning "none allowed" and must
 *    never read as unlimited — the `if (!count)` trap this repo keeps being
 *    bitten by, in the argument that decides the refusal.
 */
export function checkVisitorRecordCeiling(
  used: number,
  ceiling: number,
): VisitorRecordCeilingResult {
  const resolvedCeiling = Math.max(0, Math.floor(Number(ceiling) || 0))
  const resolvedUsed = Math.max(0, Math.floor(Number(used) || 0))
  return {
    exceeded: resolvedUsed >= resolvedCeiling,
    ceiling: resolvedCeiling,
    used: resolvedUsed,
  }
}

/** {@link checkVisitorRecordCeiling} bound to {@link SITE_MEMBERS_MAX_PER_HOST}. */
export function checkSiteMemberCeiling(
  used: number,
): VisitorRecordCeilingResult {
  return checkVisitorRecordCeiling(used, SITE_MEMBERS_MAX_PER_HOST)
}

/** {@link checkVisitorRecordCeiling} bound to {@link LEADS_MAX_PER_HOST}. */
export function checkLeadCeiling(used: number): VisitorRecordCeilingResult {
  return checkVisitorRecordCeiling(used, LEADS_MAX_PER_HOST)
}

/** Which collection a trip belongs to — the counter id and the notice differ. */
export type VisitorRecordKind = 'siteMembers' | 'leads'

/**
 * `hosts/{hostId}/counters/{…}` — the durable, client-unwritable record of a
 * trip, in the same counters-document shape `formSubmissionsRefused` uses
 * (AGL-1367/1655). Named through a function so the writer in
 * `@aglyn/tenant-data-admin` and the reader in the inbox console page cannot
 * spell it two different ways.
 */
export function visitorRecordRefusedCounterId(kind: VisitorRecordKind): string {
  return kind === 'leads' ? 'leadsRefused' : 'siteMembersRefused'
}

/** What the site's owner is shown. Shaped like `FormsPausedOwnerNotice`. */
export interface VisitorRecordsPausedNotice {
  title: string
  /** What happened, how many, and what actually clears it. */
  message: string
}

/**
 * The owner's notice — the half deliberately withheld from the visitor.
 *
 * Two `{title, message}` lines rather than `LockdownRefusalNotice`'s three:
 * there is **no `until`**, and its absence is the point. The form and
 * bandwidth ceilings count a month and genuinely do lift on the 1st, so their
 * notices name a date. This ceiling counts live documents, so no date lifts
 * it — deleting records does, or support raising it does. Borrowing the third
 * line for symmetry would print a date that means nothing.
 *
 * Returns `null` below one refusal, the same rule as
 * `formSubmissionsPausedNotice` and for the same reason: the counter document
 * persists from its first trip forever, and "0 refused" on every later month
 * trains the owner to ignore the row that will one day be real.
 */
export function visitorRecordsPausedNotice(input: {
  kind: VisitorRecordKind
  /** Refusals recorded for the month being displayed. */
  refused: number
  /** The ceiling that was crossed, from the counter document. */
  ceiling?: number
}): VisitorRecordsPausedNotice | null {
  const refused = Math.floor(Number(input.refused) || 0)
  if (refused < 1) return null
  const ceiling =
    typeof input.ceiling === 'number' && Number.isFinite(input.ceiling)
      ? Math.floor(input.ceiling)
      : undefined
  const leads = input.kind === 'leads'
  const noun = leads ? 'lead' : 'sign-up'
  return {
    title: leads
      ? 'Lead capture is paused'
      : 'New member sign-ups are paused',
    message:
      `${refused.toLocaleString()} ${noun}${refused === 1 ? '' : 's'} on ` +
      `this site ${refused === 1 ? 'has' : 'have'} been refused this month` +
      (ceiling
        ? ` after it reached ${ceiling.toLocaleString()} ` +
          `${leads ? 'leads' : 'member accounts'}`
        : '') +
      '. Refused records are not stored and are not billed. This is a ' +
      'platform safety limit, not part of your plan — every plan includes ' +
      `unlimited ${leads ? 'leads' : 'member accounts'}. Removing ` +
      `${leads ? 'leads' : 'members'} below the limit starts acceptance ` +
      'again immediately; if this is real traffic, contact support and we ' +
      'will raise it.',
  }
}
