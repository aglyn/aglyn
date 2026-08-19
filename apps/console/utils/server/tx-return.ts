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
 * The Texas sales tax return, summed from `platformRevenue` rows (AGL-1811).
 *
 * The recording half of AGL-1811 stores one row per paid invoice — gross,
 * tax, net, the buyer's address and the per-rate breakdown with Stripe's
 * `taxable_amount`. This module is the missing last step: the three figures
 * a Texas return (Form 01-114/01-117) actually asks for, derived from those
 * rows with nothing re-read from Stripe:
 *
 *   - **Total sales** — receipts excluding the tax itself: `netCents`
 *     (`gross − tax`), the full charge including the §151.351-exempt 20%.
 *   - **Taxable sales** — the base the rate was applied to: the summed
 *     `taxable_amount`, which under the filed data-processing position is
 *     80% of the charge (`taxability_reason: taxable_basis_reduced`).
 *   - **Tax collected** — the summed tax lines.
 *
 * Grouped by the buyer's billing-address STATE, because the TX return only
 * reports Texas receipts and the platform sells everywhere: the TX bucket is
 * the return, the other buckets are the audit trail for why the rest of the
 * quarter's revenue is not on it (and the early-warning list for economic
 * nexus elsewhere).
 *
 * **Refunds are stated, not netted.** A row keeps one cumulative
 * `refundedCents` and only the LATEST `refundRecordedAt`, so two refunds in
 * different quarters cannot be split by period from the row alone. Rather
 * than silently misassign, the summary reports refunds recorded during the
 * period (cumulative-to-date on those rows) with the refunded tax estimated
 * proportionally, and leaves applying them to the preparer — for launch
 * volumes this is an inspection, not a computation.
 *
 * **Every row it cannot fully read is counted out loud** in `attention`
 * rather than skipped: an undercount presented as a total is precisely the
 * failure a filing record cannot have.
 *
 * Pure and total: no Firestore, no Stripe, no clock. The staff route feeds
 * it the period's rows; the spec feeds it fixtures.
 */

/** The subset of a `platformRevenue/{invoiceId}` row this module reads. */
export interface TaxReturnRowInput {
  invoiceId: string
  orgId?: string | null
  grossCents?: unknown
  taxCents?: unknown
  netCents?: unknown
  currency?: unknown
  automaticTax?: unknown
  customerAddress?: {
    country?: unknown
    state?: unknown
  } | null
  taxLines?: Array<{
    amountCents?: unknown
    taxabilityReason?: unknown
    taxRateId?: unknown
    taxableAmountCents?: unknown
  }> | null
  /** JS Date, or anything with `.toDate()` (a Firestore Timestamp). */
  paidAt?: unknown
  refundedCents?: unknown
  refundRecordedAt?: unknown
}

export interface TaxReturnJurisdiction {
  transactionCount: number
  /** Receipts excluding tax — `net` summed. */
  totalSalesCents: number
  /** Stripe's `taxable_amount` summed — the 80% base for TX rows. */
  taxableSalesCents: number
  taxCollectedCents: number
}

export interface TaxReturnSummary {
  /** ISO date bounds the caller queried — echoed for the record. */
  periodStart: string
  periodEnd: string
  transactionCount: number
  totalSalesCents: number
  taxableSalesCents: number
  taxCollectedCents: number
  /**
   * Keyed `COUNTRY-STATE` (e.g. `US-TX`); rows with no readable address are
   * under `unknown` — and counted in `attention.rowsMissingAddress`.
   */
  byJurisdiction: Record<string, TaxReturnJurisdiction>
  refunds: {
    /** Rows whose latest refund stamp falls inside the period. */
    rowsRefundedInPeriod: number
    /** Cumulative refunded gross on those rows — see the module note. */
    refundedGrossCents: number
    /** The tax share of that gross, proportioned by each row's own ratio. */
    estimatedRefundedTaxCents: number
  }
  attention: {
    /** `automaticTax: false` — billed before its subscription gained tax. */
    untaxedRows: number
    /** Tax collected but no line states its base — base must be derived. */
    rowsMissingTaxableBase: number
    rowsMissingAddress: number
    /** Anything not USD — a return is filed in dollars. */
    nonUsdRows: number
    /** No `paidAt` — period assignment fell back to the query's bounds. */
    rowsMissingPaidAt: number
  }
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/** A Date from a JS Date or a Firestore-Timestamp-shaped `{ toDate() }`. */
export function asRowDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  const toDate = (value as { toDate?: () => Date } | null | undefined)?.toDate
  if (typeof toDate === 'function') {
    try {
      const parsed = toDate.call(value)
      return parsed instanceof Date ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

/**
 * `YYYY-Q[1-4]` (a calendar quarter — TX quarterly filing periods) or
 * `YYYY-MM` (a month, for a monthly filer) to half-open UTC date bounds.
 * Anything else answers null — a wrong period must refuse, not guess.
 */
export function taxPeriodRange(
  period: string,
): { start: Date; end: Date } | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(String(period ?? '').trim())
  if (quarter) {
    const year = Number(quarter[1])
    const startMonth = (Number(quarter[2]) - 1) * 3
    return {
      start: new Date(Date.UTC(year, startMonth, 1)),
      end: new Date(Date.UTC(year, startMonth + 3, 1)),
    }
  }
  const month = /^(\d{4})-(\d{2})$/.exec(String(period ?? '').trim())
  if (month) {
    const year = Number(month[1])
    const monthIndex = Number(month[2]) - 1
    if (monthIndex < 0 || monthIndex > 11) return null
    return {
      start: new Date(Date.UTC(year, monthIndex, 1)),
      end: new Date(Date.UTC(year, monthIndex + 1, 1)),
    }
  }
  return null
}

/** The return's figures from one period's rows. See the module note. */
export function taxReturnSummary(
  rows: readonly TaxReturnRowInput[],
  period: { start: Date; end: Date },
): TaxReturnSummary {
  const summary: TaxReturnSummary = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    transactionCount: 0,
    totalSalesCents: 0,
    taxableSalesCents: 0,
    taxCollectedCents: 0,
    byJurisdiction: {},
    refunds: {
      rowsRefundedInPeriod: 0,
      refundedGrossCents: 0,
      estimatedRefundedTaxCents: 0,
    },
    attention: {
      untaxedRows: 0,
      rowsMissingTaxableBase: 0,
      rowsMissingAddress: 0,
      nonUsdRows: 0,
      rowsMissingPaidAt: 0,
    },
  }

  for (const row of rows ?? []) {
    const gross = cents(row.grossCents)
    const tax = cents(row.taxCents)
    // Recompute rather than trust the stored `netCents`: the two must agree
    // by construction, and re-deriving keeps a hand-edited row from making
    // the three headline figures internally inconsistent.
    const net = gross - tax
    const lines = Array.isArray(row.taxLines) ? row.taxLines : []
    const statedBases = lines
      .map((line) => line?.taxableAmountCents)
      .filter((base): base is number => Number.isFinite(Number(base)) && base !== null)
    const taxableBase = statedBases.reduce(
      (sum, base) => sum + Math.round(Number(base)),
      0,
    )

    const country = row.customerAddress?.country
    const state = row.customerAddress?.state
    const jurisdiction =
      typeof country === 'string' && country
        ? `${country}${typeof state === 'string' && state ? `-${state}` : ''}`
        : 'unknown'
    if (jurisdiction === 'unknown') summary.attention.rowsMissingAddress += 1
    if (row.automaticTax === false) summary.attention.untaxedRows += 1
    if (tax > 0 && statedBases.length === 0) {
      summary.attention.rowsMissingTaxableBase += 1
    }
    if (String(row.currency ?? 'usd').toLowerCase() !== 'usd') {
      summary.attention.nonUsdRows += 1
    }
    if (!asRowDate(row.paidAt)) summary.attention.rowsMissingPaidAt += 1

    summary.transactionCount += 1
    summary.totalSalesCents += net
    summary.taxableSalesCents += taxableBase
    summary.taxCollectedCents += tax
    const bucket = (summary.byJurisdiction[jurisdiction] ??= {
      transactionCount: 0,
      totalSalesCents: 0,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
    })
    bucket.transactionCount += 1
    bucket.totalSalesCents += net
    bucket.taxableSalesCents += taxableBase
    bucket.taxCollectedCents += tax

    const refunded = cents(row.refundedCents)
    const refundStamp = asRowDate(row.refundRecordedAt)
    if (
      refunded > 0 &&
      refundStamp &&
      refundStamp >= period.start &&
      refundStamp < period.end
    ) {
      summary.refunds.rowsRefundedInPeriod += 1
      summary.refunds.refundedGrossCents += refunded
      // The refund moves tax and revenue in the row's own proportion — the
      // same ratio the GA reversal uses. A row with no gross cannot state a
      // ratio; its tax share stays out of the estimate rather than guessed.
      if (gross > 0 && tax > 0) {
        summary.refunds.estimatedRefundedTaxCents += Math.round(
          (refunded * tax) / gross,
        )
      }
    }
  }

  return summary
}

/* -------------------------------------------------------------------------
 * Storefront commerce (AGL-1904)
 * ---------------------------------------------------------------------- */

/**
 * The second half of the return, and a DIFFERENT half.
 *
 * `taxReturnSummary` above sums Aglyn's own sales. A storefront sale is a
 * merchant's sale — but on a `mode: 'stripe'` store the tax charged to the
 * shopper is computed against AGLYN's registrations on a Checkout Session
 * created on Aglyn's own platform account (measured, not inferred: with the
 * platform unregistered and the destination connected account registered in
 * Texas, Stripe answered `amount_tax: 0` / `not_collecting`; with the platform
 * registered and nothing else changed, 8.25% / `standard_rated`; both sessions
 * reported `automatic_tax.liability: { type: "self" }`). That tax lands in
 * Aglyn's balance and was invisible to every figure above.
 *
 * ## THREE BUCKETS, AND THEY MUST NEVER BE SUMMED
 *
 * There is deliberately no grand total on this summary, and adding one would
 * be the bug — the three are answers to three different questions:
 *
 *   - **`aglynLiable`** — Stripe Tax computed it against Aglyn's own
 *     registrations (`taxMode: 'stripe-automatic'`,
 *     `taxLiability: 'platform'`). This is money Aglyn is holding.
 *   - **`merchantManual`** — the merchant's own configured rate, added as an
 *     ordinary line item Stripe is never told is tax. Aglyn's registrations
 *     played no part; it is not Aglyn's to remit, and counting it here would
 *     have Aglyn filing and paying another company's tax.
 *   - **`connectedAccountLiable`** — Stripe Tax that named a CONNECTED
 *     account as the liable party. None exists today (no storefront path sets
 *     `on_behalf_of`), and the bucket is here so that if one ever does, the
 *     money moves out of `aglynLiable` visibly rather than silently.
 *
 * The classification comes from the stored `taxMode` / `taxLiability`, which
 * `storefront-tax.ts` derives from `automatic_tax.enabled` and never from the
 * presence of tax lines — a manual-mode subscription renewal carries genuine
 * Stripe Tax Rates (AGL-1751) and is otherwise indistinguishable.
 *
 * **This says nothing about marketplace-facilitator status.** It reports which
 * registration computed which tax and where the money is. Which line of a
 * filed return each bucket belongs on is a question for the preparer and for
 * counsel, and this module deliberately declines to answer it — which is
 * exactly why there is no merged total to mistake for one.
 *
 * Rows that cannot be classified or read are counted in `attention`, never
 * dropped and never zeroed.
 *
 * Pure and total, like everything above it.
 */

/** The subset of a `storefrontTaxCollected/{stripeId}` row this reads. */
export interface StorefrontTaxReturnRowInput {
  id: string
  hostId?: unknown
  orgId?: string | null
  taxMode?: unknown
  taxLiability?: unknown
  grossCents?: unknown
  taxCents?: unknown
  currency?: unknown
  customerAddress?: {
    country?: unknown
    state?: unknown
  } | null
  taxLines?: Array<{
    amountCents?: unknown
    taxableAmountCents?: unknown
  }> | null
  paidAt?: unknown
}

export interface StorefrontTaxBucket {
  transactionCount: number
  /** What shoppers paid, tax included. NOT Aglyn's revenue. */
  grossCents: number
  /** Stripe's `taxable_amount` summed; 0 for buckets that state no base. */
  taxableSalesCents: number
  taxCollectedCents: number
  /** Keyed `COUNTRY-STATE`, or `unknown`. */
  byJurisdiction: Record<string, TaxReturnJurisdiction>
}

export interface StorefrontTaxSummary {
  periodStart: string
  periodEnd: string
  transactionCount: number
  /** Tax computed against AGLYN's registrations. See the module note. */
  aglynLiable: StorefrontTaxBucket
  /** The merchant's own configured tax. Never Aglyn's to remit. */
  merchantManual: StorefrontTaxBucket
  /** Stripe Tax that named a connected account liable. Empty today. */
  connectedAccountLiable: StorefrontTaxBucket
  attention: {
    /** Tax collected but no line states its base — see the module note. */
    rowsMissingTaxableBase: number
    rowsMissingAddress: number
    nonUsdRows: number
    rowsMissingPaidAt: number
    /** A `taxMode` this code does not recognise — never silently bucketed. */
    rowsUnclassified: number
  }
}

function emptyBucket(): StorefrontTaxBucket {
  return {
    transactionCount: 0,
    grossCents: 0,
    taxableSalesCents: 0,
    taxCollectedCents: 0,
    byJurisdiction: {},
  }
}

/** The storefront figures from one period's rows. See the module note. */
export function storefrontTaxSummary(
  rows: readonly StorefrontTaxReturnRowInput[],
  period: { start: Date; end: Date },
): StorefrontTaxSummary {
  const summary: StorefrontTaxSummary = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    transactionCount: 0,
    aglynLiable: emptyBucket(),
    merchantManual: emptyBucket(),
    connectedAccountLiable: emptyBucket(),
    attention: {
      rowsMissingTaxableBase: 0,
      rowsMissingAddress: 0,
      nonUsdRows: 0,
      rowsMissingPaidAt: 0,
      rowsUnclassified: 0,
    },
  }

  for (const row of rows ?? []) {
    const gross = cents(row.grossCents)
    const tax = cents(row.taxCents)
    const lines = Array.isArray(row.taxLines) ? row.taxLines : []
    const statedBases = lines
      .map((line) => line?.taxableAmountCents)
      .filter(
        (base): base is number =>
          base !== null && base !== undefined && Number.isFinite(Number(base)),
      )
    const taxableBase = statedBases.reduce(
      (sum, base) => sum + Math.round(Number(base)),
      0,
    )

    const country = row.customerAddress?.country
    const state = row.customerAddress?.state
    const jurisdiction =
      typeof country === 'string' && country
        ? `${country}${typeof state === 'string' && state ? `-${state}` : ''}`
        : 'unknown'
    if (jurisdiction === 'unknown') summary.attention.rowsMissingAddress += 1
    if (String(row.currency ?? 'usd').toLowerCase() !== 'usd') {
      summary.attention.nonUsdRows += 1
    }
    if (!asRowDate(row.paidAt)) summary.attention.rowsMissingPaidAt += 1

    // The bucket is chosen from the STORED classification, and an unfamiliar
    // one falls through to `rowsUnclassified` rather than defaulting into a
    // bucket — a default here would put a merchant's tax on Aglyn's return, or
    // Aglyn's tax nowhere, and neither is allowed to happen quietly.
    const mode = String(row.taxMode ?? '')
    const liability = String(row.taxLiability ?? '')
    const bucket =
      mode === 'stripe-automatic' && liability === 'connected-account'
        ? summary.connectedAccountLiable
        : mode === 'stripe-automatic'
          ? summary.aglynLiable
          : mode === 'manual'
            ? summary.merchantManual
            : null
    if (!bucket) {
      summary.attention.rowsUnclassified += 1
      continue
    }

    // A taxed row that cannot state the base the rate was applied to —
    // counted ONLY for Stripe-computed tax. A manual-mode row has no Stripe
    // base by construction (Stripe was never told the amount was tax), so
    // flagging it here would raise a permanent alarm about a figure that can
    // never exist, and an alarm that is always on is an alarm nobody reads.
    if (mode === 'stripe-automatic' && tax > 0 && statedBases.length === 0) {
      summary.attention.rowsMissingTaxableBase += 1
    }

    summary.transactionCount += 1
    bucket.transactionCount += 1
    bucket.grossCents += gross
    bucket.taxableSalesCents += taxableBase
    bucket.taxCollectedCents += tax
    const jurisdictionBucket = (bucket.byJurisdiction[jurisdiction] ??= {
      transactionCount: 0,
      totalSalesCents: 0,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
    })
    jurisdictionBucket.transactionCount += 1
    jurisdictionBucket.totalSalesCents += gross - tax
    jurisdictionBucket.taxableSalesCents += taxableBase
    jurisdictionBucket.taxCollectedCents += tax
  }

  return summary
}

// ---------------------------------------------------------------------------
// Marketplace sales tax (AGL-2137)
// ---------------------------------------------------------------------------

export interface MarketplaceTaxReturnRowInput {
  id: string
  sellerOrgId?: unknown
  /** Tax-INCLUSIVE gross the buyer paid (`amount_total`). */
  amountCents?: unknown
  taxCents?: unknown
  /** The seller's Connect transfer. Never Aglyn's revenue and never taxed. */
  transferCents?: unknown
  /** Stripe's CUMULATIVE refund total on the charge, when one has happened. */
  refundedCents?: unknown
  createdAt?: unknown
}

export interface MarketplaceTaxSummary {
  periodStart: string
  periodEnd: string
  transactionCount: number
  /** What buyers paid, tax included. Mostly the publisher's. */
  grossCents: number
  /** Gross − tax, i.e. the taxable base. */
  taxableSalesCents: number
  /** Tax collected, NET of refunds — this is the remittable figure. */
  taxCollectedCents: number
  /** Tax charged before refunds, so the two are legible apart. */
  taxChargedCents: number
  /** Tax handed back with refunds. Never remitted. */
  taxRefundedCents: number
  attention: {
    /**
     * Rows with no stored buyer address, so no jurisdiction can be stated.
     * `marketplacePurchases` records none today — see the module note in the
     * route — so this is expected to equal `transactionCount` until it does.
     */
    rowsMissingJurisdiction: number
    rowsMissingCreatedAt: number
    /** A refund larger than the charge — data fault, never netted below zero. */
    rowsOverRefunded: number
  }
}

/**
 * Marketplace sales tax for one period (AGL-2137).
 *
 * A THIRD bucket, kept apart from both `taxReturnSummary` (Aglyn's own
 * subscription invoices) and `storefrontTaxSummary` (merchant storefronts) for
 * the same reason those two are apart: a marketplace row's gross is mostly the
 * PUBLISHER's money, so summing it into either total would put someone else's
 * receipts into this return's sales figure.
 *
 * The tax itself is different from a storefront row's, and that is why it
 * belongs on the return at all: marketplace checkout sets
 * `automatic_tax[enabled]` on the PLATFORM's own charge with the tax added
 * `exclusive` on top and kept platform-side (`marketplace/checkout.ts` — the
 * transfer to the publisher is a fixed `transfer_data[amount]` computed from
 * the PRE-tax price). Under the marketplace-provider registration that tax is
 * Aglyn's to remit, in full. There is no merchant-liable arm to bucket.
 *
 * NET OF REFUNDS, unlike either sibling. `refundedCents` is Stripe's
 * cumulative figure for the charge, so the refunded tax is its pro-rata share
 * of the row's own gross; a fully refunded sale nets to exactly zero tax. Both
 * halves are also reported separately, because "we charged X and gave back Y"
 * is the sentence a return needs, not a single number that could be either.
 */
export function marketplaceTaxSummary(
  rows: readonly MarketplaceTaxReturnRowInput[],
  period: { start: Date; end: Date },
): MarketplaceTaxSummary {
  const summary: MarketplaceTaxSummary = {
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    transactionCount: 0,
    grossCents: 0,
    taxableSalesCents: 0,
    taxCollectedCents: 0,
    taxChargedCents: 0,
    taxRefundedCents: 0,
    attention: {
      rowsMissingJurisdiction: 0,
      rowsMissingCreatedAt: 0,
      rowsOverRefunded: 0,
    },
  }
  for (const row of rows ?? []) {
    const gross = cents(row.amountCents)
    const tax = cents(row.taxCents)
    const refunded = cents(row.refundedCents)
    // Pro rata against the row's OWN gross, so a partial refund gives back
    // exactly its share of the tax. Clamped to the row's tax: a refund larger
    // than the charge is a data fault, and netting past zero would understate
    // what is owed — the one direction with a filing consequence.
    const overRefunded = refunded > gross
    if (overRefunded) summary.attention.rowsOverRefunded += 1
    const refundedTax =
      gross > 0 && refunded > 0
        ? Math.min(tax, Math.round((tax * Math.min(refunded, gross)) / gross))
        : 0
    // No buyer address is stored on a purchase row, so no jurisdiction can be
    // stated. Counted rather than guessed.
    summary.attention.rowsMissingJurisdiction += 1
    if (!asRowDate(row.createdAt)) summary.attention.rowsMissingCreatedAt += 1

    summary.transactionCount += 1
    summary.grossCents += gross
    summary.taxableSalesCents += Math.max(0, gross - tax)
    summary.taxChargedCents += tax
    summary.taxRefundedCents += refundedTax
    summary.taxCollectedCents += tax - refundedTax
  }
  return summary
}
