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

/**
 * One tax line, as both collections write it.
 *
 * `platformRevenue` and `storefrontTaxCollected` write the same shape; three
 * of these fields carry the comment "for the working papers" at the writer
 * and had no reader anywhere until AGL-2329.
 */
export interface TaxLineInput {
  amountCents?: unknown
  taxableAmountCents?: unknown
  taxabilityReason?: unknown
  taxRateId?: unknown
  /** Storefront lines only: the rate's percentage and its own jurisdiction. */
  percentage?: unknown
  rateState?: unknown
  jurisdiction?: unknown
}

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
  taxLines?: TaxLineInput[] | null
  /** JS Date, or anything with `.toDate()` (a Firestore Timestamp). */
  paidAt?: unknown
  refundedCents?: unknown
  refundRecordedAt?: unknown
  /**
   * Money reversed by the BANK rather than by us (AGL-2329).
   *
   * `billing/webhook` has maintained this since chargebacks were handled and
   * only the webhook itself read it back, as a converging accumulator. The
   * return read `refundedCents` alone, so it could not tell a refund we chose
   * to give from a payment a bank clawed back — the exact distinction the
   * field was created to make, and one that matters to a return because the
   * two are not always adjusted the same way.
   */
  chargedBackCents?: unknown
  /**
   * OUR OWN transaction rather than a customer's (AGL-1582).
   *
   * Written by `app/api/billing/webhook/route.ts` when checkout stamped the
   * subscription's metadata from a browser the deployment declared its own,
   * and read here with the SAME test `revenue-report.ts` uses —
   * `=== true`, never a truthiness check. An arbitrary value must not read as
   * internal, and an ABSENT field must read as a real sale: under-reporting a
   * state tax liability because a flag was missing is far worse than
   * over-reporting one that is visible on the form.
   *
   * The revenue report INCLUDES these in its totals and states them
   * separately, because an internal purchase is a real charge that really
   * settled and dropping it would make that page disagree with Stripe's
   * balance. A tax return is the opposite case: it reports SALES to a state,
   * and a purchase the platform made from itself is not one. It is excluded
   * from the filed figures here — and stated, never dropped silently.
   */
  internalTraffic?: unknown
}

/**
 * One rate that touched a jurisdiction (AGL-2329).
 *
 * `taxRateId`, `percentage`, `rateState` and `jurisdiction` are written on
 * every tax line by `storefront-tax.ts`, three of them annotated *"for the
 * working papers"* — and no reader projected any of them. A return that
 * states a jurisdiction's total and cannot state WHICH RATE produced it
 * cannot be checked against a rate table, which is the first thing an
 * examiner does.
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
 * Why tax came out the way it did, for one jurisdiction (AGL-2329).
 *
 * Keyed by Stripe's `taxability_reason` — `standard_rated`,
 * `not_collecting`, `product_exempt`, `reverse_charge`, and the rest. These
 * are the fields that explain why a jurisdiction was NOT collected, which is
 * the working-paper detail an audit asks for first and the one figure a
 * total can never carry: $0 of tax in a state reads identically whether we
 * are unregistered there, the product is exempt, or the rate is genuinely
 * zero, and those have three different answers.
 */
export interface TaxReturnTaxability {
  lines: number
  taxableAmountCents: number
  taxCollectedCents: number
}

export interface TaxReturnJurisdiction {
  transactionCount: number
  /** Receipts excluding tax — `net` summed. */
  totalSalesCents: number
  /** Stripe's `taxable_amount` summed — the 80% base for TX rows. */
  taxableSalesCents: number
  taxCollectedCents: number
  /** THE WORKING PAPERS (AGL-2329) — see {@link TaxReturnTaxability}. */
  taxabilityReasons: Record<string, TaxReturnTaxability>
  /** Every rate that touched this jurisdiction, dearest first. */
  rates: TaxReturnRate[]
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
    /**
     * The part of the above that a BANK reversed, not us (AGL-2329).
     *
     * Stated as its own figure rather than netted in, because a chargeback
     * and a refund we chose to give are the same money and different facts:
     * one is a decision, the other is a dispute lost, and the return's reader
     * is entitled to know which they are looking at. `chargedBackCents` was
     * maintained for exactly this distinction and read only by the webhook
     * that wrote it.
     *
     * Counted over the SAME rows as `refundedGrossCents` — the rows whose
     * refund stamp lands in the period — so it is a subset of that figure
     * and never an addition to it.
     */
    chargedBackCents: number
    /** Rows where any of the reversal was a chargeback. */
    rowsChargedBack: number
  }
  /**
   * AGLYN'S OWN PURCHASES, kept OUT of every figure above and stated here.
   *
   * A return reports sales to a state. A purchase the platform made from
   * itself — a rehearsal, a test card, a checkout walked through to prove the
   * flow — is not one, and counting it puts a figure on a filed document that
   * does not belong there. `internalTraffic` already marked these rows for
   * the revenue report; nothing on the return read it.
   *
   * Stated in full rather than subtracted quietly. Somebody signs this
   * document, and a return that drops rows without saying which is worse than
   * one that includes them: the first cannot be checked, and the second at
   * least shows its error on the form. Every figure here is the exact
   * counterpart of one above it, so the two can be added back if a reader
   * disagrees with the exclusion.
   */
  internal: {
    transactionCount: number
    totalSalesCents: number
    taxableSalesCents: number
    taxCollectedCents: number
    /** Keyed like `byJurisdiction`, so the audit table can sit them side by side. */
    byJurisdiction: Record<string, TaxReturnJurisdiction>
  }
  attention: {
    /**
     * Rows excluded from every figure above as Aglyn's own purchases.
     *
     * Counted like a finding so the surfaces can name the rows, but never
     * raised as one: there is nothing to fix about a test purchase correctly
     * recognized as a test purchase.
     */
    internalRows: number
    /** `automaticTax: false` — billed before its subscription gained tax. */
    untaxedRows: number
    /** Tax collected but no line states its base — base must be derived. */
    rowsMissingTaxableBase: number
    rowsMissingAddress: number
    /** Anything not USD — a return is filed in dollars. */
    nonUsdRows: number
    /** No `paidAt` — period assignment fell back to the query's bounds. */
    rowsMissingPaidAt: number
    /**
     * Untaxed rows the obligation had not yet begun for.
     *
     * Counted rather than dropped. A row billed without automatic tax before
     * the filer's first taxable period could not have under-collected — there
     * was nothing to collect — so it is not `untaxedRows` and must not raise a
     * finding on every return forever. But it is also not a row with nothing
     * to say about it: an operator watching a count fall to zero is owed the
     * reason, so the rows keep their own bucket and the surfaces name it.
     *
     * Only ever non-zero when an obligation start is CONFIGURED. See
     * {@link TaxReturnScope}.
     */
    untaxedRowsBeforeObligation: number
    /**
     * Rows whose STORED `netCents` disagrees with `gross − tax` (AGL-2329).
     *
     * The summary recomputes net rather than trusting the stored field, and
     * says so — which left `netCents` a stored value its only consumer
     * refused, a second source of truth waiting to drift unobserved. It is
     * not deleted, because the disagreement is itself information: a row
     * where the two differ was hand-edited or written by a build whose
     * arithmetic differed, and a filing record is exactly the place that
     * should be said out loud rather than quietly corrected.
     *
     * Rows storing no `netCents` at all are NOT counted here — an absent
     * field is not a contradiction.
     */
    rowsWithNetMismatch: number
  }
}

/**
 * A finding that belongs to identifiable ROWS, keyed as `attention` keys it.
 *
 * These are the findings a surface can answer "which ones?" for. The rest of
 * the verdict — a truncated sweep, an unrecognized jurisdiction, a cents
 * figure — is about the report rather than about rows, and there is nothing
 * to name.
 */
export type TaxReturnRowFinding =
  | 'internalRows'
  | 'untaxedRows'
  | 'untaxedRowsBeforeObligation'
  | 'rowsMissingTaxableBase'
  | 'rowsMissingAddress'
  | 'nonUsdRows'
  | 'rowsMissingPaidAt'
  | 'rowsWithNetMismatch'

/**
 * What the filer was actually obliged to collect, and from when.
 *
 * `obligationStart` is the first instant a sale could have carried tax — the
 * start of the CONFIGURED first taxable period. It is `null` on a deployment
 * that has not configured one, and null means "scope nothing": the summary
 * then counts every untaxed row exactly as it did before this existed.
 *
 * That asymmetry is deliberate. Scoping a row out says "no tax was owed on
 * this sale", which is a claim about a liability to a state, and the only
 * thing entitled to make it is an operator who wrote down when their
 * obligation began. A built-in default standing in for that answer would
 * silently un-flag a self-host operator's real under-collections.
 */
export interface TaxReturnScope {
  obligationStart: Date | null
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

/** An empty jurisdiction bucket, working papers included. */
function emptyJurisdiction(): TaxReturnJurisdiction {
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
 * Fold one row's tax lines into a jurisdiction's working papers (AGL-2329).
 *
 * Shared by both halves of the return deliberately. `platformRevenue` and
 * `storefrontTaxCollected` write the same line shape for the same reason,
 * and two implementations of "which rate produced this" is how the two
 * halves of one filing come to disagree.
 *
 * A line stating no reason is filed under `unstated` rather than dropped or
 * folded into `standard_rated`. Dropping it would make the reasons fail to
 * sum to the jurisdiction's tax — a working paper that does not reconcile is
 * worse than none — and guessing `standard_rated` would assert a fact about
 * a filing that nobody recorded.
 */
function accumulateWorkingPapers(
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

/**
 * Which per-row findings this row raises.
 *
 * The counts in `attention` and the rows a surface can name MUST come from
 * one predicate, and this is it. A count computed here and an identity
 * re-derived downstream from a projected field is how a banner comes to say
 * "1 row needs attention" over a list of none or of three: `taxableSalesCents`
 * is a SUM, so a line stating a base of zero is indistinguishable from a row
 * stating no base at all, and a projected `automaticTax` boolean cannot tell
 * an explicit `false` from a field that was never written.
 *
 * Pure and total, and deliberately not exported through a cache: it is called
 * once per row by the summary and once per row by the route's projection, and
 * the two must never be able to disagree.
 */
export function taxReturnRowFindings(
  row: TaxReturnRowInput,
  scope?: TaxReturnScope,
): TaxReturnRowFinding[] {
  const found: TaxReturnRowFinding[] = []
  /*
   * INTERNAL FIRST, and it decides the rest.
   *
   * `=== true`, the same test `revenue-report.ts` applies — an absent or
   * unreadable flag is a real sale, which is the direction that over-reports
   * rather than under-reports to a state.
   *
   * A row this matches is not on the return at all, so no finding ABOUT the
   * return's correctness attaches to it: asking whether a test purchase
   * under-collected tax, or whether its address could be read, is asking a
   * question about a sale that was never made. That is a stated precedence
   * rather than one rule masking another — the excluded rows keep their own
   * bucket, their own total and their own list, and so do the rows scoped out
   * by date, so a reader can always see which rule removed what.
   */
  if (row.internalTraffic === true) return ['internalRows']

  const gross = cents(row.grossCents)
  const tax = cents(row.taxCents)
  // The summary recomputes net rather than trusting the stored `netCents`,
  // which leaves that field a second source of truth nobody watches. Its
  // disagreement is reported instead of swallowed (AGL-2329): a row where the
  // two differ was hand-edited or written by a build whose arithmetic
  // differed. An ABSENT value is not a contradiction, so only stated ones
  // count.
  const net = gross - tax
  if (
    row.netCents !== null &&
    row.netCents !== undefined &&
    Number.isFinite(Number(row.netCents)) &&
    Math.round(Number(row.netCents)) !== net
  ) {
    found.push('rowsWithNetMismatch')
  }

  const lines = Array.isArray(row.taxLines) ? row.taxLines : []
  const statesABase = lines.some(
    (line) =>
      line?.taxableAmountCents !== null &&
      line?.taxableAmountCents !== undefined &&
      Number.isFinite(Number(line.taxableAmountCents)),
  )

  const country = row.customerAddress?.country
  if (!(typeof country === 'string' && country)) found.push('rowsMissingAddress')

  const paidAt = asRowDate(row.paidAt)
  if (row.automaticTax === false) {
    /*
     * SCOPED BY THE OBLIGATION START. A sale billed before the filer's first
     * taxable period had no tax to collect, so calling it under-collected is
     * a false finding that returns every quarter forever.
     *
     * It fails toward flagging in both directions that matter: with no
     * configured start (`obligationStart === null`) every untaxed row is
     * flagged exactly as before, and a row whose paid date cannot be read
     * cannot be proven out of scope, so it is flagged too. Under-reporting a
     * liability because a date was missing is the worse error by far.
     *
     * The boundary is inclusive at the start: a sale on the first day of the
     * first filable period is IN scope.
     */
    const beforeObligation = Boolean(
      scope?.obligationStart && paidAt && paidAt < scope.obligationStart,
    )
    found.push(beforeObligation ? 'untaxedRowsBeforeObligation' : 'untaxedRows')
  }
  if (tax > 0 && !statesABase) found.push('rowsMissingTaxableBase')
  if (String(row.currency ?? 'usd').toLowerCase() !== 'usd') {
    found.push('nonUsdRows')
  }
  if (!paidAt) found.push('rowsMissingPaidAt')
  return found
}

/** The return's figures from one period's rows. See the module note. */
export function taxReturnSummary(
  rows: readonly TaxReturnRowInput[],
  period: { start: Date; end: Date },
  scope?: TaxReturnScope,
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
      chargedBackCents: 0,
      rowsChargedBack: 0,
    },
    internal: {
      transactionCount: 0,
      totalSalesCents: 0,
      taxableSalesCents: 0,
      taxCollectedCents: 0,
      byJurisdiction: {},
    },
    attention: {
      internalRows: 0,
      untaxedRows: 0,
      untaxedRowsBeforeObligation: 0,
      rowsMissingTaxableBase: 0,
      rowsMissingAddress: 0,
      nonUsdRows: 0,
      rowsMissingPaidAt: 0,
      rowsWithNetMismatch: 0,
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
    // Every attention bucket, from the ONE predicate a surface also uses to
    // name the rows behind it. Incrementing here from a second copy of those
    // conditions is how a count and its row list come to disagree, and a
    // count nobody can resolve to rows is the finding an operator cannot act
    // on (AGL-2329 raised the counts; naming them is the other half).
    for (const finding of taxReturnRowFindings(row, scope)) {
      summary.attention[finding] += 1
    }

    /*
     * AGLYN'S OWN PURCHASES DO NOT GO ON A SALES TAX RETURN.
     *
     * Diverted into `internal` — the same four figures and the same
     * jurisdiction buckets — rather than dropped, so the form can show what
     * was removed and a reader who disagrees with the exclusion can add it
     * back. Refunds go with them: a refund of a purchase that was never a
     * sale is not a refund of a sale.
     *
     * The one test, `=== true`, is the revenue report's. An absent flag falls
     * through to the sale path below and is filed, which is the direction
     * that shows its error on the form rather than hiding one from a state.
     */
    if (row.internalTraffic === true) {
      summary.internal.transactionCount += 1
      summary.internal.totalSalesCents += net
      summary.internal.taxableSalesCents += taxableBase
      summary.internal.taxCollectedCents += tax
      const internalBucket = (summary.internal.byJurisdiction[jurisdiction] ??=
        emptyJurisdiction())
      internalBucket.transactionCount += 1
      internalBucket.totalSalesCents += net
      internalBucket.taxableSalesCents += taxableBase
      internalBucket.taxCollectedCents += tax
      accumulateWorkingPapers(internalBucket, lines)
      continue
    }

    summary.transactionCount += 1
    summary.totalSalesCents += net
    summary.taxableSalesCents += taxableBase
    summary.taxCollectedCents += tax
    const bucket = (summary.byJurisdiction[jurisdiction] ??= emptyJurisdiction())
    bucket.transactionCount += 1
    bucket.totalSalesCents += net
    bucket.taxableSalesCents += taxableBase
    bucket.taxCollectedCents += tax
    accumulateWorkingPapers(bucket, lines)

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
      // A SUBSET of the line above, never an addition to it: the bank's
      // share of the same reversed money.
      const chargedBack = Math.min(cents(row.chargedBackCents), refunded)
      if (chargedBack > 0) {
        summary.refunds.chargedBackCents += chargedBack
        summary.refunds.rowsChargedBack += 1
      }
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
  taxLines?: TaxLineInput[] | null
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
    const jurisdictionBucket = (bucket.byJurisdiction[jurisdiction] ??=
      emptyJurisdiction())
    jurisdictionBucket.transactionCount += 1
    jurisdictionBucket.totalSalesCents += gross - tax
    jurisdictionBucket.taxableSalesCents += taxableBase
    jurisdictionBucket.taxCollectedCents += tax
    // The storefront half's working papers (AGL-2329). Its lines carry the
    // richer detail — `percentage`, `rateState`, `jurisdiction` — three
    // fields the writer annotates "for the working papers" and nothing read.
    accumulateWorkingPapers(jurisdictionBucket, lines)
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
