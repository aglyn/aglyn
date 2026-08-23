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

import {
  isBillingSubscription,
  orgListPriceMonthlyUsd,
  orgMonthlyRevenueUsd,
  storefrontProcessingCostCents,
} from '@aglyn/aglyn/server'

/**
 * Staff revenue reporting on TWO bases at once (AGL-2486).
 *
 * Zach, asked whether "revenue" meant the cash Stripe settled or the value of
 * what customers have contracted to pay, answered "Both, side by side" — so
 * this module computes both and, more importantly, computes the GAP between
 * them as a first-class figure with named causes. Two numbers and a reader
 * left to subtract is the failure mode this exists to avoid: the difference
 * is dunning, failed cards, trials and comps, and each of those is an action
 * someone can take, not a rounding artifact.
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
 */
const TRIALING_STATUS = 'trialing'
const PAST_DUE_STATUSES = new Set(['past_due', 'incomplete_expired'])

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
    if (!isBillingSubscription(billing)) {
      // A paid plan with no subscription behind it is a comp / override /
      // dark launch. A genuinely free org is neither, and is not counted.
      const plan = billing?.plan
      if (plan && plan !== 'free') summary.compedOrgs += 1
      continue
    }
    const listPriceUsd = orgListPriceMonthlyUsd(billing)
    const mrrUsd = orgMonthlyRevenueUsd(billing)
    addToSlice(summary.total, listPriceUsd, mrrUsd)
    // Read the same way `isBillingSubscription` reads it: the mirrored
    // `billingStatus` first, the inline `subscription.status` as fallback
    // for orgs the AGL-1028 backfill has not reached.
    const status =
      (typeof billing?.billingStatus === 'string' && billing.billingStatus) ||
      billing?.subscription?.status ||
      ''
    if (status === TRIALING_STATUS) {
      addToSlice(summary.trialing, listPriceUsd, mrrUsd)
    } else if (PAST_DUE_STATUSES.has(status)) {
      addToSlice(summary.pastDue, listPriceUsd, mrrUsd)
    } else {
      addToSlice(summary.collecting, listPriceUsd, mrrUsd)
    }
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

/** One `marketplacePurchases/{sessionId}` row. */
export interface MarketplaceRevenueRowInput {
  id: string
  /** Tax-INCLUSIVE gross the buyer paid. Mostly the publisher's money. */
  amountCents?: unknown
  taxCents?: unknown
  /** Aglyn's commission as CHARGED, at the rate resolved at checkout. */
  feeCents?: unknown
  /** The publisher's Connect transfer. Never Aglyn's revenue. */
  transferCents?: unknown
  /** Set by the FULL-refund path only. */
  refundedCents?: unknown
  /** Set by the PARTIAL-refund path, which never writes `refundedCents`. */
  partialRefundedCents?: unknown
  createdAt?: unknown
}

/** One `hosts/{hostId}/orders/{orderId}` row — a storefront sale. */
export interface CommerceOrderRowInput {
  id: string
  /** What the shopper paid, tax and shipping included. */
  amountCents?: unknown
  /**
   * The Connect `application_fee_amount`: the platform's advertised take PLUS
   * Stripe's processing cost passed through at cost (AGL-2152). NOT margin —
   * see `commerceSettledSummary`.
   */
  feeCents?: unknown
  /**
   * Present ONLY on a storefront SUBSCRIPTION renewal, and it changes how
   * `feeCents` must be read — see `commerceSettledSummary`.
   */
  subscriptionId?: unknown
  /** Merchant refunds AND chargebacks both land here (`commerce/refund.ts`). */
  refundedCents?: unknown
  createdAt?: unknown
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

export interface MarketplaceSettled {
  transactionCount: number
  /** What buyers paid. Mostly the publisher's. NOT Aglyn revenue. */
  grossCents: number
  taxCents: number
  /** Paid out to publishers. Never Aglyn's. */
  sellerTransferCents: number
  /** Aglyn's take as charged. */
  commissionCents: number
  /** The pro-rata commission handed back with refunds. */
  commissionRefundedCents: number
  /** Commission net of refunds. */
  commissionNetCents: number
  /**
   * Stripe's processing cost on these sales, which Aglyn pays out of its own
   * balance and which is recorded NOWHERE (AGL-2486).
   *
   * Marketplace checkout is a destination charge with a fixed
   * `transfer_data[amount]` and deliberately no `application_fee_amount`, so
   * that the sales tax stays with the platform that owes it (AGL-1544). The
   * consequence is that Stripe debits its fee from Aglyn's balance and the
   * commission above is GROSS of that cost. Unlike the storefront path there
   * is no pass-through recovering it, so this is a real uncovered cost and
   * `commissionNetCents` overstates the margin by roughly this much. Reported
   * as an explicit estimate rather than folded in silently.
   */
  estimatedProcessingCostCents: number
}

export interface CommerceSettled {
  transactionCount: number
  /** Shopper spend across storefronts. Overwhelmingly the merchant's. */
  grossCents: number
  /** The whole `application_fee_amount` Aglyn collected. NOT margin. */
  applicationFeeCents: number
  /**
   * Stripe's processing cost this recovered, at cost. Subtracted, never
   * reported as earnings — see `commerceSummary`.
   */
  processingPassThroughCents: number
  /** Application fee minus the pass-through: the advertised take. */
  commissionCents: number
  /** Take handed back with refunds and chargebacks, pro-rata. */
  commissionRefundedCents: number
  /** Take net of reversals. */
  commissionNetCents: number
  /**
   * Storefront SUBSCRIPTION renewals in this period, whose fee recovers no
   * processing cost — see `commerceSettledSummary`.
   */
  subscriptionOrders: number
  /**
   * The sweep hit its cap, so every figure above is a LOWER BOUND and must
   * not be quoted as a total. Narrow the period instead.
   */
  truncated: boolean
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
    const gross = cents(row?.grossCents)
    const tax = cents(row?.taxCents)
    // Reversals are CUMULATIVE on the row (the webhook maintains them that
    // way so a redelivery converges), so they are summed as stored — never
    // derived from a delta here.
    //
    // Clamped to the row's own gross: a refund larger than the charge is a
    // data fault, and letting it run negative would silently CREATE revenue
    // on a neighbouring row when the fold continues.
    const refunded = Math.min(gross, Math.max(0, cents(row?.refundedCents)))
    out.transactionCount += 1
    out.grossCents += gross
    out.taxCents += tax
    out.netCents += gross - tax
    out.refundedCents += refunded
    out.chargedBackCents += Math.max(0, cents(row?.chargedBackCents))
    // Stripe refunds the tax alongside the charge, so the revenue reversed is
    // the refund's share of the row's own NET, not its gross. A full refund
    // therefore nets this row to exactly zero — the same GROSS→NET scaling
    // the billing webhook applies when it nets the GA4 figure.
    const netReversed =
      gross > 0 ? Math.round((refunded * (gross - tax)) / gross) : 0
    const earned = gross - tax - netReversed
    out.netOfReversalsCents += earned
    if (row?.internalTraffic === true) out.internalTrafficCents += earned
  }
  return out
}

/**
 * Marketplace commission, settled.
 *
 * The commission is read from the STORED `feeCents` — the figure the rate
 * resolved at checkout time actually charged — rather than re-derived from
 * `resolveMarketplaceFeePct` today. The rate is priced per sale off the
 * SELLER org's entitlements, so a plan change, an entitlement override or a
 * lapsed subscription since the sale would re-price history if this recomputed
 * it. `gross − tax − transfer` is kept as the FALLBACK for rows written before
 * `feeCents` was stored, and the two agree by construction.
 *
 * Both refund shapes are read. The full-refund path stamps `refundedCents`
 * and the partial path stamps `partialRefundedCents` and never writes the
 * former, so reading only one silently ignores a whole class of reversal.
 */
export function marketplaceSettledSummary(
  rows: readonly MarketplaceRevenueRowInput[],
): MarketplaceSettled {
  const out: MarketplaceSettled = {
    transactionCount: 0,
    grossCents: 0,
    taxCents: 0,
    sellerTransferCents: 0,
    commissionCents: 0,
    commissionRefundedCents: 0,
    commissionNetCents: 0,
    estimatedProcessingCostCents: 0,
  }
  for (const row of rows ?? []) {
    const gross = cents(row?.amountCents)
    const tax = cents(row?.taxCents)
    const transfer = cents(row?.transferCents)
    const stored = cents(row?.feeCents)
    // Never below zero: a transfer larger than the net is a data fault, and a
    // negative commission here would quietly eat a neighbouring sale's take.
    const commission =
      stored > 0 ? stored : Math.max(0, gross - tax - transfer)
    // The larger of the two reversal shapes, not their sum: a sale refunded
    // partially and then fully carries BOTH fields, and adding them would
    // reverse more than the sale ever collected.
    const refunded = Math.min(
      gross,
      Math.max(
        0,
        cents(row?.refundedCents),
        cents(row?.partialRefundedCents),
      ),
    )
    // Pro-rata by the row's own gross, so a fully refunded sale returns
    // exactly the commission it earned and a partial returns its share.
    const commissionRefunded =
      gross > 0 ? Math.round((refunded * commission) / gross) : 0
    out.transactionCount += 1
    out.grossCents += gross
    out.taxCents += tax
    out.sellerTransferCents += transfer
    out.commissionCents += commission
    out.commissionRefundedCents += commissionRefunded
    out.commissionNetCents += commission - commissionRefunded
    // Aglyn's own uncovered cost on this destination charge. The same helper
    // the storefront path recovers with, so the two cannot drift apart.
    if (gross > refunded) {
      out.estimatedProcessingCostCents += storefrontProcessingCostCents(
        gross - refunded,
      )
    }
  }
  return out
}

/**
 * Storefront commerce commission, settled — and the one figure on this page
 * most likely to be reported wrongly.
 *
 * An order's `feeCents` is the Connect `application_fee_amount`, which since
 * AGL-2152 is the advertised take PLUS Stripe's processing cost:
 *
 *     fee = take%(goods) + processing%(charge) + 30¢
 *
 * Every storefront charge is a DESTINATION charge, so Stripe moves the whole
 * amount to the merchant and debits its processing fee from the PLATFORM's
 * balance; the pass-through half of that fee exists purely to recover a cost
 * Aglyn has already paid. Reporting `feeCents` as earnings would overstate
 * Aglyn's margin on every single storefront sale — and on a small order it
 * would report the 30¢ Stripe just took as money Aglyn made.
 *
 * So the pass-through is recomputed with the SAME helper the fee was charged
 * from (`storefrontProcessingCostCents`) and subtracted. Both halves are
 * reported, because "we collected X of which Y was Stripe's" is the sentence
 * a margin figure needs.
 *
 * The recomputation is an estimate in one direction only: it re-derives the
 * cost from the stored charge amount rather than reading Stripe's actual
 * balance-transaction fee, and it prices it at the DEAREST enabled payment
 * method's rate (BNPL, 6%) because that is the rate the fee was charged at.
 * A card-family order really costs 2.9%, so on those orders this subtracts
 * more than Stripe took and the take is UNDERSTATED. Understating margin is
 * the safe direction, and it is stated on the page rather than left to be
 * discovered.
 *
 * ## The one order shape where the pass-through must NOT be subtracted
 *
 * A storefront SUBSCRIPTION renewal carries a `subscriptionId`. Stripe
 * subscriptions accept only `application_fee_percent`, which cannot express a
 * fixed 30¢, so that path never got the AGL-2152 recovery: its `feeCents` is
 * the items-only take with no processing cost folded in, and Aglyn absorbs
 * the card cost. Subtracting a pass-through that was never charged would
 * report a real take as zero on every renewal. So renewals contribute their
 * fee as take in full — and they are COUNTED, because the cost they absorb is
 * uncovered and someone should be able to see how much of the book it is.
 */
export function commerceSettledSummary(
  rows: readonly CommerceOrderRowInput[],
  truncated = false,
): CommerceSettled {
  const out: CommerceSettled = {
    transactionCount: 0,
    grossCents: 0,
    applicationFeeCents: 0,
    processingPassThroughCents: 0,
    commissionCents: 0,
    commissionRefundedCents: 0,
    commissionNetCents: 0,
    subscriptionOrders: 0,
    truncated: truncated === true,
  }
  for (const row of rows ?? []) {
    const gross = cents(row?.amountCents)
    const fee = Math.max(0, cents(row?.feeCents))
    const isSubscriptionOrder =
      typeof row?.subscriptionId === 'string' && row.subscriptionId.length > 0
    out.transactionCount += 1
    out.grossCents += gross
    out.applicationFeeCents += fee
    if (isSubscriptionOrder) out.subscriptionOrders += 1
    if (fee <= 0) continue
    // A one-time sale's fee bundles the recovery; a renewal's does not.
    // Clamped to the fee itself: the recomputed cost can exceed a fee charged
    // under an older rate, and a negative take would subtract from another
    // order's real margin.
    const passThrough = isSubscriptionOrder
      ? 0
      : Math.min(fee, storefrontProcessingCostCents(gross))
    const take = fee - passThrough
    const refunded = Math.min(gross, Math.max(0, cents(row?.refundedCents)))
    const takeRefunded = gross > 0 ? Math.round((refunded * take) / gross) : 0
    out.processingPassThroughCents += passThrough
    out.commissionCents += take
    out.commissionRefundedCents += takeRefunded
    out.commissionNetCents += take - takeRefunded
  }
  return out
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
    marketplace: MarketplaceSettled
    commerce: CommerceSettled
    /**
     * Everything Aglyn actually earned in the period: subscription net of
     * reversals, plus marketplace commission net of refunds, plus storefront
     * take with Stripe's pass-through already removed. Tax is excluded
     * throughout — it is held for the state, never earned.
     */
    totalEarnedCents: number
  }
  gap: RevenueGap
  attention: {
    /** `platformRevenue` rows with no readable `paidAt` — invisible to the
     * period range query, so the settled figure is a lower bound by them. */
    rowsOutsideEveryPeriod: number
    /** The commerce sweep hit its cap. */
    commerceTruncated: boolean
  }
}

/**
 * Aglyn's total EARNED cash for the period.
 *
 * Three deliberate exclusions, each of which would overstate it:
 *  - **tax** — collected on Aglyn's own invoices and on marketplace sales,
 *    held for the state, never revenue;
 *  - **seller transfers and merchant gross** — other companies' receipts
 *    passing through the platform account;
 *  - **the storefront processing pass-through** — a recovery of a cost Stripe
 *    already debited, not margin.
 *
 * And one deliberate inclusion: reversals are subtracted. Stripe does not
 * return its processing fee on a refund and a lost dispute costs a further
 * fee on top, so a refund is a loss and always was; a "gross revenue" that
 * ignores them is not a smaller truth, it is a wrong one.
 */
export function totalEarnedCents(settled: {
  subscriptions: SubscriptionSettled
  marketplace: MarketplaceSettled
  commerce: CommerceSettled
}): number {
  return (
    cents(settled?.subscriptions?.netOfReversalsCents) +
    cents(settled?.marketplace?.commissionNetCents) +
    cents(settled?.commerce?.commissionNetCents)
  )
}
