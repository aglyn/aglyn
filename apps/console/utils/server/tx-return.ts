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
