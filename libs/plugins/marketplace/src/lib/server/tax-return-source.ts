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
 * Marketplace sales tax on the operator's return (AGL-2137, AGL-3080).
 *
 * Answered through the platform's tax return source contract
 * (`@aglyn/aglyn/plugin-manager/plugin-tax-return-sources`), and kept apart
 * from the operator's own invoices and from every other source for one
 * reason: a marketplace row's gross is mostly the PUBLISHER's money, so
 * summing it into any other total would put someone else's receipts into the
 * return's sales figure.
 *
 * The tax itself is why it belongs on the return at all. Marketplace checkout
 * sets `automatic_tax[enabled]` on the PLATFORM's own charge with the tax
 * added `exclusive` on top and kept platform-side (`checkout.ts` — the
 * transfer to the publisher is a fixed `transfer_data[amount]` computed from
 * the PRE-tax price). Under the marketplace-provider registration that tax is
 * the operator's to remit, in full. There is no merchant-liable arm, so the
 * whole of it is a BLOCKING finding: it is in no filing line.
 *
 * The period is ranged on `createdAt`, a SINGLE-FIELD inequality served by
 * Firestore's automatic index — deliberately, so this cannot be the query
 * that fails the staff page over a composite index nobody deployed.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  asRowDate,
  centsToDollars,
  emptyTaxJurisdiction,
  taxJurisdictionKey,
  type TaxReturnJurisdiction,
} from '@aglyn/aglyn/app-utils/tax-jurisdiction-figures'
import type {
  TaxReturnFiling,
  TaxReturnFinding,
  TaxReturnSectionFigure,
  TaxReturnSource,
  TaxReturnSourceAnswer,
  TaxReturnSourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'

export interface MarketplaceTaxReturnRowInput {
  id: string
  sellerOrgId?: unknown
  /** Tax-INCLUSIVE gross the buyer paid (`amount_total`). */
  amountCents?: unknown
  taxCents?: unknown
  /** The seller's Connect transfer. Never the platform's revenue and never taxed. */
  transferCents?: unknown
  /** Stripe's CUMULATIVE refund total on the charge, when one has happened. */
  refundedCents?: unknown
  createdAt?: unknown
  /**
   * The buyer's tax jurisdiction, as the marketplace webhook records it —
   * exactly `country` and `state`, under the same field name every half of
   * the return reads a jurisdiction from.
   *
   * Absent on every row written before the webhook recorded it, and those
   * rows are COUNTED in `attention.rowsMissingJurisdiction` rather than
   * reconstructed. See {@link marketplaceTaxSummary}.
   */
  customerAddress?: {
    country?: unknown
    state?: unknown
  } | null
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
  /**
   * Keyed `COUNTRY-STATE` (e.g. `US-TX`), exactly as every other half of the
   * return keys its own; rows that state no jurisdiction are under `unknown`
   * — and counted in `attention.rowsMissingJurisdiction`.
   *
   * `taxabilityReasons` and `rates` are empty on every bucket here, by
   * construction rather than by omission: a marketplace purchase records no
   * per-rate breakdown, so there is no working paper to state and nothing
   * claiming to reconcile to the tax. The figures are Stripe's own
   * `amount_tax` on the platform's charge.
   */
  byJurisdiction: Record<string, TaxReturnJurisdiction>
  attention: {
    /**
     * Rows that state no jurisdiction, so none can be attributed.
     *
     * Every row written before the marketplace webhook recorded one is in
     * here permanently. That is the honest record and not a gap to close
     * later: the address those sales were taxed from lives in Stripe, and
     * copying it back onto a filed period would restate an attribution
     * nobody made at the time.
     */
    rowsMissingJurisdiction: number
    rowsMissingCreatedAt: number
    /** A refund larger than the charge — data fault, never netted below zero. */
    rowsOverRefunded: number
  }
}

/** One row of the marketplace listing, as the working papers carry it. */
export interface MarketplaceTaxRow {
  id: string
  sellerOrgId: string | null
  createdAt: string | null
  grossCents: number
  taxCents: number
  refundedCents: number
}

function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/**
 * Marketplace sales tax for one period (AGL-2137).
 *
 * NET OF REFUNDS. `refundedCents` is Stripe's cumulative figure for the
 * charge, so the refunded tax is its pro-rata share of the row's own gross; a
 * fully refunded sale nets to exactly zero tax. Both halves are also reported
 * separately, because "we charged X and gave back Y" is the sentence a return
 * needs, not a single number that could be either.
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
    byJurisdiction: {},
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
    // The jurisdiction the row STATES, through the return's one derivation of
    // `COUNTRY-STATE`, so no two halves can key the same state differently.
    //
    // A row stating none is bucketed under `unknown` and counted, never
    // guessed: `unknown` is a jurisdiction on this report only in the sense
    // that it is somewhere the tax demonstrably cannot be placed.
    const jurisdiction = taxJurisdictionKey(row.customerAddress)
    if (jurisdiction === 'unknown') {
      summary.attention.rowsMissingJurisdiction += 1
    }
    if (!asRowDate(row.createdAt)) summary.attention.rowsMissingCreatedAt += 1

    const netTax = tax - refundedTax
    const sales = Math.max(0, gross - tax)
    summary.transactionCount += 1
    summary.grossCents += gross
    summary.taxableSalesCents += sales
    summary.taxChargedCents += tax
    summary.taxRefundedCents += refundedTax
    summary.taxCollectedCents += netTax

    const bucket = (summary.byJurisdiction[jurisdiction] ??= emptyTaxJurisdiction())
    bucket.transactionCount += 1
    // Sales and the taxable base are the same number on a marketplace row and
    // that is not a copy-paste: the tax is added `exclusive` on top of the
    // listing price, so the receipts excluding tax ARE the base the rate was
    // applied to. Both are stated because the shared jurisdiction shape asks
    // for both, and a reader comparing this bucket against another source's
    // must not have to know which single field was populated.
    bucket.totalSalesCents += sales
    bucket.taxableSalesCents += sales
    // NET of refunds, matching `taxCollectedCents` above — a state is owed
    // what was kept, not what was charged.
    bucket.taxCollectedCents += netTax
  }
  return summary
}

/** The marketplace's findings. The platform raises the non-zero ones. */
export function marketplaceTaxFindings(
  summary: MarketplaceTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnFinding[] {
  return [
    {
      // Stated as the PLATFORM TOTAL, with the per-jurisdiction split beside
      // it in the figures rather than folded into this count. Purchases
      // recorded before the webhook stored a jurisdiction state none and never
      // will, so a "Texas marketplace tax" figure presented as the whole
      // answer would be a guess wearing a total's clothes.
      id: 'marketplaceTaxCollected',
      severity: 'blocking',
      count: Number(summary?.taxCollectedCents ?? 0),
      label: `Marketplace tax collected under ${PLATFORM_BRAND_NAME}’s registration`,
      detail:
        'Cents, net of refunds. Charged on marketplace purchases as an ' +
        'EXCLUSIVE addition to the platform’s own charge, so none of it went ' +
        'to the publisher and all of it is in the platform’s balance. It is ' +
        `NOT in ${filing.figuresName} below. Decide with counsel how it is ` +
        'reported before filing — do not file as if it were zero.',
    },
    {
      id: 'marketplaceOverRefunded',
      severity: 'blocking',
      count: Number(summary?.attention?.rowsOverRefunded ?? 0),
      label: 'Marketplace rows refunded past their own charge',
      detail:
        'A refund larger than the charge is a data fault. The refunded tax ' +
        'is clamped so the figure is never netted below zero — which means ' +
        'these rows may OVERSTATE what was given back. Read them in Stripe.',
    },
    {
      id: 'marketplaceMissingJurisdiction',
      severity: 'review',
      count: Number(summary?.attention?.rowsMissingJurisdiction ?? 0),
      label: 'Marketplace rows with no stated jurisdiction',
      detail:
        'Their tax cannot be placed in a state, so it is in the marketplace ' +
        'total and in no state’s figure. Purchases recorded before the ' +
        'webhook stored a jurisdiction state none permanently — the address ' +
        'they were taxed from is in Stripe, and copying it back would ' +
        'attribute a filed period after the fact. Read them there instead.',
    },
    {
      id: 'marketplaceMissingCreatedAt',
      severity: 'review',
      count: Number(summary?.attention?.rowsMissingCreatedAt ?? 0),
      label: 'Marketplace rows with no readable date',
      detail:
        'Period assignment fell back to the query bounds, so these purchases ' +
        'may belong to a neighboring period.',
    },
  ]
}

/**
 * The marketplace tax split by jurisdiction, one line each.
 *
 * Filing jurisdiction first — it is the one obligation that does not wait on
 * a threshold — then dearest first, and `unknown` last wherever it falls.
 * `unknown` is deliberately not sorted among the states: it is not a place,
 * it is the part of the total that has none.
 */
function jurisdictionFigures(
  summary: MarketplaceTaxSummary,
  filingCode: string,
): TaxReturnSectionFigure[] {
  const entries = Object.entries(summary.byJurisdiction ?? {})
  if (entries.length === 0) return []
  return entries
    .sort(
      ([aKey, aFigures], [bKey, bFigures]) =>
        Number(bKey !== 'unknown') - Number(aKey !== 'unknown') ||
        Number(bKey === filingCode) - Number(aKey === filingCode) ||
        Number(bFigures?.taxCollectedCents ?? 0) -
          Number(aFigures?.taxCollectedCents ?? 0) ||
        aKey.localeCompare(bKey),
    )
    .map(([jurisdiction, figures]) => ({
      label:
        jurisdiction === 'unknown'
          ? 'Tax collected — no stated jurisdiction'
          : `Tax collected — ${jurisdiction}`,
      value: `$${centsToDollars(figures?.taxCollectedCents)}`,
      note:
        jurisdiction === 'unknown'
          ? `${Number(figures?.transactionCount ?? 0)} purchase(s) that state no jurisdiction. In the total above and in no state’s figure.`
          : `${Number(figures?.transactionCount ?? 0)} purchase(s), $${centsToDollars(figures?.totalSalesCents)} of sales excluding tax.${
              jurisdiction === filingCode ? ' The filing jurisdiction.' : ''
            }`,
    }))
}

/**
 * The marketplace's figures.
 *
 * Charged and refunded are stated ALONGSIDE the net, never folded into it:
 * "we charged X and gave back Y" is the sentence a return needs, and a single
 * number that could be either is what this shape refuses to print.
 */
export function marketplaceTaxFigures(
  summary: MarketplaceTaxSummary,
  filing: TaxReturnFiling,
): TaxReturnSectionFigure[] {
  const figuresLine = filing.form === 'tx-webfile' ? 'Webfile' : 'breakdown'
  return [
    {
      label: 'Purchases in period',
      value: String(Number(summary.transactionCount ?? 0)),
      note: 'Rows swept from marketplacePurchases.',
    },
    {
      label: 'Gross paid by buyers',
      value: `$${centsToDollars(summary.grossCents)}`,
      note: `Tax included, and mostly the publisher’s money — not ${PLATFORM_BRAND_NAME} revenue.`,
    },
    {
      label: 'Taxable base',
      value: `$${centsToDollars(summary.taxableSalesCents)}`,
      note: 'Gross less tax.',
    },
    {
      label: 'Tax charged',
      value: `$${centsToDollars(summary.taxChargedCents)}`,
      note: 'Added EXCLUSIVE on the platform’s own charge; the publisher’s transfer is computed pre-tax.',
    },
    {
      label: 'Tax refunded',
      value: `$${centsToDollars(summary.taxRefundedCents)}`,
      note: 'Pro rata against each row’s own gross. Never remitted.',
    },
    {
      label: 'Tax collected, net',
      value: `$${centsToDollars(summary.taxCollectedCents)}`,
      note: `The remittable figure — and it is in NO ${figuresLine} line above.`,
    },
    // WHERE THAT FIGURE IS OWED. The total above is the only number every
    // period can state, because rows recorded before the webhook stored a
    // jurisdiction have none and are not given one. These lines say how much
    // of it CAN be placed, and `unknown` says how much cannot — stated as its
    // own line rather than dropped, so the split always sums to the total.
    ...jurisdictionFigures(summary, filing.code),
  ]
}

/**
 * The marketplace's answer for one period, from rows already read. Pure, so
 * the section a preparer reads can be proved from fixtures.
 */
export function marketplaceTaxReturnAnswer(
  read: {
    rows: readonly MarketplaceTaxReturnRowInput[]
    truncated: boolean
    undatedRows: number
  },
  request: TaxReturnSourceRequest,
): TaxReturnSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { filing } = request
  const summary = marketplaceTaxSummary(read.rows, request)
  const figures = marketplaceTaxFigures(summary, filing)
  return {
    id: 'marketplace',
    name: 'Marketplace',
    title: 'Marketplace tax — plugin and theme purchases',
    help:
      'Tax on marketplace purchases. Charged on the platform’s own charge, kept platform-side, and in no filing line above.',
    // All of it is the platform's, and the total leads with the per-state
    // split following it, including the part that has no state.
    intro:
      `All of this tax is ${brand}’s: it is added on top of the ` +
      `listing price on ${brand}’s own charge, and the publisher’s ` +
      'transfer is computed from the pre-tax price. Each purchase ' +
      'records the jurisdiction Stripe computed its tax for, so ' +
      'the total below breaks down by state. Purchases recorded ' +
      'before that carry no jurisdiction and are counted as ' +
      'such rather than placed — read those in Stripe.',
    truncated: read.truncated,
    undatedRows: read.undatedRows,
    findings: marketplaceTaxFindings(summary, filing),
    filingLines: [],
    tables: [],
    figures,
    exports: [
      {
        placement: 'sections',
        rows: [
          [
            'Marketplace tax (AGL-2137) — NOT in ' +
              (filing.form === 'tx-webfile' ? 'the Webfile figures' : 'the breakdown above'),
          ],
          ['Figure', 'Amount', 'Note'],
          ...figures.map((line) => [line.label, line.value, line.note]),
        ],
      },
    ],
    summary,
    rows: read.rows.map(
      (row): MarketplaceTaxRow => ({
        id: row.id,
        sellerOrgId: typeof row.sellerOrgId === 'string' ? row.sellerOrgId : null,
        createdAt: asRowDate(row.createdAt)?.toISOString() ?? null,
        grossCents: Number(row.amountCents ?? 0),
        taxCents: Number(row.taxCents ?? 0),
        refundedCents: Number(row.refundedCents ?? 0),
      }),
    ),
  }
}

/**
 * The marketplace's source, registered on the console's API surface: the
 * staff return awaits that surface before it asks.
 *
 * The equality probe counts purchases a `createdAt` range can never match,
 * over all of them, and the platform blocks the return on any.
 */
export const marketplaceTaxReturnSource: TaxReturnSource = {
  async read(request) {
    const collection = firebaseAdmin.app().firestore().collection('marketplacePurchases')
    const [inPeriod, undated] = await Promise.all([
      collection
        .where('createdAt', '>=', request.start)
        .where('createdAt', '<', request.end)
        .limit(request.rowCap + 1)
        .get(),
      collection.where('createdAt', '==', null).count().get(),
    ])
    const rows: MarketplaceTaxReturnRowInput[] = inPeriod.docs
      .slice(0, request.rowCap)
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<MarketplaceTaxReturnRowInput, 'id'>),
      }))
    return marketplaceTaxReturnAnswer(
      {
        rows,
        truncated: inPeriod.size > request.rowCap,
        undatedRows: Number(undated.data().count ?? 0),
      },
      request,
    )
  },
}
