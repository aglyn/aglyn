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

import type {
  MarketplaceTaxSummary,
  StorefrontTaxSummary,
  TaxReturnSummary,
} from './server/tx-return'

/** The jurisdiction key the TX return is filed from. */
export const TX_JURISDICTION = 'US-TX'

/**
 * The filer's Texas registration identifiers — OPERATOR CONFIGURATION, never
 * source (AGL-2021).
 *
 * These used to be two literals in this file, and the comment that justified
 * them was wrong on the fact that mattered. It said they were "public
 * identifiers on the Comptroller's own correspondence — not secrets (the
 * Webfile *password* is not here and must never be)". There is no separate
 * Webfile password protecting the account.
 *
 * The Comptroller's eSystems "Add Webfile Access" flow calls the Webfile number
 * a "Personal Identification Code" and takes exactly three inputs to attach a
 * taxpayer account to a profile: the 11-digit taxpayer number, the Webfile
 * number, and agreement to the terms. No password, no mailed PIN, no prior
 * payment amount, no identity check. Anyone may create the profile.
 *
 * So the taxpayer number is the semi-public half (the Comptroller's own Sales
 * Taxpayer Search returns it) and the Webfile number is the authenticating
 * half. The pair is a credential — and this repository is public and
 * Apache-2.0. The old comment is why it looked safe to hardcode.
 *
 * They are also not ours to ship: a self-host operator's build must never
 * carry Aglyn LLC's filing identifiers, and their own belong to them.
 *
 * They therefore arrive on the PAYLOAD, from server-only env read in
 * `apps/console/app/api/admin/tax-return/route.ts` — deliberately NOT
 * `NEXT_PUBLIC_*`, which Next inlines into a client chunk that is served
 * unauthenticated. Reaching them requires the staff gate on that route.
 *
 * Absent is a first-class state. See `taxReturnRegistration`.
 */
export interface TaxReturnRegistration {
  webfileNumber: string | null
  taxpayerNumber: string | null
}

/**
 * What the working papers print where a registration number goes when the
 * deployment has not configured one.
 *
 * NOT an empty string, and NOT a placeholder that could be mistaken for a
 * number. This CSV is evidence someone files a return from; a blank cell reads
 * as "nobody filled it in yet" and a fake one reads as fact. Either can end up
 * transcribed onto a return signed under penalty of perjury, so the file says
 * what is actually true and names the fix.
 */
export const TX_REGISTRATION_UNSET =
  'NOT CONFIGURED — set TX_WEBFILE_NUMBER / TX_TAXPAYER_NUMBER'

/**
 * The registration as the surfaces should treat it: present only when it is
 * really present.
 *
 * A whitespace-only env var is the shape a half-finished `.env` actually takes,
 * and it would otherwise satisfy a truthiness check and print as a blank cell —
 * exactly the failure `TX_REGISTRATION_UNSET` exists to prevent. So it is
 * trimmed and treated as absent.
 */
export function taxReturnRegistration(
  payload: TaxReturnPayload | null,
): TaxReturnRegistration & { configured: boolean } {
  const clean = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length ? text : null
  }
  const webfileNumber = clean(payload?.registration?.webfileNumber)
  const taxpayerNumber = clean(payload?.registration?.taxpayerNumber)
  return {
    webfileNumber,
    taxpayerNumber,
    // BOTH, not either: a return filed with half a registration is not filable,
    // and a surface that reads "configured" on one number invites someone to
    // hunt the other one up by hand at the worst possible moment.
    configured: Boolean(webfileNumber && taxpayerNumber),
  }
}

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

/** One row of the storefront listing (AGL-1904). */
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

/**
 * The storefront half of the response (AGL-1904) — tax charged on MERCHANTS'
 * sales, which for a `mode: 'stripe'` store Stripe computes against AGLYN's
 * registrations because the Checkout Session is created on Aglyn's own
 * platform account. Optional so a payload from before AGL-1904 still reads.
 */
export interface StorefrontTaxSection {
  summary: StorefrontTaxSummary
  truncated: boolean
  undatedRows: number
  rows: StorefrontTaxRow[]
}

/** One row of the marketplace listing (AGL-2137). */
export interface MarketplaceTaxRow {
  id: string
  sellerOrgId: string | null
  createdAt: string | null
  grossCents: number
  taxCents: number
  refundedCents: number
}

/**
 * The marketplace half of the response (AGL-2137) — the THIRD bucket. Kept
 * apart from Aglyn's own invoices and from merchant storefronts because a
 * marketplace row's gross is mostly the PUBLISHER's money, while the tax on
 * it is charged `exclusive` on the PLATFORM's own charge and stays
 * platform-side. Optional so a payload from before AGL-2137 still reads.
 */
export interface MarketplaceTaxSection {
  summary: MarketplaceTaxSummary
  truncated: boolean
  rows: MarketplaceTaxRow[]
}

/** The `/api/admin/tax-return` response. */
export interface TaxReturnPayload {
  period: string
  summary: TaxReturnSummary
  truncated: boolean
  undatedRows: number
  rows: TaxReturnRow[]
  /** AGL-1904. Absent on a payload predating it. */
  storefront?: StorefrontTaxSection | null
  /** AGL-2137. Absent on a payload predating it. */
  marketplace?: MarketplaceTaxSection | null
  /**
   * AGL-2021. The filer's Texas registration, from server-only env on the
   * route. Optional because an unconfigured deployment is a legitimate state,
   * not an error — read it through `taxReturnRegistration`.
   */
  registration?: TaxReturnRegistration | null
}

/**
 * Texas storefront tax that Stripe computed against AGLYN's registrations.
 *
 * The one figure that decides whether this period can be filed from the
 * Webfile lines alone: it is money sitting in Aglyn's balance under Aglyn's
 * Texas registration, and it is NOT in `summary`, which sums Aglyn's own
 * sales only. Deliberately excludes `merchantManual` — a merchant's own
 * configured rate never touched Aglyn's registrations.
 */
export function storefrontTexasAglynLiableCents(
  payload: TaxReturnPayload | null,
): number {
  const bucket = payload?.storefront?.summary?.aglynLiable
  const texas = bucket?.byJurisdiction?.[TX_JURISDICTION]
  const cents = Number(texas?.taxCollectedCents ?? 0)
  return Number.isFinite(cents) ? cents : 0
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
      // AGL-1904, and BLOCKING on purpose. Every storefront checkout is
      // created on Aglyn's own platform account, so a `mode: 'stripe'`
      // store's shopper is charged tax Stripe computes against AGLYN's
      // registrations — measured, not inferred. That money is in Aglyn's
      // balance and is NOT in the Webfile lines below, which sum Aglyn's own
      // sales only. Filing those lines without deciding what to do with this
      // figure is exactly the shortfall an auditor finds.
      //
      // It states the mechanics and asks for a decision. It does NOT assert a
      // marketplace-facilitator position — that attaches by operation of law
      // and belongs to counsel, not to this report.
      id: 'storefrontAglynLiableTax',
      severity: 'blocking',
      count: storefrontTexasAglynLiableCents(payload),
      label: 'Texas storefront tax collected under Aglyn’s registration',
      detail:
        'Cents. Charged to shoppers on merchants’ storefront sales, computed ' +
        'by Stripe Tax against AGLYN’s registrations (the session is created ' +
        'on Aglyn’s platform account), and settled into Aglyn’s balance. It ' +
        'is NOT included in Items 1–3 below. Decide with counsel how it is ' +
        'reported before filing — do not file as if it were zero.',
    },
    {
      id: 'storefrontUnclassified',
      severity: 'blocking',
      count: Number(
        payload.storefront?.summary?.attention?.rowsUnclassified ?? 0,
      ),
      label: 'Storefront rows with an unrecognised tax mode',
      detail:
        'Not counted in any storefront bucket, so they are in no figure at ' +
        'all. Classify them before filing.',
    },
    {
      id: 'storefrontMissingTaxableBase',
      severity: 'review',
      count: Number(
        payload.storefront?.summary?.attention?.rowsMissingTaxableBase ?? 0,
      ),
      label: 'Storefront rows with tax but no stated base',
      detail:
        'Tax was collected but Stripe’s taxable_amount could not be read, so ' +
        'the storefront taxable-sales figure understates the base. Re-read ' +
        'the session in Stripe with the tax breakdown expanded.',
    },
    {
      // AGL-2137, BLOCKING for the same reason the storefront figure is, and
      // more directly: marketplace checkout adds Stripe Tax `exclusive` on
      // the PLATFORM's own charge and the publisher's transfer is computed
      // from the PRE-tax price, so the whole of this tax stays in Aglyn's
      // balance. It is in no Webfile line below.
      //
      // Stated as the platform total rather than a Texas slice on purpose:
      // `marketplacePurchases` stores no buyer address, so no jurisdiction
      // can be claimed for any of it (see `rowsMissingJurisdiction`). A
      // "Texas marketplace tax" figure would be a guess wearing a total's
      // clothes, and this report does not print those.
      id: 'marketplaceTaxCollected',
      severity: 'blocking',
      count: Number(payload.marketplace?.summary?.taxCollectedCents ?? 0),
      label: 'Marketplace tax collected under Aglyn’s registration',
      detail:
        'Cents, net of refunds. Charged on marketplace purchases as an ' +
        'EXCLUSIVE addition to the platform’s own charge, so none of it went ' +
        'to the publisher and all of it is in Aglyn’s balance. It is NOT in ' +
        'Items 1–3 below. Decide with counsel how it is reported before ' +
        'filing — do not file as if it were zero.',
    },
    {
      id: 'marketplaceTruncated',
      severity: 'blocking',
      count: payload.marketplace?.truncated ? 1 : 0,
      label: 'Marketplace rows exceeded the row cap',
      detail:
        'The marketplace figures are a LOWER BOUND — purchases past the cap ' +
        'were not summed. Narrow the period, or raise ROW_CAP in the route.',
    },
    {
      id: 'marketplaceOverRefunded',
      severity: 'blocking',
      count: Number(
        payload.marketplace?.summary?.attention?.rowsOverRefunded ?? 0,
      ),
      label: 'Marketplace rows refunded past their own charge',
      detail:
        'A refund larger than the charge is a data fault. The refunded tax ' +
        'is clamped so the figure is never netted below zero — which means ' +
        'these rows may OVERSTATE what was given back. Read them in Stripe.',
    },
    {
      id: 'marketplaceMissingJurisdiction',
      severity: 'review',
      count: Number(
        payload.marketplace?.summary?.attention?.rowsMissingJurisdiction ?? 0,
      ),
      label: 'Marketplace rows with no stated jurisdiction',
      detail:
        'No buyer address is stored on a purchase row, so none of this tax ' +
        'can be placed in a state — expect this to equal the marketplace ' +
        'transaction count until purchase rows record an address. It is why ' +
        'no marketplace figure appears on the jurisdiction table.',
    },
    {
      id: 'marketplaceMissingCreatedAt',
      severity: 'review',
      count: Number(
        payload.marketplace?.summary?.attention?.rowsMissingCreatedAt ?? 0,
      ),
      label: 'Marketplace rows with no readable date',
      detail:
        'Period assignment fell back to the query bounds, so these purchases ' +
        'may belong to a neighbouring period.',
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
    {
      // AGL-1904. Stated as its own line rather than folded into Item 1 or 2:
      // this report does not decide how storefront receipts are reported, and
      // adding them to a Webfile item would be deciding it silently.
      item: '—',
      label: 'Texas storefront tax under Aglyn’s registration (NOT in Items 1–3)',
      dollars: payload
        ? centsToDollars(storefrontTexasAglynLiableCents(payload))
        : null,
      note:
        'Collected from shoppers on merchants’ sales and held in Aglyn’s ' +
        'balance. Excluded from every item above. Its treatment on the ' +
        'return is a question for counsel — see AGL-1904.',
    },
    {
      item: '—',
      label: 'Texas storefront tax under the MERCHANT’s own rate (not Aglyn’s)',
      dollars: payload
        ? centsToDollars(
            payload.storefront?.summary?.merchantManual?.byJurisdiction?.[
              TX_JURISDICTION
            ]?.taxCollectedCents ?? 0,
          )
        : null,
      note:
        'A manual-mode store’s own configured rate. Aglyn’s registrations ' +
        'played no part in computing it. Shown so it is visibly NOT the line ' +
        'above — the two must never be added together.',
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
 * THE THREE BUCKETS, as rows to render (AGL-2163).
 *
 * `/api/admin/tax-return` computes three separate sets of figures and the
 * screen showed one — the storefront bucket (AGL-1904) reached the page only
 * as an attention count and two Webfile footnotes, and the marketplace bucket
 * (AGL-2137) did not reach it at all. Two of the three buckets a human files
 * this return from existed only in a JSON response nobody sees, which is the
 * same "reachable only by curling a route is not shipped" rule this page was
 * raised under.
 *
 * NO GRAND TOTAL, ever, and that is the whole reason these are three tables
 * and not one. `aglynLiable` is money Aglyn holds under Aglyn's own
 * registrations; `merchantManual` is a merchant's own configured rate that
 * never touched them; marketplace tax is a third thing again. A reader who
 * adds them has made precisely the mistake the response shape exists to
 * prevent, so nothing here offers a column that invites it.
 */
export interface TaxBucketRow {
  id: string
  label: string
  /** Who owes it — the sentence that decides whether it is on this return. */
  liability: string
  transactionCount: number
  grossDollars: string
  taxableSalesDollars: string
  taxCollectedDollars: string
  /** True when this row is money in Aglyn's balance under its registration. */
  aglynLiable: boolean
}

/** The storefront section's three liability buckets (AGL-1904). */
export function taxReturnStorefrontRows(
  payload: TaxReturnPayload | null,
): TaxBucketRow[] {
  const summary = payload?.storefront?.summary
  if (!summary) return []
  const buckets: Array<{
    id: keyof Pick<
      StorefrontTaxSummary,
      'aglynLiable' | 'merchantManual' | 'connectedAccountLiable'
    >
    label: string
    liability: string
    aglynLiable: boolean
  }> = [
    {
      id: 'aglynLiable',
      label: 'Computed against Aglyn’s registrations',
      liability:
        'In Aglyn’s balance. Stripe Tax computed it on Aglyn’s platform account.',
      aglynLiable: true,
    },
    {
      id: 'merchantManual',
      label: 'Merchant’s own configured rate',
      liability:
        'The merchant’s. It never touched an Aglyn registration and is not Aglyn’s to remit.',
      aglynLiable: false,
    },
    {
      id: 'connectedAccountLiable',
      label: 'Stripe Tax named the connected account liable',
      liability: 'The connected account’s. Empty today.',
      aglynLiable: false,
    },
  ]
  return buckets.map((bucket) => {
    const figures = summary[bucket.id]
    return {
      id: bucket.id,
      label: bucket.label,
      liability: bucket.liability,
      transactionCount: Number(figures?.transactionCount ?? 0),
      grossDollars: centsToDollars(figures?.grossCents),
      taxableSalesDollars: centsToDollars(figures?.taxableSalesCents),
      taxCollectedDollars: centsToDollars(figures?.taxCollectedCents),
      aglynLiable: bucket.aglynLiable,
    }
  })
}

/** One label/value line of the marketplace figures (AGL-2137). */
export interface TaxFigureLine {
  label: string
  value: string
  note: string
}

/**
 * The marketplace bucket's figures (AGL-2137).
 *
 * Charged and refunded are stated ALONGSIDE the net, never folded into it:
 * "we charged X and gave back Y" is the sentence a return needs, and a single
 * number that could be either is what this shape refuses to print.
 */
export function taxReturnMarketplaceLines(
  payload: TaxReturnPayload | null,
): TaxFigureLine[] {
  const summary = payload?.marketplace?.summary
  if (!summary) return []
  return [
    {
      label: 'Purchases in period',
      value: String(Number(summary.transactionCount ?? 0)),
      note: 'Rows swept from marketplacePurchases.',
    },
    {
      label: 'Gross paid by buyers',
      value: `$${centsToDollars(summary.grossCents)}`,
      note: 'Tax included, and mostly the publisher’s money — not Aglyn revenue.',
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
      note: 'The remittable figure — and it is in NO Webfile line above.',
    },
  ]
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
  const registration = taxReturnRegistration(payload)
  const lines: string[][] = [
    ['Aglyn — Texas sales tax return working papers'],
    ['Period', payload.period ?? ''],
    ['Period start (UTC)', payload.summary?.periodStart ?? ''],
    ['Period end (UTC, exclusive)', payload.summary?.periodEnd ?? ''],
    // AGL-2021: from the payload, and honestly absent when unconfigured —
    // never a blank cell, never a placeholder that reads as a real number.
    ['Taxpayer number', registration.taxpayerNumber ?? TX_REGISTRATION_UNSET],
    ['Webfile number', registration.webfileNumber ?? TX_REGISTRATION_UNSET],
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
    ['Storefront commerce tax by liability (AGL-1904) — NOT in the Webfile figures'],
    [
      'Bucket',
      'Who owes it',
      'Transactions',
      'Gross (USD)',
      'Taxable sales (USD)',
      'Tax collected (USD)',
    ],
    ...(taxReturnStorefrontRows(payload).length
      ? taxReturnStorefrontRows(payload).map((row) => [
          row.label,
          row.liability,
          String(row.transactionCount),
          row.grossDollars,
          row.taxableSalesDollars,
          row.taxCollectedDollars,
        ])
      : [['—', 'No storefront figures in this payload', '0', '', '', '']]),
    [],
    ['Marketplace tax (AGL-2137) — NOT in the Webfile figures'],
    ['Figure', 'Amount', 'Note'],
    ...(taxReturnMarketplaceLines(payload).length
      ? taxReturnMarketplaceLines(payload).map((line) => [
          line.label,
          line.value,
          line.note,
        ])
      : [['—', 'No marketplace figures in this payload', '']]),
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
