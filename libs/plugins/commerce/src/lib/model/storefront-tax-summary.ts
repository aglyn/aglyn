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
 * The tax storefront sales collected, by who is liable for it (AGL-1904).
 *
 * A storefront sale is a merchant's sale — but on a `mode: 'stripe'` store
 * the tax charged to the shopper is computed against the PLATFORM's
 * registrations on a Checkout Session created on the platform's own account
 * (measured, not inferred: with the platform unregistered and the destination
 * connected account registered in Texas, Stripe answered `amount_tax: 0` /
 * `not_collecting`; with the platform registered and nothing else changed,
 * 8.25% / `standard_rated`; both sessions reported
 * `automatic_tax.liability: { type: "self" }`). That tax lands in the
 * platform's balance, and the operator's return reads it through this fold.
 *
 * ## THREE BUCKETS, AND THEY MUST NEVER BE SUMMED
 *
 * There is deliberately no grand total on this summary, and adding one would
 * be the bug — the three are answers to three different questions:
 *
 *   - **`aglynLiable`** — Stripe Tax computed it against the platform's own
 *     registrations (`taxMode: 'stripe-automatic'`,
 *     `taxLiability: 'platform'`). This is money the platform is holding.
 *   - **`merchantManual`** — the merchant's own configured rate, added as an
 *     ordinary line item Stripe is never told is tax. The platform's
 *     registrations played no part; it is not the platform's to remit, and
 *     counting it would have the operator filing and paying another
 *     company's tax.
 *   - **`connectedAccountLiable`** — Stripe Tax that named a CONNECTED
 *     account as the liable party. None exists today (no storefront path sets
 *     `on_behalf_of`), and the bucket is here so that if one ever does, the
 *     money moves out of `aglynLiable` visibly rather than silently.
 *
 * `aglynLiable` is a wire name the merchant's own tax report and the staff
 * return have both read since AGL-1904; it means "the platform operator".
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
 * Pure and total: no Firestore, no clock. Read by the staff return's source
 * (`server/tax-return-source.ts`) and by the merchant's own tax report, so
 * both read the same rows through the same classifier.
 */

import {
  accumulateTaxWorkingPapers,
  asRowDate,
  emptyTaxJurisdiction,
  taxJurisdictionKey,
  type TaxLineInput,
  type TaxReturnJurisdiction,
} from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'

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
  taxLines?: TaxLineInput[] | null
  paidAt?: unknown
}

export interface StorefrontTaxBucket {
  transactionCount: number
  /** What shoppers paid, tax included. NOT the platform's revenue. */
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
  /** Tax computed against the PLATFORM's registrations. See the module note. */
  aglynLiable: StorefrontTaxBucket
  /** The merchant's own configured tax. Never the platform's to remit. */
  merchantManual: StorefrontTaxBucket
  /** Stripe Tax that named a connected account liable. Empty today. */
  connectedAccountLiable: StorefrontTaxBucket
  attention: {
    /** Tax collected but no line states its base — see the module note. */
    rowsMissingTaxableBase: number
    rowsMissingAddress: number
    nonUsdRows: number
    rowsMissingPaidAt: number
    /** A `taxMode` this code does not recognize — never silently bucketed. */
    rowsUnclassified: number
  }
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
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

    const jurisdiction = taxJurisdictionKey(row.customerAddress)
    if (jurisdiction === 'unknown') summary.attention.rowsMissingAddress += 1
    if (String(row.currency ?? 'usd').toLowerCase() !== 'usd') {
      summary.attention.nonUsdRows += 1
    }
    if (!asRowDate(row.paidAt)) summary.attention.rowsMissingPaidAt += 1

    // The bucket is chosen from the STORED classification, and an unfamiliar
    // one falls through to `rowsUnclassified` rather than defaulting into a
    // bucket — a default here would put a merchant's tax on the platform's
    // return, or the platform's tax nowhere, and neither is allowed to happen
    // quietly.
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
    const jurisdictionBucket = (bucket.byJurisdiction[jurisdiction] ??=
      emptyTaxJurisdiction())
    jurisdictionBucket.transactionCount += 1
    jurisdictionBucket.totalSalesCents += gross - tax
    jurisdictionBucket.taxableSalesCents += taxableBase
    jurisdictionBucket.taxCollectedCents += tax
    // The storefront working papers (AGL-2329). Its lines carry the richer
    // detail — `percentage`, `rateState`, `jurisdiction` — three fields the
    // writer annotates "for the working papers".
    accumulateTaxWorkingPapers(jurisdictionBucket, lines)
  }

  return summary
}
