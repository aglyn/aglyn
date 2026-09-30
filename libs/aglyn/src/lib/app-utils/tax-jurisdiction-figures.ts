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
 * ONE JURISDICTION'S FIGURES, and the working papers behind them (AGL-2329).
 *
 * The operator's sales tax return sums its own invoices, and every plugin
 * that sells through the platform answers for its own sales beside them
 * (`plugin-manager/plugin-tax-return-sources.ts`). Each of those halves keys
 * its money by the buyer's jurisdiction and states which rate produced it —
 * and two implementations of "which rate produced this" is how two halves of
 * one filing come to disagree. So the shape, the jurisdiction key and the
 * fold live here once, and every half of the return uses them.
 *
 * Pure and total: no Firestore, no clock, no throw on a garbage row.
 */

/**
 * One tax line, as the platform's invoice rows and a plugin's tax rows both
 * write it. Three of these fields carry the comment "for the working papers"
 * at the writer.
 */
export interface TaxLineInput {
  amountCents?: unknown
  taxableAmountCents?: unknown
  taxabilityReason?: unknown
  taxRateId?: unknown
  /** The rate's percentage and its own jurisdiction, where the writer states them. */
  percentage?: unknown
  rateState?: unknown
  jurisdiction?: unknown
}

/**
 * One rate that touched a jurisdiction.
 *
 * A return that states a jurisdiction's total and cannot state WHICH RATE
 * produced it cannot be checked against a rate table, which is the first
 * thing an examiner does.
 */
export interface TaxReturnRate {
  /** Stripe's rate id, or `unknown` for a line that states none. */
  taxRateId: string
  /** The rate as a percentage, when the line states one. */
  percentage: number | null
  /** The rate's own state, which can differ from the customer's. */
  rateState: string | null
  /** The rate's own jurisdiction label, as Stripe worded it. */
  jurisdiction: string | null
  lines: number
  taxableAmountCents: number
  taxCollectedCents: number
}

/**
 * Why tax came out the way it did, for one jurisdiction.
 *
 * Keyed by Stripe's `taxability_reason` — `standard_rated`,
 * `not_collecting`, `product_exempt`, `reverse_charge`, and the rest. $0 of
 * tax reads identically whether the filer is unregistered there, the product
 * is exempt, or the rate is genuinely zero, and those have three different
 * answers — this is the detail a total can never carry.
 */
export interface TaxReturnTaxability {
  lines: number
  taxableAmountCents: number
  taxCollectedCents: number
}

export interface TaxReturnJurisdiction {
  transactionCount: number
  /** Receipts excluding tax. */
  totalSalesCents: number
  /** The base the rate was applied to. */
  taxableSalesCents: number
  taxCollectedCents: number
  /** THE WORKING PAPERS — see {@link TaxReturnTaxability}. */
  taxabilityReasons: Record<string, TaxReturnTaxability>
  /** Every rate that touched this jurisdiction, dearest first. */
  rates: TaxReturnRate[]
}

/** An empty jurisdiction bucket, working papers included. */
export function emptyTaxJurisdiction(): TaxReturnJurisdiction {
  return {
    transactionCount: 0,
    totalSalesCents: 0,
    taxableSalesCents: 0,
    taxCollectedCents: 0,
    taxabilityReasons: {},
    rates: [],
  }
}

/**
 * The bucket key for a buyer's address: `COUNTRY-STATE`, the country alone
 * when no subdivision is stated, and `unknown` when no country is.
 *
 * One derivation for every half of the return, so two halves can never key
 * the same state differently. `unknown` is not a place: it is the part of a
 * total that demonstrably cannot be placed, and every caller counts it.
 */
export function taxJurisdictionKey(
  address: { country?: unknown; state?: unknown } | null | undefined,
): string {
  const country = address?.country
  const state = address?.state
  return typeof country === 'string' && country
    ? `${country}${typeof state === 'string' && state ? `-${state}` : ''}`
    : 'unknown'
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

/** `12345` → `"123.45"`. Dollars, because a return is filed in dollars. */
export function centsToDollars(cents: unknown): string {
  const parsed = Number(cents ?? 0)
  return ((Number.isFinite(parsed) ? parsed : 0) / 100).toFixed(2)
}

/**
 * Fold one row's tax lines into a jurisdiction's working papers.
 *
 * A line stating no reason is filed under `unstated` rather than dropped or
 * folded into `standard_rated`. Dropping it would make the reasons fail to
 * sum to the jurisdiction's tax — a working paper that does not reconcile is
 * worse than none — and guessing `standard_rated` would assert a fact about
 * a filing that nobody recorded.
 */
export function accumulateTaxWorkingPapers(
  bucket: TaxReturnJurisdiction,
  lines: readonly (TaxLineInput | undefined)[],
): void {
  for (const line of lines) {
    if (!line) continue
    const taxable = Math.round(Number(line.taxableAmountCents ?? 0)) || 0
    const collected = Math.round(Number(line.amountCents ?? 0)) || 0

    const reason =
      typeof line.taxabilityReason === 'string' && line.taxabilityReason
        ? line.taxabilityReason
        : 'unstated'
    const entry = (bucket.taxabilityReasons[reason] ??= {
      lines: 0,
      taxableAmountCents: 0,
      taxCollectedCents: 0,
    })
    entry.lines += 1
    entry.taxableAmountCents += taxable
    entry.taxCollectedCents += collected

    const taxRateId =
      typeof line.taxRateId === 'string' && line.taxRateId
        ? line.taxRateId
        : 'unknown'
    const percentage = Number.isFinite(Number(line.percentage))
      ? Number(line.percentage)
      : null
    const rateState =
      typeof line.rateState === 'string' && line.rateState
        ? line.rateState
        : null
    const jurisdictionLabel =
      typeof line.jurisdiction === 'string' && line.jurisdiction
        ? line.jurisdiction
        : null
    // Keyed by rate id AND percentage: a rate id whose percentage changed
    // mid-period is two different rates on a return, and merging them would
    // hide exactly the change an examiner is checking for.
    let rate = bucket.rates.find(
      (existing) =>
        existing.taxRateId === taxRateId && existing.percentage === percentage,
    )
    if (!rate) {
      rate = {
        taxRateId,
        percentage,
        rateState,
        jurisdiction: jurisdictionLabel,
        lines: 0,
        taxableAmountCents: 0,
        taxCollectedCents: 0,
      }
      bucket.rates.push(rate)
    }
    rate.lines += 1
    rate.taxableAmountCents += taxable
    rate.taxCollectedCents += collected
  }
  // Dearest first: the rate carrying the most money is the one a reviewer
  // checks, and it belongs at the top rather than wherever it was first seen.
  bucket.rates.sort(
    (a, b) =>
      b.taxCollectedCents - a.taxCollectedCents ||
      a.taxRateId.localeCompare(b.taxRateId),
  )
}
