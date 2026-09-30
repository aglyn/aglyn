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
 * Storefront sales on the operator's sales tax return (AGL-1904, AGL-3080).
 *
 * The operator's return sums its own invoices; this is the storefront's half
 * of it, answered through the platform's tax return source contract
 * (`@aglyn/aglyn/plugin-manager/plugin-tax-return-sources`). It reads
 * `storefrontTaxCollected` — a SEPARATE collection from the operator's own
 * invoices, queried and reported separately, because a storefront row's
 * money is mostly the merchant's while an invoice row's is the operator's.
 * Summing the two would put other companies' receipts into the return's
 * total sales, which is why they never meet in one query and never share a
 * figure.
 *
 * What it answers, all worded for the filing jurisdiction the platform
 * resolved:
 *
 *   - **The three liability buckets**, never summed — see
 *     `model/storefront-tax-summary.ts`.
 *   - **A blocking finding for the platform-liable tax** in the filing
 *     jurisdiction. Every storefront checkout is created on the platform's
 *     own account, so a `mode: 'stripe'` store's shopper is charged tax Stripe
 *     computes against the PLATFORM's registrations — measured, not inferred.
 *     That money is in the platform's balance and is NOT in the filing
 *     figures, which sum the operator's own sales only. Filing those without
 *     deciding what to do with this figure is exactly the shortfall an
 *     auditor finds. It states the mechanics and asks for a decision; it does
 *     NOT assert a marketplace-facilitator position — that attaches by
 *     operation of law and belongs to counsel, not to this report.
 *   - **Two lines beneath the filing figures** — the platform-liable tax and
 *     the merchant's own rate, stated side by side and never folded into a
 *     form item, because this report does not decide how storefront receipts
 *     are reported and adding them to one would be deciding it silently.
 *   - **Facilitated sales by buyer state** — the economic-nexus question
 *     (AGL-1956), with the three buckets SUMMED per jurisdiction on purpose:
 *     a threshold counts the sale whoever remits it. Who remits is still
 *     carried per row.
 *
 * Truncation and rows no period can reach are reported, and the platform
 * raises each as a blocking finding of its own.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  asRowDate,
  centsToDollars,
} from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'
import type {
  TaxReturnExportBlock,
  TaxReturnFiling,
  TaxReturnFilingLine,
  TaxReturnFinding,
  TaxReturnSectionTable,
  TaxReturnSource,
  TaxReturnSourceAnswer,
  TaxReturnSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import {
  storefrontTaxSummary,
  type StorefrontTaxReturnRowInput,
  type StorefrontTaxSummary,
} from '../model/storefront-tax-summary'

/** One row of the storefront listing, as the working papers carry it. */
export interface StorefrontTaxRow {
  id: string
  hostId: string | null
  orgId: string | null
  paidAt: string | null
  taxMode: string | null
  taxLiability: string | null
  grossCents: number
  taxCents: number
  taxableSalesCents: number
  state: string | null
  country: string | null
}

/** A liability bucket, ready to print. */
export interface StorefrontTaxBucketRow {
  id: 'aglynLiable' | 'merchantManual' | 'connectedAccountLiable'
  label: string
  /** Who owes it — the sentence that decides whether it is on this return. */
  liability: string
  transactionCount: number
  grossDollars: string
  taxableSalesDollars: string
  taxCollectedDollars: string
  /** True when this row is money in the platform's balance under its registration. */
  platformLiable: boolean
}

/** One state's facilitated storefront sales, for the nexus question. */
export interface StorefrontFacilitatedJurisdictionRow {
  jurisdiction: string
  /** True for the one jurisdiction this deployment files a return in. */
  isFilingJurisdiction: boolean
  transactionCount: number
  totalSalesDollars: string
  taxCollectedDollars: string
  /** The part of `taxCollectedDollars` the platform holds and must remit. */
  platformLiableTaxDollars: string
  /** True when NO tax was collected on any sale into this state. */
  untaxed: boolean
}

/**
 * Storefront tax in the FILING jurisdiction that Stripe computed against the
 * platform's own registrations.
 *
 * The one figure that decides whether a period can be filed from the filing
 * lines alone. Deliberately excludes `merchantManual` — a merchant's own
 * configured rate never touched those registrations. Read against the
 * configured jurisdiction rather than Texas, because a hard-coded key answers
 * `0.00` everywhere else — and a zero here reads as "nothing to decide" on
 * the one finding that blocks filing.
 */
export function storefrontPlatformLiableCents(
  summary: StorefrontTaxSummary | null | undefined,
  filing: TaxReturnFiling,
): number {
  const figures = summary?.aglynLiable?.byJurisdiction?.[filing.code]
  const cents = Number(figures?.taxCollectedCents ?? 0)
  return Number.isFinite(cents) ? cents : 0
}

/** The merchant's own configured tax in the filing jurisdiction. */
function merchantManualCents(
  summary: StorefrontTaxSummary | null | undefined,
  filing: TaxReturnFiling,
): number {
  return Number(
    summary?.merchantManual?.byJurisdiction?.[filing.code]?.taxCollectedCents ?? 0,
  )
}

/** The storefront's findings. The platform raises the non-zero ones. */
export function storefrontTaxFindings(
  summary: StorefrontTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnFinding[] {
  const brand = PLATFORM_BRAND_NAME
  return [
    {
      // BLOCKING on purpose — see the module note.
      id: 'storefrontAglynLiableTax',
      severity: 'blocking',
      count: storefrontPlatformLiableCents(summary, filing),
      label: `${filing.label} storefront tax collected under ${brand}’s registration`,
      detail:
        'Cents. Charged to shoppers on merchants’ storefront sales, computed ' +
        'by Stripe Tax against THE PLATFORM’s registrations (the session is ' +
        'created on the platform account), and settled into the platform’s ' +
        `balance. It is NOT included in ${filing.figuresName} below. Decide ` +
        'with counsel how it is reported before filing — do not file as if ' +
        'it were zero.',
    },
    {
      id: 'storefrontUnclassified',
      severity: 'blocking',
      count: Number(summary?.attention?.rowsUnclassified ?? 0),
      label: 'Storefront rows with an unrecognised tax mode',
      detail:
        'Not counted in any storefront bucket, so they are in no figure at ' +
        'all. Classify them before filing.',
    },
    {
      id: 'storefrontMissingTaxableBase',
      severity: 'review',
      count: Number(summary?.attention?.rowsMissingTaxableBase ?? 0),
      label: 'Storefront rows with tax but no stated base',
      detail:
        'Tax was collected but Stripe’s taxable_amount could not be read, so ' +
        'the storefront taxable-sales figure understates the base. Re-read ' +
        'the session in Stripe with the tax breakdown expanded.',
    },
  ]
}

/**
 * The two lines beneath the filing figures: the platform-liable tax and the
 * merchant's own rate, separately, and outside every form item.
 */
export function storefrontFilingLines(
  summary: StorefrontTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnFilingLine[] {
  const brand = PLATFORM_BRAND_NAME
  const platformLiable = centsToDollars(storefrontPlatformLiableCents(summary, filing))
  const merchant = centsToDollars(merchantManualCents(summary, filing))
  if (filing.form === 'tx-webfile') {
    return [
      {
        item: '—',
        label: `${filing.label} storefront tax under ${brand}’s registration (NOT in ${filing.figuresName})`,
        dollars: platformLiable,
        note:
          `Collected from shoppers on merchants’ sales and held in ${brand}’s ` +
          'balance. Excluded from every item above. Its treatment on the ' +
          'return is a question for counsel — see AGL-1904.',
      },
      {
        item: '—',
        label: `${filing.label} storefront tax under the MERCHANT’s own rate (not ${brand}’s)`,
        dollars: merchant,
        note:
          `A manual-mode store’s own configured rate. ${brand}’s registrations ` +
          'played no part in computing it. Shown so it is visibly NOT the line ' +
          'above — the two must never be added together.',
      },
    ]
  }
  return [
    {
      item: '—',
      label: `${filing.code} storefront tax under the platform’s registration (NOT in the figures above)`,
      dollars: platformLiable,
      note:
        'Collected from shoppers on merchants’ sales and held in the ' +
        'platform’s balance. Excluded from every figure above. Its treatment ' +
        'on the return is a question for the operator’s own counsel.',
    },
    {
      item: '—',
      label: `${filing.code} storefront tax under the MERCHANT’s own rate`,
      dollars: merchant,
      note:
        'A manual-mode store’s own configured rate. The platform’s ' +
        'registrations played no part in computing it. Shown so it is ' +
        'visibly NOT the line above — the two must never be added together.',
    },
  ]
}

/** The three liability buckets, in the order a reader decides them. */
export function storefrontBucketRows(
  summary: StorefrontTaxSummary,
): StorefrontTaxBucketRow[] {
  const brand = PLATFORM_BRAND_NAME
  const buckets: Array<{
    id: StorefrontTaxBucketRow['id']
    label: string
    liability: string
    platformLiable: boolean
  }> = [
    {
      id: 'aglynLiable',
      label: `Computed against ${brand}’s registrations`,
      liability: `In ${brand}’s balance. Stripe Tax computed it on ${brand}’s platform account.`,
      platformLiable: true,
    },
    {
      id: 'merchantManual',
      label: 'Merchant’s own configured rate',
      liability: `The merchant’s. It never touched an ${brand} registration and is not ${brand}’s to remit.`,
      platformLiable: false,
    },
    {
      id: 'connectedAccountLiable',
      label: 'Stripe Tax named the connected account liable',
      liability: 'The connected account’s. Empty today.',
      platformLiable: false,
    },
  ]
  return buckets.map((bucket) => {
    const figures = summary?.[bucket.id]
    return {
      id: bucket.id,
      label: bucket.label,
      liability: bucket.liability,
      transactionCount: Number(figures?.transactionCount ?? 0),
      grossDollars: centsToDollars(figures?.grossCents),
      taxableSalesDollars: centsToDollars(figures?.taxableSalesCents),
      taxCollectedDollars: centsToDollars(figures?.taxCollectedCents),
      platformLiable: bucket.platformLiable,
    }
  })
}

/**
 * FACILITATED SALES BY STATE — the economic-nexus question (AGL-1956).
 *
 * The question a state asks a marketplace facilitator is "how much did you
 * facilitate INTO this state, and in how many transactions" — not "how much
 * tax did you collect there". A state the operator is not registered in
 * collects nothing by definition, which is exactly why collection cannot be
 * the measure: the states worth watching are the ones showing $0 tax and a
 * rising sales figure.
 *
 * So this SUMS the three liability buckets per jurisdiction. The rule that
 * the operator's own invoices and storefront rows are never summed still
 * holds — nothing here touches the operator's own sales; within the
 * storefront collection the buckets differ only in WHO REMITS, and a nexus
 * threshold counts the sale whoever remits it. Who remits is still carried
 * per row, because "do we have nexus here" and "what do we owe here" are
 * answered off the same rows and must not blur.
 *
 * ⚠️ A LOWER BOUND, deliberately rather than silently: `storefront-tax-record.ts`
 * files no row at all for a sale whose `taxMode` resolves to `none`, so a
 * wholly untaxed storefront sale is invisible here — the population nexus
 * detection most needs. Closing it is a write-side change recorded on
 * AGL-1956. The filing jurisdiction does not depend on any of this: a filer
 * registered where it is established has no in-state threshold left to cross.
 */
export function storefrontFacilitatedJurisdictionRows(
  summary: StorefrontTaxSummary | null | undefined,
  filing: TaxReturnFiling,
): StorefrontFacilitatedJurisdictionRow[] {
  if (!summary) return []
  const totals = new Map<
    string,
    { count: number; salesCents: number; taxCents: number; platformCents: number }
  >()
  const buckets: Array<[StorefrontTaxBucketRow['id'], boolean]> = [
    ['aglynLiable', true],
    ['merchantManual', false],
    ['connectedAccountLiable', false],
  ]
  for (const [id, platformLiable] of buckets) {
    const byJurisdiction = summary[id]?.byJurisdiction ?? {}
    for (const [jurisdiction, figures] of Object.entries(byJurisdiction)) {
      const entry = totals.get(jurisdiction) ?? {
        count: 0,
        salesCents: 0,
        taxCents: 0,
        platformCents: 0,
      }
      const taxCents = Number(figures?.taxCollectedCents ?? 0)
      entry.count += Number(figures?.transactionCount ?? 0)
      entry.salesCents += Number(figures?.totalSalesCents ?? 0)
      entry.taxCents += taxCents
      if (platformLiable) entry.platformCents += taxCents
      totals.set(jurisdiction, entry)
    }
  }
  return [...totals.entries()]
    .map(([jurisdiction, entry]) => ({
      jurisdiction,
      isFilingJurisdiction: jurisdiction === filing.code,
      transactionCount: entry.count,
      totalSalesDollars: centsToDollars(entry.salesCents),
      taxCollectedDollars: centsToDollars(entry.taxCents),
      platformLiableTaxDollars: centsToDollars(entry.platformCents),
      untaxed: entry.taxCents === 0,
    }))
    .sort(
      (a, b) =>
        // The filing jurisdiction first — it is the one obligation that does
        // not wait on a threshold — then by the figure a threshold is
        // actually measured against.
        Number(b.isFilingJurisdiction) - Number(a.isFilingJurisdiction) ||
        Number(b.totalSalesDollars) - Number(a.totalSalesDollars) ||
        a.jurisdiction.localeCompare(b.jurisdiction),
    )
}

/** The storefront's two tables on the return's screen. */
function storefrontTables(
  summary: StorefrontTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnSectionTable[] {
  const brand = PLATFORM_BRAND_NAME
  return [
    {
      // Split by who owes it, never summed — one "storefront tax" total would
      // merge two facts into a number that is true of neither.
      columns: [
        { label: 'Bucket' },
        { label: 'Sales', numeric: true },
        { label: 'Gross', numeric: true, money: true },
        { label: 'Taxable sales', numeric: true, money: true },
        { label: 'Tax collected', numeric: true, money: true },
      ],
      rows: storefrontBucketRows(summary).map((row) => ({
        key: row.id,
        cells: [
          {
            text: row.label,
            caption: row.liability,
            ...(row.platformLiable
              ? { tag: { label: `${brand} holds this`, tone: 'attention' as const } }
              : {}),
          },
          { text: String(row.transactionCount) },
          { text: `$${row.grossDollars}` },
          { text: `$${row.taxableSalesDollars}` },
          { text: `$${row.taxCollectedDollars}`, strong: row.platformLiable },
        ],
      })),
      empty: 'This period’s response carries no storefront figures.',
    },
    {
      heading: 'Facilitated sales by buyer state',
      description:
        `What ${brand} facilitated into each state, whoever remits the ` +
        'tax — the figure an economic-nexus threshold is measured ' +
        `against. ${filing.code} needs no threshold: the filer is ` +
        'established there, so the obligation is unconditional. A ' +
        'region showing sales and no tax is the one to watch.',
      columns: [
        { label: 'Buyer state' },
        { label: 'Sales', numeric: true },
        { label: 'Total sales', numeric: true, money: true },
        { label: 'Tax collected', numeric: true, money: true },
        { label: `Of which ${brand} owes`, numeric: true, money: true },
      ],
      rows: storefrontFacilitatedJurisdictionRows(summary, filing).map((row) => ({
        key: row.jurisdiction,
        cells: [
          {
            text: row.jurisdiction === 'unknown' ? 'Not stated' : row.jurisdiction,
            ...(row.isFilingJurisdiction
              ? { tag: { label: 'Registered', tone: 'attention' as const } }
              : row.untaxed
                ? { tag: { label: 'No tax collected', tone: 'neutral' as const } }
                : {}),
          },
          { text: String(row.transactionCount) },
          { text: `$${row.totalSalesDollars}` },
          { text: `$${row.taxCollectedDollars}` },
          {
            text: `$${row.platformLiableTaxDollars}`,
            strong: Number(row.platformLiableTaxDollars) > 0,
          },
        ],
      })),
      empty: 'No storefront sales recorded in this period.',
      footnote:
        'A LOWER BOUND. A storefront sale that collected no tax at ' +
        'all files no row, so it is missing here — which is exactly ' +
        'the population a nexus check wants. Recorded on AGL-1956.',
    },
  ]
}

/**
 * The storefront's blocks of the working-papers export: the nexus figures
 * beside the operator's own sales by jurisdiction — a different taxpayer's
 * money and never summed with them — and the liability buckets after the
 * working papers.
 */
function storefrontExports(
  summary: StorefrontTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnExportBlock[] {
  const brand = PLATFORM_BRAND_NAME
  const facilitated = storefrontFacilitatedJurisdictionRows(summary, filing)
  return [
    {
      placement: 'jurisdictions',
      rows: [
        ['Facilitated sales by buyer state (merchants’ storefronts)'],
        [
          'Buyer state',
          'Sales',
          'Total sales (USD)',
          'Tax collected (USD)',
          `Of which ${brand} owes (USD)`,
        ],
        ...(facilitated.length
          ? facilitated.map((row) => [
              row.jurisdiction,
              String(row.transactionCount),
              row.totalSalesDollars,
              row.taxCollectedDollars,
              row.platformLiableTaxDollars,
            ])
          : [['—', '0', '0.00', '0.00', '0.00']]),
        [
          'LOWER BOUND — a storefront sale that collected no tax files no row, ' +
            `so it is absent here. ${filing.code} needs no threshold: the filer ` +
            'is established there.',
        ],
      ],
    },
    {
      placement: 'sections',
      rows: [
        [
          'Storefront commerce tax by liability (AGL-1904) — NOT in ' +
            (filing.form === 'tx-webfile' ? 'the Webfile figures' : 'the breakdown above'),
        ],
        [
          'Bucket',
          'Who owes it',
          'Transactions',
          'Gross (USD)',
          'Taxable sales (USD)',
          'Tax collected (USD)',
        ],
        ...storefrontBucketRows(summary).map((row) => [
          row.label,
          row.liability,
          String(row.transactionCount),
          row.grossDollars,
          row.taxableSalesDollars,
          row.taxCollectedDollars,
        ]),
      ],
    },
  ]
}

/** One storefront row as the working papers carry it. */
function projectRow(row: StorefrontTaxReturnRowInput): StorefrontTaxRow {
  return {
    id: row.id,
    hostId: typeof row.hostId === 'string' ? row.hostId : null,
    orgId: row.orgId ?? null,
    paidAt: asRowDate(row.paidAt)?.toISOString() ?? null,
    taxMode: typeof row.taxMode === 'string' ? row.taxMode : null,
    taxLiability: typeof row.taxLiability === 'string' ? row.taxLiability : null,
    grossCents: Number(row.grossCents ?? 0),
    taxCents: Number(row.taxCents ?? 0),
    taxableSalesCents: (Array.isArray(row.taxLines) ? row.taxLines : [])
      .map((line) => Number(line?.taxableAmountCents ?? 0))
      .reduce((sum, base) => sum + (Number.isFinite(base) ? base : 0), 0),
    state: typeof row.customerAddress?.state === 'string' ? row.customerAddress.state : null,
    country:
      typeof row.customerAddress?.country === 'string' ? row.customerAddress.country : null,
  }
}

/**
 * The storefront's answer for one period, from rows already read. Pure, so
 * the section a preparer reads can be proved from fixtures.
 */
export function storefrontTaxReturnAnswer(
  read: {
    rows: readonly StorefrontTaxReturnRowInput[]
    truncated: boolean
    undatedRows: number
  },
  request: TaxReturnSourceRequest,
): TaxReturnSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { filing } = request
  const summary = storefrontTaxSummary(read.rows, request)
  return {
    id: 'storefront',
    name: 'Storefront',
    title: 'Storefront commerce tax — merchants’ sales',
    help:
      'Tax charged to shoppers on merchants’ storefronts, split by who owes it. None of it is in the filing figures above.',
    intro:
      `None of this is in the ${
        filing.form === 'tx-webfile' ? 'Webfile' : 'breakdown'
      } figures above, which sum ` +
      `${brand}’s OWN sales only. The first row is the one that ` +
      `needs a decision: those sessions are created on ${brand}’s ` +
      `platform account, so Stripe computed that tax against ` +
      `${brand}’s registrations and it settled into ${brand}’s balance.`,
    truncated: read.truncated,
    undatedRows: read.undatedRows,
    findings: storefrontTaxFindings(summary, filing),
    filingLines: storefrontFilingLines(summary, filing),
    tables: storefrontTables(summary, filing),
    figures: [],
    exports: storefrontExports(summary, filing),
    summary,
    rows: read.rows.map(projectRow),
  }
}

/**
 * The storefront's source, registered on the console's API surface: the
 * staff return awaits that surface before it asks.
 *
 * Two queries, and the second is the honesty check: the period query ranges
 * on `paidAt`, and a Firestore range query CANNOT match a document whose
 * field is null — so a row that failed to date itself would be invisible to
 * every period. The equality probe counts those rows, over all of them, and
 * the platform blocks the return on any.
 */
export const commerceTaxReturnSource: TaxReturnSource = {
  async read(request) {
    const collection = firebaseAdmin.app().firestore().collection('storefrontTaxCollected')
    const [inPeriod, undated] = await Promise.all([
      collection
        .where('paidAt', '>=', request.start)
        .where('paidAt', '<', request.end)
        .limit(request.rowCap + 1)
        .get(),
      collection.where('paidAt', '==', null).count().get(),
    ])
    const rows: StorefrontTaxReturnRowInput[] = inPeriod.docs
      .slice(0, request.rowCap)
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<StorefrontTaxReturnRowInput, 'id'>),
      }))
    return storefrontTaxReturnAnswer(
      {
        rows,
        truncated: inPeriod.size > request.rowCap,
        undatedRows: Number(undated.data().count ?? 0),
      },
      request,
    )
  },
}
