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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import type { TaxReturnSectionTable } from '@aglyn/aglyn/plugin-manager/plugin-tax-return-sources'
import { taxRegistrationSetupHint } from './tax-jurisdictions'
import {
  centsToDollars,
  taxReturnAttention,
  taxReturnFilingJurisdiction,
  taxReturnFilingLines,
  taxReturnFindingGroups,
  taxReturnJurisdictionRows,
  taxReturnOwnSalesBreakdown,
  taxReturnPeriodOptions,
  taxReturnRegistration,
  type TaxReturnAttentionVerdict,
  type TaxReturnPayload,
} from './tx-return-webfile'

/*
 * THE SALES TAX RETURN, PREPARED FOR A CLIENT THAT DRAWS NO HTML (AGL-3667).
 *
 * `/admin/tax-return` derives everything it prints from the payload
 * `/api/admin/tax-return` answers: the verdict, the registration, the filing
 * lines, the jurisdiction rows, the sources' tables. Those derivations are
 * pure functions in `tx-return-webfile.ts`, and the words that go with them
 * were inline in the page. The native apps read the same page through this
 * view: the route runs the same functions over the same payload and sends
 * the figures as the lines the page prints, so there is one place a figure
 * or a sentence on the return is decided.
 *
 * The sentences that are not data live here (`TAX_RETURN_COPY`) and the page
 * imports them, so a reworded warning cannot read one way on the web and
 * another in the app.
 */

/** Sentences the return prints around its figures. The page and the apps print these. */
export const TAX_RETURN_COPY = {
  cleanTitle: 'Every row read cleanly',
  cleanMessage: (invoices: number) =>
    invoices === 0
      ? 'There are no invoices in this period, so no invoice row was read or dropped.'
      : invoices === 1
        ? 'The one invoice in this period was fully readable — no row was dropped, and no figure below is a lower bound.'
        : `All ${invoices} invoices in this period were fully readable — no row was dropped, and no figure below is a lower bound.`,
  blockingTitle: (total: number) => `Do not file — ${total} ${total === 1 ? 'row needs' : 'rows need'} attention`,
  reviewTitle: (total: number) => `${total} ${total === 1 ? 'row needs' : 'rows need'} attention before filing`,
  breakdownTitle: (code: string) => `A breakdown for manual filing — not a ${code} return`,
  breakdownText:
    'These are the figures a return is assembled from: what was collected in this jurisdiction, and on what base. ' +
    'No form for this jurisdiction is known here, so nothing below is a form line — transcribe them onto the return ' +
    'the authority asks for.',
  blockedNote: (webfile: boolean) =>
    'These figures are incomplete — see the findings above. ' +
    (webfile ? 'Do not type them into Webfile.' : 'Do not file from them.'),
  refundsNote:
    'Stated, not netted. A row keeps only its latest refund stamp, so two refunds in different quarters cannot be ' +
    'split apart from the row — applying these to the return is a judgment, not a computation.',
  boundsNote:
    'The exact window swept, echoed so a filed return can be reproduced from the same bounds later.',
  ownSalesIntro: (filingName: string) =>
    `${PLATFORM_BRAND_NAME}’s own subscription and add-on revenue, by the customer’s state. ` +
    `${filingName} is the return; the other rows are the record of why the rest of the period is not on it. ` +
    'For nexus from MERCHANTS’ sales, read “Facilitated sales by buyer state” above — a different taxpayer’s money, ' +
    'and never summed with this.',
  ownSalesFootnote:
    `“Excluded (internal)” is ${PLATFORM_BRAND_NAME}’s own purchases (AGL-1582) — marked at checkout, kept out of every other column ` +
    'here and out of the filing figures above, because a purchase the platform made from itself is not a sale to a ' +
    'state. It is stated rather than subtracted quietly so the figures can be checked. The mark is written when the ' +
    'purchase is made and cannot be added afterwards.',
  breakdownHeader: (webfile: boolean) =>
    webfile ? 'Items 1–2 by source and state' : 'The figures by source and jurisdiction',
  breakdownIntro: (code: string) =>
    `The filing figures add ${PLATFORM_BRAND_NAME}’s own sales outside its invoices — the card reader shop and ` +
    `${PLATFORM_BRAND_NAME}’s own stores — to the invoices. The rows marked “In the figures” are ${code}, and ` +
    'they add up to the figures exactly; the rest are the same sales elsewhere, for checking.',
  breakdownEmpty: 'Nothing was sold in this period.',
  breakdownFootnote:
    'Each sale is counted once, under one source. A sale is in the period it was paid; a refund is in the period it ' +
    'was made, stated here and never netted from the figures. Test-mode sales are in no row. A merchant’s own store ' +
    'is never here: its sales are on the storefront card below.',
  sourceRefused: (reason: string) =>
    `${reason} None of its sales are in any figure on this page. Do not file from this.`,
  sourceTruncated: (name: string) =>
    `${name} rows exceeded the row cap — these figures are a lower bound.`,
} as const

/** What was taken out of the counts to reach them, said where the verdict is. */
export function taxReturnExcludedNote(payload: TaxReturnPayload | null): string | null {
  const internal = Number(payload?.summary?.internal?.transactionCount ?? 0)
  const beforeObligation = Number(payload?.summary?.attention?.untaxedRowsBeforeObligation ?? 0)
  const parts: string[] = []
  if (internal) {
    parts.push(
      `${internal} ${internal === 1 ? 'row is' : 'rows are'} ${PLATFORM_BRAND_NAME}’s own purchases and are excluded from every ` +
        'figure below',
    )
  }
  if (beforeObligation) {
    parts.push(
      `${beforeObligation} untaxed ${beforeObligation === 1 ? 'row was' : 'rows were'} paid before the obligation ` +
        'began, so nothing was under-collected on them',
    )
  }
  if (!parts.length) return null
  return `${parts.join('; ')}. Both are listed on the findings card below.`
}

/** The verdict's headline, from its counts. */
export function taxReturnVerdictTitle(verdict: TaxReturnAttentionVerdict): string {
  if (verdict.clean) return TAX_RETURN_COPY.cleanTitle
  return verdict.blocking ? TAX_RETURN_COPY.blockingTitle(verdict.total) : TAX_RETURN_COPY.reviewTitle(verdict.total)
}

const money = (dollars: string | null | undefined) => `$${dollars ?? '0.00'}`

/** A source's table row as one line of text: the first cell leads, the rest follow as `Column: value`. */
function sourceRow(table: TaxReturnSectionTable, row: TaxReturnSectionTable['rows'][number]) {
  const [lead, ...rest] = row.cells
  return {
    key: row.key,
    title: lead?.text ?? '',
    tag: lead?.tag?.label ?? '',
    tagTone: lead?.tag?.tone === 'attention' ? 'warning' : 'neutral',
    caption: lead?.caption ?? '',
    detail: rest
      .map((cell, index) => {
        const label = table.columns[index + 1]?.label
        return label ? `${label}: ${cell.text}` : cell.text
      })
      .join(' · '),
  }
}

export interface TaxReturnView {
  period: string
  defaultPeriod: string
  periods: Array<{ value: string; label: string }>
  title: string
  jurisdiction: { code: string; label: string; recognized: boolean; form: string }
  registration: { configured: boolean; lines: string[]; hint: string }
  verdict: {
    state: 'clean' | 'review' | 'blocking'
    title: string
    message: string
    items: Array<{ id: string; severity: string; count: number; label: string; detail: string }>
    excludedNote: string
  }
  findings: Array<{ id: string; label: string; severity: string; count: number; detail: string }>
  /** Each finding's name by its id, for a row that carries only the ids. */
  findingLabels: Record<string, string>
  figures: {
    header: string
    banner: { title: string; text: string } | null
    blocked: boolean
    blockedNote: string
    lines: Array<{ item: string; label: string; note: string; value: string; entered: boolean }>
    /**
     * What the figures are made of (AGL-4038): the invoices and the
     * operator's own sales outside them, one line per source and
     * jurisdiction, the filing jurisdiction's first.
     */
    breakdown: {
      header: string
      intro: string
      footnote: string
      empty: string
      rows: Array<{
        key: string
        source: string
        jurisdiction: string
        inFigures: boolean
        sales: string
        totalSales: string
        taxableSales: string
        taxCollected: string
        refunded: string
      }>
    }
  }
  purchases: { applies: boolean; period: string }
  refunds: { note: string; lines: Array<{ label: string; value: string }> }
  bounds: { note: string; lines: Array<{ label: string; value: string }> }
  sources: Array<{
    id: string
    title: string
    refused: boolean
    error: string
    intro: string
    truncated: string
    tables: Array<{
      heading: string
      description: string
      empty: string
      footnote: string
      rows: Array<ReturnType<typeof sourceRow>>
    }>
    figures: Array<{ label: string; value: string; note: string }>
  }>
  ownSales: {
    intro: string
    footnote: string
    rows: Array<{
      jurisdiction: string
      onReturn: boolean
      noAddress: boolean
      internalOnly: boolean
      invoices: number
      total: string
      taxable: string
      tax: string
      reasons: string
      rates: string
      excluded: string
    }>
  }
}

/**
 * The page's own derivations over one wire-shaped payload. `now` and `floor`
 * decide the period menu and its default, as the page does.
 */
export function taxReturnView(payload: TaxReturnPayload, options: { now: Date; floor: string; defaultPeriod: string }): TaxReturnView {
  const filing = taxReturnFilingJurisdiction(payload)
  const registration = taxReturnRegistration(payload)
  const verdict = taxReturnAttention(payload)
  const lines = taxReturnFilingLines(payload)
  const refunds = payload.summary?.refunds
  const findingGroups = taxReturnFindingGroups(payload)
  const sources = Array.isArray(payload.sources) ? payload.sources : []
  return {
    period: payload.period,
    defaultPeriod: options.defaultPeriod,
    periods: taxReturnPeriodOptions(options.now, options.floor).map(({ value, label }) => ({ value, label })),
    title: `${filing.label} Sales Tax Return`,
    jurisdiction: { code: filing.code, label: filing.label, recognized: filing.recognized, form: filing.form },
    registration: {
      configured: registration.configured,
      lines: registration.configured
        ? [
            `${filing.registrationIdLabel} ${registration.registrationId}`,
            ...(registration.filingId ? [`${filing.filingIdLabel} ${registration.filingId}`] : []),
          ]
        : [],
      hint: registration.configured ? '' : taxRegistrationSetupHint(filing),
    },
    verdict: {
      state: verdict.clean ? 'clean' : verdict.blocking ? 'blocking' : 'review',
      title: taxReturnVerdictTitle(verdict),
      message: verdict.clean ? TAX_RETURN_COPY.cleanMessage(Number(payload.summary?.transactionCount ?? 0)) : '',
      items: verdict.items.map(({ id, severity, count, label, detail }) => ({ id, severity, count, label, detail })),
      excludedNote: taxReturnExcludedNote(payload) ?? '',
    },
    findings: findingGroups.map(({ id, label, severity, count, detail }) => ({ id, label, severity, count, detail })),
    findingLabels: Object.fromEntries(findingGroups.map((group) => [group.id, group.label])),
    figures: {
      header: filing.figuresHeader,
      banner:
        filing.form !== 'tx-webfile'
          ? { title: TAX_RETURN_COPY.breakdownTitle(filing.code), text: TAX_RETURN_COPY.breakdownText }
          : null,
      blocked: verdict.blocking > 0,
      blockedNote: verdict.blocking > 0 ? TAX_RETURN_COPY.blockedNote(filing.form === 'tx-webfile') : '',
      lines: lines.map((line) => ({
        item: line.item,
        label: line.label,
        note: line.note,
        value: line.dollars === null ? 'not computed' : line.dollars,
        entered: line.entered === true,
      })),
      breakdown: {
        header: TAX_RETURN_COPY.breakdownHeader(filing.form === 'tx-webfile'),
        intro: TAX_RETURN_COPY.breakdownIntro(filing.code),
        footnote: TAX_RETURN_COPY.breakdownFootnote,
        empty: TAX_RETURN_COPY.breakdownEmpty,
        rows: taxReturnOwnSalesBreakdown(payload).map((row) => ({
          key: row.key,
          source: row.source,
          jurisdiction: row.jurisdiction === 'unknown' ? 'Not stated' : row.jurisdiction,
          inFigures: row.inFigures,
          sales: String(row.transactionCount),
          totalSales: money(row.totalSalesDollars),
          taxableSales: money(row.taxableSalesDollars),
          taxCollected: money(row.taxCollectedDollars),
          refunded: row.refundedSalesDollars === null ? 'On the refunds card' : money(row.refundedSalesDollars),
        })),
      },
    },
    purchases: { applies: filing.form === 'tx-webfile', period: payload.period },
    refunds: {
      note: TAX_RETURN_COPY.refundsNote,
      lines: [
        { label: 'Rows refunded', value: String(refunds?.rowsRefundedInPeriod ?? 0) },
        { label: 'Refunded gross', value: money(centsToDollars(refunds?.refundedGrossCents)) },
        { label: 'Estimated refunded tax', value: money(centsToDollars(refunds?.estimatedRefundedTaxCents)) },
      ],
    },
    bounds: {
      note: TAX_RETURN_COPY.boundsNote,
      lines: [
        { label: 'From (UTC)', value: String(payload.summary?.periodStart ?? '—') },
        { label: 'To (UTC, exclusive)', value: String(payload.summary?.periodEnd ?? '—') },
        { label: 'Invoices swept', value: String(payload.summary?.transactionCount ?? 0) },
      ],
    },
    sources: sources.map((section) =>
      section.outcome === 'answered'
        ? {
            id: `${section.pluginId}:${section.id}`,
            title: section.title,
            refused: false,
            error: '',
            intro: section.intro ?? '',
            truncated: section.truncated ? TAX_RETURN_COPY.sourceTruncated(section.name) : '',
            tables: section.tables.map((table) => ({
              heading: table.heading ?? '',
              description: table.description ?? '',
              empty: table.empty,
              footnote: table.footnote ?? '',
              rows: table.rows.map((row) => sourceRow(table, row)),
            })),
            figures: section.figures.map(({ label, value, note }) => ({ label, value, note })),
          }
        : {
            id: `${section.pluginId}:${section.id}`,
            title: `Sales from the “${section.pluginId}” plugin`,
            refused: true,
            error: TAX_RETURN_COPY.sourceRefused(section.reason),
            intro: '',
            truncated: '',
            tables: [],
            figures: [],
          },
    ),
    ownSales: {
      intro: TAX_RETURN_COPY.ownSalesIntro(filing.code),
      footnote: TAX_RETURN_COPY.ownSalesFootnote,
      rows: taxReturnJurisdictionRows(payload).map((row) => ({
        jurisdiction: row.jurisdiction,
        onReturn: row.isFilingJurisdiction,
        noAddress: row.jurisdiction === 'unknown',
        internalOnly: row.internalOnly,
        invoices: row.transactionCount,
        total: money(row.totalSalesDollars),
        taxable: money(row.taxableSalesDollars),
        tax: money(row.taxCollectedDollars),
        reasons: row.taxabilityReasons
          .map((paper) => `${paper.label}: ${money(paper.taxCollectedDollars)} on ${money(paper.taxableSalesDollars)}`)
          .join(' · '),
        rates: row.rates.map((rate) => `${rate.label} — ${money(rate.taxCollectedDollars)}`).join(' · '),
        excluded: row.internalTransactionCount
          ? `${money(row.internalTotalSalesDollars)} (${row.internalTransactionCount} ${
              row.internalTransactionCount === 1 ? 'invoice' : 'invoices'
            }, ${money(row.internalTaxCollectedDollars)} tax)`
          : '',
      })),
    },
  }
}
