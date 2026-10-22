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

import type { RevenueSection } from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'
import {
  isBillingSubscription,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  resolvePlanComp,
} from '@aglyn/aglyn/server'

/**
 * Staff revenue reporting on TWO bases at once (AGL-2486).
 *
 * Revenue means two things at once — the cash Stripe settled, and the value of
 * what customers have contracted to pay — so this module computes both and,
 * more importantly, computes the GAP between them as a first-class figure with
 * named causes. Two numbers and a reader left to subtract is the failure mode
 * this exists to avoid: the difference is dunning, failed cards, trials and
 * comps, and each of those is an action someone can take, not a rounding
 * artifact.
 *
 * ## The trap this module is built around
 *
 * `org.plan` is NOT revenue (AGL-925, and `revenue-truth.spec.ts` enforces
 * it repo-wide). A staff override on `/admin/orgs` writes `plan` and never
 * writes `subscription`, so a comped, dark-launched or staff-granted org is
 * indistinguishable from a paying one on the plan field alone. Every
 * contracted figure here therefore goes through `isBillingSubscription` and
 * `orgListPriceMonthlyUsd`/`orgMonthlyRevenueUsd` — never through
 * `PLAN_PRICING` — and those already prefer a negotiated
 * `subscription.customMonthlyUsd` over the plan's list price and already fold
 * in the seat/host/dataset/POS/calendar add-ons the plan price does not
 * include.
 *
 * ## Why comps are a COUNT here and never a dollar figure
 *
 * It is tempting to report "what the comps would have billed" by pricing them
 * off the plan table. That is the AGL-925 trap wearing a different hat: the
 * number would be derived from exactly the field that lies, it would look
 * authoritative, and the first time someone quoted it in a board deck it
 * would be revenue that never existed. A comped org contributes $0 to BOTH
 * bases — that is the honest answer and it is the one reported. The count is
 * what makes the $0 legible instead of mysterious.
 *
 * ## Pure and total
 *
 * Firestore reads live in the route; everything here is a pure fold over
 * plain rows so it can be tested without an emulator. `strictNullChecks` is
 * OFF repo-wide, so nothing here uses `if (!x)` to mean "absent" — 0 is a
 * legitimate revenue figure and must survive every guard in this file.
 */

/** Cents from anything, defaulting to 0 rather than NaN. */
function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/** USD rounded to whole cents, so a fold of floats does not drift. */
function usd(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

/**
 * Subscription statuses that collect nothing THIS month while still counting
 * as a live subscription (AGL-2486).
 *
 * Both pass `isBillingSubscription` — deliberately, and that is correct for
 * MRR: a trial is contracted revenue that has not converted yet, and
 * `past_due` is money owed that Stripe is still retrying. But both settle $0
 * until something changes, so they are the two largest named causes of the
 * contracted-vs-settled gap and the page states each by name.
 *
 * `incomplete_expired` is NOT one of them and must not be added: it is a
 * signup whose first payment never authenticated, so there is no contract to
 * report a gap against. `isBillingSubscription` excludes it, which means it
 * never reaches this test at all — it is filtered out one branch earlier, with
 * every other dead subscription.
 */
const TRIALING_STATUS = 'trialing'
const PAST_DUE_STATUSES = new Set(['past_due'])

/** One org as the contracted fold sees it: org doc merged with billing doc. */
export interface ContractedOrgInput {
  orgId: string
  /** The merged `{...orgDoc, ...billingDoc}` the revenue helpers need. */
  billing: Record<string, unknown> | null | undefined
}

/** A named slice of the contracted book. */
export interface ContractedSlice {
  orgs: number
  /** Pre-discount sticker, from `orgListPriceMonthlyUsd`. */
  listPriceUsd: number
  /** Net of any per-org discount, from `orgMonthlyRevenueUsd`. */
  mrrUsd: number
}

export interface ContractedSummary {
  /** Every org with a live Stripe subscription, whatever its status. */
  total: ContractedSlice
  /**
   * The slice that is actually collecting — total minus trialing minus
   * past-due. This is the figure that SHOULD reconcile to settled cash.
   */
  collecting: ContractedSlice
  /** Contracted, converting later, settling $0 today. */
  trialing: ContractedSlice
  /** Contracted, owed, unpaid — Stripe is still retrying. */
  pastDue: ContractedSlice
  /**
   * Orgs on a paid plan with NO billing subscription behind them — staff
   * overrides, comps, dark launches (AGL-925). A COUNT only: see the module
   * note on why this deliberately carries no dollar figure.
   */
  compedOrgs: number
  /** Total discount given away this month: list price minus MRR. */
  discountUsd: number
}

/**
 * What bucket an org falls in, resolved ONCE (AGL-2486).
 *
 * `contractedSummary` and the per-org attribution both need this, and a second
 * copy is how a page comes to show a total of two comped orgs beside a table
 * naming three. `inactive` contributes to nothing: a genuinely free org, and
 * equally a paid `plan` field left standing over a subscription that has
 * stopped — neither is billing, and neither was given anything away.
 */
export type OrgRevenueState =
  | 'collecting'
  | 'trialing'
  | 'pastDue'
  | 'comped'
  | 'inactive'

export function classifyOrgRevenueState(
  billing: Record<string, unknown> | null | undefined,
): OrgRevenueState {
  const doc = billing as any
  // Read the same way `isBillingSubscription` reads it: the mirrored
  // `billingStatus` first, the inline `subscription.status` as fallback for
  // orgs the AGL-1028 backfill has not reached.
  const status =
    (typeof doc?.billingStatus === 'string' && doc.billingStatus) ||
    doc?.subscription?.status ||
    ''
  if (!isBillingSubscription(doc)) {
    // AN EXPLICIT STAFF COMP IN FORCE IS A COMP (AGL-3034), whatever the
    // stored plan says and whether the subscription is dead or absent: it is
    // the one record that says, with a reason, that we chose to give the plan
    // away. It is checked first because a comp is precisely how a canceled
    // workspace comes to hold a plan — the case the next rule reads as churn.
    if (resolvePlanComp(doc)) return 'comped'
    // A COMP IS THE ABSENCE OF A SUBSCRIPTION, not the presence of a dead one.
    // A staff plan override writes `plan` and never writes `subscription`, so
    // a paid plan with no status behind it is a comp / override / dark launch.
    // A paid plan whose subscription is canceled or expired is neither comped
    // nor billing — it is churn wearing a stale `plan` field, and naming it a
    // comp puts a customer who stopped paying into the "we chose to give this
    // away" count and hides them from the churn it actually is. A genuinely
    // free org has neither, and is counted in nothing.
    const plan = doc?.plan
    if (!plan || plan === 'free') return 'inactive'
    return status ? 'inactive' : 'comped'
  }
  if (status === TRIALING_STATUS) return 'trialing'
  if (PAST_DUE_STATUSES.has(status)) return 'pastDue'
  return 'collecting'
}

function emptySlice(): ContractedSlice {
  return { orgs: 0, listPriceUsd: 0, mrrUsd: 0 }
}

function addToSlice(
  slice: ContractedSlice,
  listPriceUsd: number,
  mrrUsd: number,
): void {
  slice.orgs += 1
  slice.listPriceUsd = usd(slice.listPriceUsd + listPriceUsd)
  slice.mrrUsd = usd(slice.mrrUsd + mrrUsd)
}

/**
 * The contracted book — plan price × live subscriptions, plus add-ons, net of
 * per-org discounts. Reflects a signup the moment its subscription mirror
 * lands, which is the whole reason to report it beside settled cash.
 *
 * Sliced by what each status actually collects, because "we have $X
 * contracted" and "$X will arrive" are different claims and the difference is
 * exactly the trialing and past-due rows.
 */
export function contractedSummary(
  orgs: readonly ContractedOrgInput[],
): ContractedSummary {
  const summary: ContractedSummary = {
    total: emptySlice(),
    collecting: emptySlice(),
    trialing: emptySlice(),
    pastDue: emptySlice(),
    compedOrgs: 0,
    discountUsd: 0,
  }
  for (const entry of orgs ?? []) {
    const billing = entry?.billing as any
    const state = classifyOrgRevenueState(billing)
    if (state === 'comped') {
      summary.compedOrgs += 1
      continue
    }
    if (state === 'inactive') continue
    const listPriceUsd = orgListPriceMonthlyUsd(billing)
    const mrrUsd = orgMonthlyRevenueUsd(billing)
    addToSlice(summary.total, listPriceUsd, mrrUsd)
    if (state === 'trialing') addToSlice(summary.trialing, listPriceUsd, mrrUsd)
    else if (state === 'pastDue') addToSlice(summary.pastDue, listPriceUsd, mrrUsd)
    else addToSlice(summary.collecting, listPriceUsd, mrrUsd)
  }
  summary.discountUsd = usd(
    summary.total.listPriceUsd - summary.total.mrrUsd,
  )
  return summary
}

/** One `platformRevenue/{invoiceId}` row — Aglyn's OWN paid invoices. */
export interface PlatformRevenueRowInput {
  id: string
  grossCents?: unknown
  taxCents?: unknown
  /** CUMULATIVE refunds, including any LOST dispute (see the webhook). */
  refundedCents?: unknown
  /** The lost-dispute share of `refundedCents`, reported separately. */
  chargedBackCents?: unknown
  /** Aglyn's own test/staff purchases, tagged for GA exclusion. */
  internalTraffic?: unknown
  currency?: unknown
  paidAt?: unknown
}

export interface SubscriptionSettled {
  transactionCount: number
  /** What arrived, tax included. */
  grossCents: number
  /** Held for the state, never Aglyn's. */
  taxCents: number
  /** Gross minus tax, BEFORE reversals. */
  netCents: number
  /** Money handed back: refunds AND lost disputes. Always a loss. */
  refundedCents: number
  /** The lost-dispute share of `refundedCents`, for legibility. */
  chargedBackCents: number
  /** Net of tax AND of every reversal. The honest earned figure. */
  netOfReversalsCents: number
  /**
   * The share of `netOfReversalsCents` from Aglyn's OWN tagged purchases
   * (`internalTraffic`), which GA already excludes.
   *
   * INCLUDED in the totals, not filtered out, and the distinction matters: an
   * internal purchase is a real charge on a real card that really settled, so
   * dropping it would make this page disagree with Stripe's own balance for
   * no stated reason. It is surfaced separately so anyone reconciling against
   * GA — which does exclude it — can see the difference instead of hunting
   * for it.
   */
  internalTrafficCents: number
}

/** Aglyn's own subscription invoices, settled, net of every reversal. */
export function subscriptionSettledSummary(
  rows: readonly PlatformRevenueRowInput[],
): SubscriptionSettled {
  const out: SubscriptionSettled = {
    transactionCount: 0,
    grossCents: 0,
    taxCents: 0,
    netCents: 0,
    refundedCents: 0,
    chargedBackCents: 0,
    netOfReversalsCents: 0,
    internalTrafficCents: 0,
  }
  for (const row of rows ?? []) {
    const { gross, tax, refunded, earned } = invoiceEarnedCents(row)
    out.transactionCount += 1
    out.grossCents += gross
    out.taxCents += tax
    out.netCents += gross - tax
    out.refundedCents += refunded
    out.chargedBackCents += Math.max(0, cents(row?.chargedBackCents))
    out.netOfReversalsCents += earned
    if (row?.internalTraffic === true) out.internalTrafficCents += earned
  }
  return out
}

/**
 * One invoice's arithmetic, in ONE place (AGL-2486).
 *
 * Extracted so the per-org attribution and the headline total cannot drift:
 * an attribution whose rows do not sum to the figure above them is worse than
 * no attribution at all, because it invites the reader to trust the smaller
 * number they can see the working for.
 *
 * Reversals are CUMULATIVE on the row (the webhook maintains them that way so
 * a redelivery converges), so they are read as stored — never derived from a
 * delta. Clamped to the row's own gross: a refund larger than the charge is a
 * data fault, and letting it run negative would silently CREATE revenue on a
 * neighbouring row when the fold continues.
 *
 * Stripe refunds the tax alongside the charge, so the revenue reversed is the
 * refund's share of the row's own NET, not its gross. A full refund therefore
 * nets the row to exactly zero — the same GROSS→NET scaling the billing
 * webhook applies when it nets the GA4 figure.
 */
export function invoiceEarnedCents(row: PlatformRevenueRowInput | null): {
  gross: number
  tax: number
  refunded: number
  earned: number
} {
  const gross = cents(row?.grossCents)
  const tax = cents(row?.taxCents)
  const refunded = Math.min(gross, Math.max(0, cents(row?.refundedCents)))
  const netReversed =
    gross > 0 ? Math.round((refunded * (gross - tax)) / gross) : 0
  return { gross, tax, refunded, earned: gross - tax - netReversed }
}

/** The two bases beside each other, and the gap spelled out. */
export interface RevenueGap {
  /**
   * Contracted MRR for the orgs that should actually be collecting —
   * excludes trialing and past-due, which settle $0 by definition.
   */
  collectingMrrCents: number
  /** Subscription cash actually settled in the period, net of reversals. */
  settledSubscriptionCents: number
  /** Collecting-contracted minus settled. Positive means money missing. */
  gapCents: number
  /** The named causes, each a figure the reader can act on. */
  causes: {
    /** Contracted but trialing — converts later, settles nothing now. */
    trialingCents: number
    /** Contracted and owed; Stripe is retrying. Dunning. */
    pastDueCents: number
    /** Handed back: refunds and lost disputes. Always a loss. */
    reversedCents: number
    /** Discounts applied — contracted below list on purpose. */
    discountCents: number
    /** Measured metered usage that never reached an invoice (AGL-1878). */
    unbilledMeteredCents: number
  }
  /**
   * Gap left over once every named cause is accounted for. A large residual
   * means a cause this page does not model — investigate rather than file.
   */
  unexplainedCents: number
}

/**
 * The gap between the two bases, decomposed.
 *
 * This is the part of the page that does the work. Two totals side by side
 * invite the reader to subtract and stop; naming the causes turns the
 * difference into a list of things somebody can do — chase a failed card,
 * convert a trial, answer a dispute, fix a meter that measured but never
 * billed.
 *
 * The comparison is deliberately COLLECTING contracted vs settled, not total
 * contracted vs settled: trialing and past-due are excluded from the left
 * side and reported as causes on the right, so they are counted once rather
 * than appearing to be both contracted revenue and a shortfall.
 *
 * A period that is not a whole month is compared as-is and the page says so —
 * scaling monthly MRR onto an arbitrary window would invent precision.
 */
export function revenueGap(input: {
  contracted: ContractedSummary
  subscriptions: SubscriptionSettled
  unbilledMeteredCents?: number
}): RevenueGap {
  const contracted = input?.contracted
  const subscriptions = input?.subscriptions
  const collectingMrrCents = Math.round(
    (contracted?.collecting?.mrrUsd ?? 0) * 100,
  )
  const settledSubscriptionCents = Math.max(
    0,
    cents(subscriptions?.netOfReversalsCents),
  )
  const reversedCents = Math.max(0, cents(subscriptions?.refundedCents))
  const trialingCents = Math.round((contracted?.trialing?.mrrUsd ?? 0) * 100)
  const pastDueCents = Math.round((contracted?.pastDue?.mrrUsd ?? 0) * 100)
  const discountCents = Math.round((contracted?.discountUsd ?? 0) * 100)
  const unbilledMeteredCents = Math.max(
    0,
    cents(input?.unbilledMeteredCents),
  )
  const gapCents = collectingMrrCents - settledSubscriptionCents
  // Discount is NOT subtracted here: `collectingMrrCents` is already net of
  // it (`orgMonthlyRevenueUsd` applies the discount), so counting it again
  // would double-explain the gap. It is carried in `causes` as context for
  // why contracted sits below list, which is a different question.
  const explained = reversedCents + unbilledMeteredCents
  return {
    collectingMrrCents,
    settledSubscriptionCents,
    gapCents,
    causes: {
      trialingCents,
      pastDueCents,
      reversedCents,
      discountCents,
      unbilledMeteredCents,
    },
    unexplainedCents: gapCents - explained,
  }
}

/** Everything `/api/admin/revenue` answers with. */
export interface RevenueReport {
  periodStart: string
  periodEnd: string
  /** The period label echoed back, e.g. `2026-08`. */
  period: string
  contracted: ContractedSummary
  settled: {
    subscriptions: SubscriptionSettled
    /**
     * Everything the operator actually earned in the period: subscriptions
     * net of reversals, plus every answered source's earned line, each already
     * net of what is not the operator's. Tax is excluded throughout — it is
     * held for the state, never earned.
     */
    totalEarnedCents: number
  }
  /**
   * What each plugin that earns through the platform answered, or why it did
   * not (AGL-3080). A refused source is in no figure, and the page says so.
   */
  sources: RevenueSection[]
  gap: RevenueGap
  attention: {
    /** `platformRevenue` rows with no readable `paidAt` — invisible to the
     * Period range query, so the settled figure is a lower bound by them. */
    rowsOutsideEveryPeriod: number
  }
}

/**
 * The operator's total EARNED cash for the period.
 *
 * Deliberate exclusions, each of which would overstate it: **tax**, held for
 * the state and never revenue; and everything a source states as not the
 * operator's — seller transfers and merchant gross passing through the
 * platform account, a processing pass-through that recovers a cost Stripe
 * already debited. Each source's earned line is already net of its own.
 *
 * And one deliberate inclusion: reversals are subtracted. Stripe does not
 * return its processing fee on a refund and a lost dispute costs a further
 * fee on top, so a refund is a loss and always was; a "gross revenue" that
 * ignores them is not a smaller truth, it is a wrong one.
 *
 * A REFUSED source adds nothing, and the page names it: its earnings are
 * unread, not zero.
 */
export function totalEarnedCents(settled: {
  subscriptions: SubscriptionSettled
  sources: readonly RevenueSection[]
}): number {
  return (
    cents(settled?.subscriptions?.netOfReversalsCents) +
    (settled?.sources ?? []).reduce(
      (sum, section) =>
        sum + (section?.outcome === 'answered' ? cents(section.earned?.cents) : 0),
      0,
    )
  )
}

/** One org's contribution to both bases, for the "who did what" table. */
export interface OrgAttributionRow {
  orgId: string
  /** The org's display name, or its id when it has none. Never blank. */
  name: string
  plan: string
  state: OrgRevenueState
  /** Contracted MRR this org contributes TODAY. 0 for comped and inactive. */
  mrrUsd: number
  listPriceUsd: number
  /** Settled cash IN THE PERIOD, net of tax and reversals. */
  settledCents: number
  /** Invoices behind `settledCents`. */
  invoices: number
  /** Money handed back in the period. Already deducted from `settledCents`. */
  refundedCents: number
  /**
   * Metered usage this org's month MEASURED and never invoiced (AGL-1878).
   *
   * A named loss, kept SEPARATE from `refundedCents` rather than summed into
   * one "loss" column: a refund is money returned and unbilled usage is money
   * never asked for, and they are chased in completely different places.
   */
  unbilledMeteredCents: number
}

export interface OrgAttribution {
  rows: OrgAttributionRow[]
  /** Orgs with a contribution that did not fit the cap. */
  omittedOrgs: number
  omittedMrrUsd: number
  omittedSettledCents: number
  /** Orgs considered, including the ones contributing nothing. */
  totalOrgs: number
}

/**
 * Who produced the numbers (AGL-2486).
 *
 * A staff revenue page whose totals cannot be traced to a customer is a page
 * nobody can act on — the point of seeing a gap is knowing whose card to
 * chase, and "Comped / staff override: 2" is useless until it names the two.
 *
 * ## The rows must RECONCILE to the totals
 *
 * Every figure here comes from the same helpers the headline figures do —
 * `classifyOrgRevenueState` for the bucket, `orgMonthlyRevenueUsd` for MRR,
 * `invoiceEarnedCents` for settled cash. An attribution that recomputed any of
 * them would eventually disagree with the total above it, and a reader shown
 * two numbers trusts the one with visible working. So there is no second
 * implementation, only a second grouping.
 *
 * ## Why it is CAPPED, and why the remainder is carried rather than dropped
 *
 * This is a response payload, not a sweep — at six orgs it is nothing, at six
 * hundred thousand it is the page's whole weight. So it returns the largest
 * contributors and reports what it left out AS FIGURES, not just a count:
 * shown rows plus `omitted*` always equals the total, so the table can be
 * trusted to be a complete accounting even when it is not a complete list.
 * Silently truncating an attribution table is the same fault as the row cap
 * this page already had once.
 *
 * An org contributing nothing to either base — no subscription, no cash, not
 * comped — is not a row. It is not attribution, it is a customer list.
 */
export function orgAttribution(
  orgs: readonly ContractedOrgInput[],
  settledRows: readonly PlatformRevenueRowInput[],
  limit = 100,
  unbilledMeteredByOrg: ReadonlyMap<string, number> = new Map(),
): OrgAttribution {
  const settledByOrg = new Map<
    string,
    { settledCents: number; invoices: number; refundedCents: number }
  >()
  for (const row of settledRows ?? []) {
    const orgId = String((row as any)?.orgId ?? '')
    if (!orgId) continue
    const { earned, refunded } = invoiceEarnedCents(row)
    const entry = settledByOrg.get(orgId) ?? {
      settledCents: 0,
      invoices: 0,
      refundedCents: 0,
    }
    entry.settledCents += earned
    entry.invoices += 1
    entry.refundedCents += refunded
    settledByOrg.set(orgId, entry)
  }

  const rows: OrgAttributionRow[] = []
  for (const entry of orgs ?? []) {
    const billing = entry?.billing as any
    const orgId = entry?.orgId
    if (!orgId) continue
    const state = classifyOrgRevenueState(billing)
    const billingOrg = state === 'collecting' || state === 'trialing' || state === 'pastDue'
    const settled = settledByOrg.get(orgId)
    settledByOrg.delete(orgId)
    const mrrUsd = billingOrg ? orgMonthlyRevenueUsd(billing) : 0
    const unbilled = Math.max(0, unbilledMeteredByOrg.get(orgId) ?? 0)
    // Nothing to attribute: no live subscription, no cash this period, no
    // unbilled meter, and not a comp anyone needs to see named.
    if (state === 'inactive' && !settled && unbilled === 0) continue
    rows.push({
      orgId,
      name: String(billing?.name ?? '').trim() || orgId,
      plan: String(billing?.plan ?? 'free'),
      state,
      mrrUsd: usd(mrrUsd),
      listPriceUsd: usd(billingOrg ? orgListPriceMonthlyUsd(billing) : 0),
      settledCents: settled?.settledCents ?? 0,
      invoices: settled?.invoices ?? 0,
      refundedCents: settled?.refundedCents ?? 0,
      unbilledMeteredCents: unbilled,
    })
  }

  // Cash whose org document is GONE — an erased or deleted workspace still
  // has invoices, and dropping them would make the rows sum below the total.
  // Surfaced as a row rather than folded into "omitted", because "we were
  // paid by an org that no longer exists" is a fact someone should see.
  for (const [orgId, settled] of settledByOrg) {
    rows.push({
      orgId,
      name: `${orgId} (no org record)`,
      plan: 'unknown',
      state: 'inactive',
      mrrUsd: 0,
      listPriceUsd: 0,
      settledCents: settled.settledCents,
      invoices: settled.invoices,
      refundedCents: settled.refundedCents,
      unbilledMeteredCents: 0,
    })
  }

  // Biggest contributor first, cash before run-rate: the reader is nearly
  // always chasing money that did or did not arrive.
  rows.sort(
    (a, b) =>
      b.settledCents - a.settledCents ||
      b.mrrUsd - a.mrrUsd ||
      a.name.localeCompare(b.name),
  )
  const kept = rows.slice(0, Math.max(0, limit))
  const dropped = rows.slice(Math.max(0, limit))
  return {
    rows: kept,
    omittedOrgs: dropped.length,
    omittedMrrUsd: usd(dropped.reduce((sum, row) => sum + row.mrrUsd, 0)),
    omittedSettledCents: dropped.reduce(
      (sum, row) => sum + row.settledCents,
      0,
    ),
    totalOrgs: (orgs ?? []).length,
  }
}
