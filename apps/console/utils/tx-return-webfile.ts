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
 * The Texas return, as a person sits down to file it (AGL-1900).
 *
 * `apps/console/utils/server/tx-return.ts` computes the figures; this module
 * is the half that had no surface — turning one `/api/admin/tax-return`
 * response into the three things the filing seat actually needs:
 *
 *   1. **A verdict on whether it may be filed at all.** Every count the
 *      summary raises is folded into one blocking/review verdict here rather
 *      than left as five numbers a tired preparer sums by eye. A row the
 *      sweep could not read is an understated return, and an understated
 *      return filed under penalty of perjury is the failure this whole arc
 *      exists to prevent — so `truncated` and `undatedRows` BLOCK, and the
 *      per-row attention buckets REVIEW.
 *   2. **The Webfile lines**, in dollars, Texas only. The return reports
 *      Texas receipts; the other jurisdictions are the audit trail for why
 *      the rest of the quarter is not on it.
 *   3. **The working papers**, as CSV — every row behind those totals, so
 *      any figure can be walked back to an invoice id in Stripe.
 *
 * Pure: no fetch, no clock (the caller passes `now`), no DOM. The page
 * renders what it returns; the spec feeds it fixtures.
 */

import type { TaxReturnSummary } from './server/tx-return'

/** The jurisdiction key the TX return is filed from. */
export const TX_JURISDICTION = 'US-TX'

/**
 * Aglyn's Texas Webfile credentials, shown beside the figures so the filing
 * seat does not need a second window. Public identifiers on the
 * Comptroller's own correspondence — not secrets (the Webfile *password* is
 * not here and must never be).
 */
export const TX_WEBFILE_NUMBER = 'RT974186'
export const TX_TAXPAYER_NUMBER = '32077682212'

/** First taxable sales date on the registration — no period precedes it. */
export const TX_FIRST_TAXABLE_PERIOD = { year: 2026, quarter: 3 }

/** One row of the `/api/admin/tax-return` per-row listing. */
export interface TaxReturnRow {
  invoiceId: string
  orgId: string | null
  paidAt: string | null
  grossCents: number
  taxCents: number
  taxableSalesCents: number
  state: string | null
  country: string | null
  automaticTax: boolean
  refundedCents: number
}

/** The `/api/admin/tax-return` response. */
export interface TaxReturnPayload {
  period: string
  summary: TaxReturnSummary
  truncated: boolean
  undatedRows: number
  rows: TaxReturnRow[]
}

/** `12345` → `"123.45"`. Dollars, because a return is filed in dollars. */
export function centsToDollars(cents: unknown): string {
  const parsed = Number(cents ?? 0)
  return ((Number.isFinite(parsed) ? parsed : 0) / 100).toFixed(2)
}

export type TaxReturnAttentionSeverity = 'blocking' | 'review'

export interface TaxReturnAttentionItem {
  id: string
  severity: TaxReturnAttentionSeverity
  count: number
  label: string
  /** What it means for the return, and what to do — not a restatement. */
  detail: string
}

/**
 * Every count the summary raises, as a list to render — blocking first.
 *
 * Only non-zero entries come back: the point of the list is that a clean
 * period reads as clean at a glance, and a period that is not says exactly
 * which rows are the problem. Nothing is omitted for being small; a single
 * unreadable row is a filing error at any volume.
 */
export function taxReturnAttentionItems(
  payload: TaxReturnPayload | null,
): TaxReturnAttentionItem[] {
  if (!payload) return []
  const attention = payload.summary?.attention
  const items: TaxReturnAttentionItem[] = [
    {
      id: 'truncated',
      severity: 'blocking',
      // A boolean stated as a count so one list can carry both: the figure
      // that matters is "the totals are a LOWER BOUND", not how many rows
      // fell off the end (which the cap, by construction, cannot know).
      count: payload.truncated ? 1 : 0,
      label: 'Period exceeded the row cap',
      detail:
        'The totals below are a LOWER BOUND — rows past the cap were not ' +
        'summed. Do not file from this. Narrow the period to a month, or ' +
        'raise ROW_CAP in the route.',
    },
    {
      id: 'undatedRows',
      severity: 'blocking',
      count: Number(payload.undatedRows ?? 0),
      label: 'Rows outside every period',
      detail:
        'These invoices carry no readable paid date, so NO period query can ' +
        'reach them — they are missing from this return and from every ' +
        'other one. Fix the rows before filing.',
    },
    {
      id: 'untaxedRows',
      severity: 'review',
      count: Number(attention?.untaxedRows ?? 0),
      label: 'Rows billed without automatic tax',
      detail:
        'Charged before their subscription gained tax behaviour. If any is ' +
        'a Texas sale, tax was under-collected and is still owed — Aglyn ' +
        'pays it from the receipt.',
    },
    {
      id: 'rowsMissingTaxableBase',
      severity: 'review',
      count: Number(attention?.rowsMissingTaxableBase ?? 0),
      label: 'Rows with tax but no stated base',
      detail:
        'Tax was collected but no line states what it was charged on, so ' +
        'these rows add nothing to Taxable sales. Derive the base by hand ' +
        '(80% of the charge under the data-processing position) and add it.',
    },
    {
      id: 'rowsMissingAddress',
      severity: 'review',
      count: Number(attention?.rowsMissingAddress ?? 0),
      label: 'Rows with no readable address',
      detail:
        'Bucketed under "unknown" — they are NOT in the Texas figures. If ' +
        'any is a Texas customer, this return understates the tax due.',
    },
    {
      id: 'nonUsdRows',
      severity: 'review',
      count: Number(attention?.nonUsdRows ?? 0),
      label: 'Rows not in US dollars',
      detail:
        'Summed at face value with the dollar rows. A return is filed in ' +
        'dollars — convert these before relying on the totals.',
    },
    {
      id: 'rowsMissingPaidAt',
      severity: 'review',
      count: Number(attention?.rowsMissingPaidAt ?? 0),
      label: 'Rows with no paid date',
      detail:
        'Period assignment fell back to the query bounds, so these rows may ' +
        'belong to a neighbouring period.',
    },
  ]
  const nonZero = items.filter((item) => item.count > 0)
  return [
    ...nonZero.filter((item) => item.severity === 'blocking'),
    ...nonZero.filter((item) => item.severity === 'review'),
  ]
}

export interface TaxReturnAttentionVerdict {
  /** Every non-zero count, blocking first. */
  items: TaxReturnAttentionItem[]
  /** Rows the report could not fully read. `truncated` counts as one. */
  total: number
  blocking: number
  review: number
  /** True when nothing at all needs a human's eye. */
  clean: boolean
}

/** The one number that decides whether this period may be filed. */
export function taxReturnAttention(
  payload: TaxReturnPayload | null,
): TaxReturnAttentionVerdict {
  const items = taxReturnAttentionItems(payload)
  const sum = (severity: TaxReturnAttentionSeverity) =>
    items
      .filter((item) => item.severity === severity)
      .reduce((total, item) => total + item.count, 0)
  const blocking = sum('blocking')
  const review = sum('review')
  return {
    items,
    total: blocking + review,
    blocking,
    review,
    // `!payload` is NOT clean — nothing read is not the same as nothing
    // wrong, and a page that says "clean" before it has an answer is the
    // exact false green this surface exists to prevent.
    clean: Boolean(payload) && blocking + review === 0,
  }
}

export interface TaxReturnWebfileLine {
  /** Form 01-114 item number, where the figure maps to one. */
  item: string
  label: string
  /** Dollars, or null when this report does not compute the figure. */
  dollars: string | null
  note: string
}

/**
 * The Texas figures, in the order the Webfile form asks for them.
 *
 * Texas only — `byJurisdiction['US-TX']`, never the platform totals. Selling
 * into 30 states does not put 30 states' receipts on a Texas return, and the
 * headline totals in the summary are the platform's, not the state's.
 *
 * Taxable purchases (use tax on Aglyn's OWN purchases) is stated as NOT
 * COMPUTED rather than as zero: `platformRevenue` records sales, and a zero
 * printed where no figure was derived is a claim this data cannot support.
 */
export function taxReturnWebfileLines(
  payload: TaxReturnPayload | null,
): TaxReturnWebfileLine[] {
  const tx = payload?.summary?.byJurisdiction?.[TX_JURISDICTION]
  const dollars = (cents: number | undefined) =>
    payload ? centsToDollars(cents ?? 0) : null
  return [
    {
      item: 'Item 1',
      label: 'Total Texas sales',
      dollars: dollars(tx?.totalSalesCents),
      note: 'Receipts excluding the tax itself, including the §151.351-exempt 20%.',
    },
    {
      item: 'Item 2',
      label: 'Taxable sales',
      dollars: dollars(tx?.taxableSalesCents),
      note: "Stripe's taxable_amount summed — the 80% base under the data-processing position.",
    },
    {
      item: 'Item 3',
      label: 'Taxable purchases',
      dollars: null,
      note: 'NOT COMPUTED — use tax on Aglyn\'s own purchases is not in platformRevenue. Enter it from the expense records.',
    },
    {
      item: '—',
      label: 'Tax collected (reconciliation)',
      dollars: dollars(tx?.taxCollectedCents),
      note: 'What was actually charged to Texas customers. Webfile computes tax due from Item 2; this is the figure to reconcile it against.',
    },
    {
      item: '—',
      label: 'Texas transactions',
      dollars: payload ? String(tx?.transactionCount ?? 0) : null,
      note: 'Invoices in the period with a Texas billing address.',
    },
  ]
}

/** A jurisdiction row for the "why the rest is not on the return" table. */
export interface TaxReturnJurisdictionRow {
  jurisdiction: string
  isTexas: boolean
  transactionCount: number
  totalSalesDollars: string
  taxableSalesDollars: string
  taxCollectedDollars: string
}

/** Every jurisdiction, Texas first, then by receipts descending. */
export function taxReturnJurisdictionRows(
  payload: TaxReturnPayload | null,
): TaxReturnJurisdictionRow[] {
  const byJurisdiction = payload?.summary?.byJurisdiction ?? {}
  return Object.entries(byJurisdiction)
    .map(([jurisdiction, bucket]) => ({
      jurisdiction,
      isTexas: jurisdiction === TX_JURISDICTION,
      transactionCount: Number(bucket?.transactionCount ?? 0),
      totalSalesDollars: centsToDollars(bucket?.totalSalesCents),
      taxableSalesDollars: centsToDollars(bucket?.taxableSalesCents),
      taxCollectedDollars: centsToDollars(bucket?.taxCollectedCents),
      sortKey: Number(bucket?.totalSalesCents ?? 0),
    }))
    .sort((a, b) => {
      if (a.isTexas !== b.isTexas) return a.isTexas ? -1 : 1
      return b.sortKey - a.sortKey
    })
    .map(({ sortKey: _sortKey, ...row }) => row)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The working papers: one line per invoice behind the totals, in dollars.
 *
 * Prefixed with the figures actually filed and the counts that qualify them,
 * so the exported file is self-contained evidence — a spreadsheet that says
 * only "1,234.56" cannot be audited a year later, and a period filed with
 * three unreadable rows must carry that fact in the record, not just on a
 * screen nobody screenshotted.
 */
export function taxReturnCsv(payload: TaxReturnPayload | null): string {
  if (!payload) return ''
  const verdict = taxReturnAttention(payload)
  const lines: string[][] = [
    ['Aglyn — Texas sales tax return working papers'],
    ['Period', payload.period ?? ''],
    ['Period start (UTC)', payload.summary?.periodStart ?? ''],
    ['Period end (UTC, exclusive)', payload.summary?.periodEnd ?? ''],
    ['Taxpayer number', TX_TAXPAYER_NUMBER],
    ['Webfile number', TX_WEBFILE_NUMBER],
    [],
    ['Webfile figures (Texas only)'],
    ['Item', 'Line', 'Amount (USD)', 'Note'],
    ...taxReturnWebfileLines(payload).map((line) => [
      line.item,
      line.label,
      line.dollars ?? 'NOT COMPUTED',
      line.note,
    ]),
    [],
    ['Refunds recorded in period (stated, not netted)'],
    ['Rows refunded', String(payload.summary?.refunds?.rowsRefundedInPeriod ?? 0)],
    [
      'Refunded gross (USD)',
      centsToDollars(payload.summary?.refunds?.refundedGrossCents),
    ],
    [
      'Estimated refunded tax (USD)',
      centsToDollars(payload.summary?.refunds?.estimatedRefundedTaxCents),
    ],
    [],
    ['Rows needing attention', String(verdict.total)],
    ['Severity', 'Count', 'Finding', 'What it means'],
    ...(verdict.items.length
      ? verdict.items.map((item) => [
          item.severity === 'blocking' ? 'BLOCKING' : 'REVIEW',
          String(item.count),
          item.label,
          item.detail,
        ])
      : [['—', '0', 'None — every row read cleanly', '']]),
    [],
    ['All jurisdictions'],
    [
      'Jurisdiction',
      'Transactions',
      'Total sales (USD)',
      'Taxable sales (USD)',
      'Tax collected (USD)',
    ],
    ...taxReturnJurisdictionRows(payload).map((row) => [
      row.jurisdiction,
      String(row.transactionCount),
      row.totalSalesDollars,
      row.taxableSalesDollars,
      row.taxCollectedDollars,
    ]),
    [],
    ['Invoice rows'],
    [
      'invoiceId',
      'orgId',
      'paidAt',
      'country',
      'state',
      'gross (USD)',
      'tax (USD)',
      'taxable base (USD)',
      'refunded (USD)',
      'automaticTax',
    ],
    ...(payload.rows ?? []).map((row) => [
      row.invoiceId,
      row.orgId ?? '',
      row.paidAt ?? '',
      row.country ?? '',
      row.state ?? '',
      centsToDollars(row.grossCents),
      centsToDollars(row.taxCents),
      centsToDollars(row.taxableSalesCents),
      centsToDollars(row.refundedCents),
      row.automaticTax ? 'yes' : 'no',
    ]),
  ]
  return lines.map((row) => (row ?? []).map(csvCell).join(',')).join('\n')
}

/** A filename that sorts and identifies without being opened. */
export function taxReturnCsvFilename(period: string): string {
  const safe = String(period ?? '').replace(/[^\dA-Za-z-]/g, '') || 'period'
  return `aglyn-tx-sales-tax-${safe}.csv`
}

export interface TaxReturnPeriodOption {
  value: string
  label: string
  kind: 'quarter' | 'month'
}

/**
 * The periods worth offering: every quarter and month from the registration's
 * first taxable sales date (2026-09-01) through the one containing `now`,
 * newest first.
 *
 * Nothing earlier is listed because nothing earlier is filable — Aglyn had no
 * Texas collection obligation before that date, and a period that cannot be
 * filed is a period that can only be picked by mistake. Nothing later is
 * listed because a period that has not happened has no figures.
 */
export function taxReturnPeriodOptions(now: Date): TaxReturnPeriodOption[] {
  const quarters: TaxReturnPeriodOption[] = []
  const months: TaxReturnPeriodOption[] = []
  const year = now.getUTCFullYear()
  const monthIndex = now.getUTCMonth()
  const firstYear = TX_FIRST_TAXABLE_PERIOD.year
  const firstQuarterIndex = TX_FIRST_TAXABLE_PERIOD.quarter - 1
  const firstMonthIndex = firstQuarterIndex * 3 + 2 // September

  for (let y = firstYear; y <= year; y += 1) {
    for (let q = 0; q < 4; q += 1) {
      if (y === firstYear && q < firstQuarterIndex) continue
      if (y === year && q * 3 > monthIndex) continue
      quarters.push({
        value: `${y}-Q${q + 1}`,
        label: `${y} Q${q + 1}`,
        kind: 'quarter',
      })
    }
    for (let m = 0; m < 12; m += 1) {
      if (y === firstYear && m < firstMonthIndex) continue
      if (y === year && m > monthIndex) continue
      const month = String(m + 1).padStart(2, '0')
      months.push({
        value: `${y}-${month}`,
        label: `${y}-${month} (month)`,
        kind: 'month',
      })
    }
  }
  return [...quarters.reverse(), ...months.reverse()]
}

/** The period a filer lands on: the newest quarter that has fully ended. */
export function defaultTaxReturnPeriod(now: Date): string {
  const options = taxReturnPeriodOptions(now).filter(
    (option) => option.kind === 'quarter',
  )
  if (!options.length) return `${TX_FIRST_TAXABLE_PERIOD.year}-Q${TX_FIRST_TAXABLE_PERIOD.quarter}`
  const currentQuarter = `${now.getUTCFullYear()}-Q${
    Math.floor(now.getUTCMonth() / 3) + 1
  }`
  // The current quarter is still accruing, so its figures are not a return.
  // Prefer the one before it — but never invent a period that predates the
  // collection obligation, so a launch-quarter filer still gets a real one.
  const ended = options.find((option) => option.value !== currentQuarter)
  return (ended ?? options[0]).value
}
