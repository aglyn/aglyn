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
 * The return, as a person sits down to file it (AGL-1900).
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
 *   2. **The filing figures**, in dollars, for the CONFIGURED jurisdiction
 *      alone. The return reports that jurisdiction's receipts; the others are
 *      the audit trail for why the rest of the quarter is not on it.
 *   3. **The working papers**, as CSV — every row behind those totals, so
 *      any figure can be walked back to an invoice id in Stripe.
 *
 * ## One exporter, selected by jurisdiction
 *
 * Texas gets the Webfile lines, in Form 01-114's own order and wording,
 * because that form is known here. Every other jurisdiction gets a BREAKDOWN:
 * period, gross, taxable base and tax collected for the configured
 * jurisdiction, with the by-region tables that any authority's return is
 * assembled from — labeled as raw material for a return, never as one. The
 * platform knows what it collected and where; it does not know the form.
 *
 * Handing a self-host operator in another jurisdiction a Texas Comptroller CSV
 * was the failure that split these apart: the figures were right and the
 * document was for an authority they have never registered with.
 *
 * Pure: no fetch, no clock (the caller passes `now`), no DOM. The page
 * renders what it returns; the spec feeds it fixtures.
 */

import type {
  MarketplaceTaxSummary,
  StorefrontTaxSummary,
  TaxReturnRowFinding,
  TaxReturnSummary,
} from './server/tx-return'
import type { TaxablePurchasesEntry } from './taxable-purchases'
import {
  TAX_REGISTRATION_UNSET,
  taxFilingIdUnsetNote,
  taxFilingJurisdiction,
  TX_JURISDICTION,
  type TaxFilingJurisdiction,
} from './tax-jurisdictions'

export { TAX_REGISTRATION_UNSET, TX_JURISDICTION }

/**
 * The filer's registration identifiers — OPERATOR CONFIGURATION, never
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
  /**
   * Where this deployment files, as a `summary.byJurisdiction` key. Absent on
   * a payload predating the setting, which means Texas — see
   * `DEFAULT_TAX_JURISDICTION`.
   */
  jurisdiction?: string | null
  /** The number the authority knows the filer by. */
  registrationId?: string | null
  /** The filing-portal credential, where the jurisdiction issues one. */
  filingId?: string | null
  /**
   * The Texas-named fields this pair used to arrive on. Read as a fallback so
   * a response cached by a client chunk from before the rename still shows a
   * registration rather than reporting one that is set as missing.
   *
   * @deprecated Read `registrationId` / `filingId`.
   */
  webfileNumber?: string | null
  taxpayerNumber?: string | null
}

/** The registration, with the jurisdiction it belongs to resolved. */
export interface ResolvedTaxRegistration {
  jurisdiction: TaxFilingJurisdiction
  registrationId: string | null
  filingId: string | null
  configured: boolean
}

/**
 * The registration as the surfaces should treat it: present only when it is
 * really present.
 *
 * A whitespace-only env var is the shape a half-finished `.env` actually takes,
 * and it would otherwise satisfy a truthiness check and print as a blank cell —
 * exactly the failure `TAX_REGISTRATION_UNSET` exists to prevent. So it is
 * trimmed and treated as absent.
 */
export function taxReturnRegistration(
  payload: TaxReturnPayload | null,
): ResolvedTaxRegistration {
  const clean = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value.trim() : ''
    return text.length ? text : null
  }
  const stored = payload?.registration
  const jurisdiction = taxFilingJurisdiction(stored?.jurisdiction)
  const registrationId =
    clean(stored?.registrationId) ?? clean(stored?.taxpayerNumber)
  const filingId = clean(stored?.filingId) ?? clean(stored?.webfileNumber)
  return {
    jurisdiction,
    registrationId,
    filingId,
    // Where the jurisdiction authenticates filing with a second identifier it
    // is BOTH, not either: a return filed with half a registration is not
    // filable, and a surface that reads "configured" on one number invites
    // someone to hunt the other one up by hand at the worst possible moment.
    // Where no such identifier exists, requiring one would leave a correctly
    // configured deployment reading "not configured" forever.
    configured: Boolean(
      registrationId && (filingId || !jurisdiction.filingIdRequired),
    ),
  }
}

/** The jurisdiction this payload's figures are being filed for. */
export function taxReturnFilingJurisdiction(
  payload: TaxReturnPayload | null,
): TaxFilingJurisdiction {
  return taxFilingJurisdiction(payload?.registration?.jurisdiction)
}

/**
 * First taxable sales date on this software's own registration — the floor
 * that stands until an operator configures their own in Platform settings.
 *
 * Kept as `{ year, quarter }` because that is what the fallback in
 * `defaultTaxReturnPeriod` needs; the month half lives in
 * `DEFAULT_FIRST_TAXABLE_PERIOD`, which is `2026-09` rather than `2026-Q3`
 * because Aglyn collected nothing in July or August of that quarter.
 */
export const TX_FIRST_TAXABLE_PERIOD = { year: 2026, quarter: 3 }

/** The floor a period menu is built from, as year plus zero-based month. */
interface TaxablePeriodFloor {
  year: number
  monthIndex: number
}

/**
 * Parse a configured first taxable period into a menu floor.
 *
 * Accepts both shapes the return route accepts. A quarter floors at its FIRST
 * month, a month at itself — so `2026-Q3` offers July onward and `2026-09`
 * offers September onward, which is the difference between a menu that offers
 * two months of nothing and one that does not.
 *
 * Anything unparseable falls back to the built-in floor rather than throwing:
 * this runs while a page is painting, and a menu that renders the wrong floor
 * is recoverable where one that renders nothing is not.
 */
function taxablePeriodFloor(period?: string | null): TaxablePeriodFloor {
  const raw = String(period ?? '').trim().toUpperCase()
  const quarter = /^(\d{4})-Q([1-4])$/.exec(raw)
  if (quarter) {
    return {
      year: Number(quarter[1]),
      monthIndex: (Number(quarter[2]) - 1) * 3,
    }
  }
  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(raw)
  if (month) {
    return { year: Number(month[1]), monthIndex: Number(month[2]) - 1 }
  }
  return {
    year: TX_FIRST_TAXABLE_PERIOD.year,
    // September 2026 — see DEFAULT_FIRST_TAXABLE_PERIOD.
    monthIndex: (TX_FIRST_TAXABLE_PERIOD.quarter - 1) * 3 + 2,
  }
}

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
  /**
   * `null` where the field was never written — which is NOT the explicit
   * `false` the untaxed finding is about. It projected as a plain boolean
   * until the findings arrived, so an unwritten field read as "billed without
   * automatic tax" to anything that filtered on it.
   */
  automaticTax: boolean | null
  refundedCents: number
  /**
   * Aglyn's own purchase rather than a customer's (AGL-1582), and therefore
   * not a sale on this return. Absent on a payload predating the exclusion.
   */
  internalTraffic?: boolean
  /**
   * Which of the summary's per-row counts this row is in, stamped by the same
   * predicate that did the counting.
   *
   * Optional because a response cached from before this existed carries none —
   * and the surfaces must read that as "this response cannot name its rows"
   * rather than as "there are no rows", which would be a false clean on a
   * finding about money owed to a state.
   */
  findings?: TaxReturnRowFinding[]
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
  /**
   * The rows behind `undatedRows` — in no period query, so in no other list
   * on this payload. Optional: a response predating them carries the count
   * alone, which is the state this whole section exists to leave behind.
   */
  undated?: { rows: TaxReturnRow[] } | null
  /**
   * Item 3, as somebody entered it for THIS period, or absent.
   *
   * Absent means `not computed` and must keep meaning that. The figure is use
   * tax on Aglyn's own purchases, which is not in `platformRevenue` and never
   * will be; storing an operator's entry records what was filed and why, and
   * changes nothing about what an unentered period reports.
   */
  taxablePurchases?: TaxablePurchasesEntry | null
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
 * Storefront tax in the FILING jurisdiction that Stripe computed against the
 * platform's own registrations.
 *
 * The one figure that decides whether this period can be filed from the filing
 * lines alone: it is money sitting in the platform's balance under the
 * platform's registration, and it is NOT in `summary`, which sums the
 * platform's own sales only. Deliberately excludes `merchantManual` — a
 * merchant's own configured rate never touched those registrations.
 *
 * Read against the configured jurisdiction rather than Texas, because a
 * hard-coded key answers `0.00` everywhere else — and a zero here is read as
 * "nothing to decide" on the one finding that blocks filing.
 */
export function storefrontPlatformLiableCents(
  payload: TaxReturnPayload | null,
): number {
  const bucket = payload?.storefront?.summary?.aglynLiable
  const filing = taxReturnFilingJurisdiction(payload)
  const figures = bucket?.byJurisdiction?.[filing.code]
  const cents = Number(figures?.taxCollectedCents ?? 0)
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
  const filing = taxReturnFilingJurisdiction(payload)
  const items: TaxReturnAttentionItem[] = [
    {
      /*
       * A jurisdiction key nothing can match makes every figure on the return
       * read `0.00` — the only finding here that is a fault in the DEPLOYMENT
       * rather than in a row, and the one a clean-looking page hides best. It
       * is not corrected to the default: guessing which authority an operator
       * meant, on a document filed under penalty of perjury, is worse than
       * refusing to guess.
       */
      id: 'jurisdictionUnrecognized',
      severity: 'blocking',
      count: filing.recognized ? 0 : 1,
      label: 'Configured filing jurisdiction is not a jurisdiction key',
      detail:
        `"${filing.code}" cannot match any bucket in this report, so every ` +
        'figure below reads as zero whatever was collected. Set ' +
        'AGLYN_TAX_JURISDICTION to a country code with an optional ' +
        'subdivision — US-TX, US-CA, GB, DE.',
    },
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
        'Charged before their subscription gained tax behavior. If any is ' +
        `a ${filing.label} sale, tax was under-collected and is still owed — ` +
        'the platform pays it from the receipt.',
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
        `Bucketed under "unknown" — they are NOT in the ${filing.label} ` +
        `figures. If any is a ${filing.label} customer, this return ` +
        'understates the tax due.',
    },
    {
      /*
       * AGL-2329. `netCents` is stored on every row and the summary
       * recomputes `gross − tax` instead, saying so in a comment — which
       * left a second source of truth nobody was watching. A row where the
       * two disagree was hand-edited or written by a build whose arithmetic
       * differed, and a filing record is the last place that should be
       * quietly corrected. `review`, not `blocking`: the totals here are
       * derived, so they are still right; what is in doubt is the row.
       */
      id: 'rowsWithNetMismatch',
      severity: 'review',
      count: Number(attention?.rowsWithNetMismatch ?? 0),
      label: 'Rows whose stored net contradicts gross minus tax',
      detail:
        'The figures here are recomputed, so they are consistent — but the ' +
        'stored net on these rows is not, which means the row was edited or ' +
        'written by an older build. Reconcile the row before filing from it.',
    },
    {
      /*
       * AGL-2329. `chargedBackCents` was maintained by the billing webhook
       * and read only by the webhook itself, so the return could not tell a
       * refund we chose to give from a payment a bank clawed back — the
       * exact distinction the field was created to make.
       */
      id: 'chargedBackCents',
      severity: 'review',
      count: Number(payload.summary?.refunds?.chargedBackCents ?? 0),
      label: 'Cents reversed by a bank, not by us',
      detail:
        'Cents. A SUBSET of the refunds recorded this period, not an ' +
        'addition to them. A chargeback is a dispute lost rather than a ' +
        'refund granted, and the two are not always adjusted the same way — ' +
        'check the treatment before netting them together.',
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
      count: storefrontPlatformLiableCents(payload),
      label: `${filing.label} storefront tax collected under Aglyn’s registration`,
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
        'to the publisher and all of it is in the platform’s balance. It is ' +
        `NOT in ${filing.figuresName} below. Decide with counsel how it is ` +
        'reported before filing — do not file as if it were zero.',
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
        'may belong to a neighboring period.',
    },
    {
      id: 'rowsMissingPaidAt',
      severity: 'review',
      count: Number(attention?.rowsMissingPaidAt ?? 0),
      label: 'Rows with no paid date',
      detail:
        'Period assignment fell back to the query bounds, so these rows may ' +
        'belong to a neighboring period.',
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

/**
 * ONE ROW A FINDING IS ABOUT, with enough on it to begin.
 *
 * A finding that states a count and cannot state which rows is a finding
 * nobody can act on. "1 row needs attention — billed without automatic tax"
 * meant somebody owed a decision about whether tax was under-collected on a
 * sale, with the platform paying any shortfall out of the receipt, and no way
 * to learn which sale.
 *
 * So each row carries exactly what it takes to resolve it and nothing more:
 * the invoice id, the jurisdiction it was BUCKETED under (the resolved one,
 * not the raw address — that is the fact that put it on or off the return),
 * the money, the paid date, and a link into Stripe where an invoice id can
 * build one. Every field is already on the payload; none of it is a widening.
 */
export interface TaxReturnFindingRow {
  invoiceId: string
  orgId: string | null
  /** `US-TX`, or `unknown` — the bucket key, as the summary resolved it. */
  jurisdiction: string
  grossDollars: string
  taxDollars: string
  /** ISO, or null — which is itself one of the findings. */
  paidAt: string | null
  /** Null where the invoice id is not one Stripe would recognize. */
  stripeUrl: string | null
  findings: TaxReturnRowFinding[]
}

/**
 * Stripe's dashboard, for an invoice id.
 *
 * Only for ids that look like Stripe's own (`in_…`). A row whose id came from
 * somewhere else gets no link rather than a link to a 404: a dead link on a
 * filing surface is read as "the invoice is gone", which is a much more
 * alarming claim than "this is not a Stripe id".
 */
function stripeInvoiceUrl(invoiceId: string): string | null {
  return /^in_[A-Za-z0-9]+$/.test(invoiceId)
    ? `https://dashboard.stripe.com/invoices/${invoiceId}`
    : null
}

/** The bucket key a row was summed under — see {@link TaxReturnFindingRow}. */
function rowJurisdiction(row: TaxReturnRow): string {
  const country = typeof row.country === 'string' ? row.country.trim() : ''
  if (!country) return 'unknown'
  const state = typeof row.state === 'string' ? row.state.trim() : ''
  return state ? `${country}-${state}` : country
}

function toFindingRow(row: TaxReturnRow): TaxReturnFindingRow {
  return {
    invoiceId: row.invoiceId,
    orgId: row.orgId ?? null,
    jurisdiction: rowJurisdiction(row),
    grossDollars: centsToDollars(row.grossCents),
    taxDollars: centsToDollars(row.taxCents),
    paidAt: row.paidAt ?? null,
    stripeUrl: stripeInvoiceUrl(row.invoiceId),
    findings: row.findings ?? [],
  }
}

/**
 * The rows behind one finding, from every list on the payload that can hold
 * them.
 *
 * `undatedRows` is the reason this reads two lists rather than one: those rows
 * are outside every period query by definition, so they are in `undated` and
 * can never be in `rows`. A version of this that filtered `rows` alone would
 * answer "none" for the one finding that BLOCKS filing.
 */
export function taxReturnFindingRows(
  payload: TaxReturnPayload | null,
  finding: TaxReturnRowFinding | 'undatedRows',
): TaxReturnFindingRow[] {
  if (!payload) return []
  if (finding === 'undatedRows') {
    return (payload.undated?.rows ?? []).map(toFindingRow)
  }
  return (payload.rows ?? [])
    .filter((row) => (row.findings ?? []).includes(finding))
    .map(toFindingRow)
}

/**
 * A finding, its count, and the rows it is about — or an honest admission
 * that this response cannot name them.
 *
 * `namesRows: false` is the state a response cached from before the per-row
 * findings existed lands in. It has to be distinguishable from "no rows",
 * because the two look identical in a table and mean opposite things: one is
 * a clean period and the other is a period whose evidence did not arrive.
 */
export interface TaxReturnFindingGroup {
  id: TaxReturnRowFinding | 'undatedRows'
  label: string
  severity: TaxReturnAttentionSeverity | 'informational'
  detail: string
  count: number
  rows: TaxReturnFindingRow[]
  namesRows: boolean
}

/**
 * Every finding that is ABOUT ROWS, with its rows attached.
 *
 * Ordered blocking, then review, then informational, matching the verdict
 * banner above it — a reader moving from one to the other is following the
 * same list.
 *
 * The informational entry is `untaxedRowsBeforeObligation`, and it is here
 * rather than in the verdict on purpose. Those rows need no attention: they
 * were billed before the filer's obligation began, so nothing was
 * under-collected and raising them every quarter forever would train a reader
 * to skim the one list that must not be skimmed. But they must not simply
 * vanish either — an operator who has been looking at a count of one is owed
 * the rows and the reason, not a number that quietly became zero.
 *
 * Findings the verdict raises that are NOT about rows — a truncated sweep, an
 * unrecognized jurisdiction key, a cents total — are absent. There is nothing
 * to name, and a group with an empty table beside it would read as a finding
 * whose rows failed to load.
 */
export function taxReturnFindingGroups(
  payload: TaxReturnPayload | null,
): TaxReturnFindingGroup[] {
  if (!payload) return []
  const attention = payload.summary?.attention
  const filing = taxReturnFilingJurisdiction(payload)
  const items = taxReturnAttentionItems(payload)
  const stated = new Map(items.map((item) => [item.id, item]))

  const rowFindings: Array<{
    id: TaxReturnRowFinding | 'undatedRows'
    count: number
    label: string
    severity: TaxReturnAttentionSeverity | 'informational'
    detail: string
  }> = [
    {
      id: 'undatedRows',
      count: Number(payload.undatedRows ?? 0),
      label: 'Rows outside every period',
      severity: 'blocking',
      detail: stated.get('undatedRows')?.detail ?? '',
    },
    {
      id: 'untaxedRows',
      count: Number(attention?.untaxedRows ?? 0),
      label: 'Rows billed without automatic tax',
      severity: 'review',
      detail: stated.get('untaxedRows')?.detail ?? '',
    },
    {
      id: 'rowsMissingTaxableBase',
      count: Number(attention?.rowsMissingTaxableBase ?? 0),
      label: 'Rows with tax but no stated base',
      severity: 'review',
      detail: stated.get('rowsMissingTaxableBase')?.detail ?? '',
    },
    {
      id: 'rowsMissingAddress',
      count: Number(attention?.rowsMissingAddress ?? 0),
      label: 'Rows with no readable address',
      severity: 'review',
      detail: stated.get('rowsMissingAddress')?.detail ?? '',
    },
    {
      id: 'rowsWithNetMismatch',
      count: Number(attention?.rowsWithNetMismatch ?? 0),
      label: 'Rows whose stored net contradicts gross minus tax',
      severity: 'review',
      detail: stated.get('rowsWithNetMismatch')?.detail ?? '',
    },
    {
      id: 'nonUsdRows',
      count: Number(attention?.nonUsdRows ?? 0),
      label: 'Rows not in US dollars',
      severity: 'review',
      detail: stated.get('nonUsdRows')?.detail ?? '',
    },
    {
      id: 'rowsMissingPaidAt',
      count: Number(attention?.rowsMissingPaidAt ?? 0),
      label: 'Rows with no paid date',
      severity: 'review',
      detail: stated.get('rowsMissingPaidAt')?.detail ?? '',
    },
    {
      id: 'untaxedRowsBeforeObligation',
      count: Number(attention?.untaxedRowsBeforeObligation ?? 0),
      label: 'Untaxed rows from before the obligation began',
      severity: 'informational',
      detail:
        'Billed without automatic tax, and paid before the first filable ' +
        `period configured for ${filing.label}. There was nothing to ` +
        'collect on these, so they raise no finding — they are listed so a ' +
        'count that used to include them is accounted for rather than ' +
        'silently smaller.',
    },
    {
      id: 'internalRows',
      count: Number(attention?.internalRows ?? 0),
      label: 'Aglyn’s own purchases — excluded from every figure',
      severity: 'informational',
      detail:
        'Marked internal at checkout (AGL-1582) and therefore not sales to ' +
        `${filing.label}. Their receipts, base and tax are OUT of the ` +
        'figures above and stated on the jurisdiction table as excluded, so ' +
        'nothing was dropped silently. The mark is written when the purchase ' +
        'is made and cannot be added afterwards — a test purchase made ' +
        'without it is filed as a real sale, and the only remedy is at the ' +
        'row.',
    },
  ]

  const order: Record<string, number> = {
    blocking: 0,
    review: 1,
    informational: 2,
  }
  return rowFindings
    .filter((entry) => entry.count > 0)
    .map((entry) => {
      const rows = taxReturnFindingRows(payload, entry.id)
      return {
        ...entry,
        rows,
        // A count with no rows beside it is a response that could not name
        // them, not a finding without rows: the count came from the same
        // predicate that stamps them, so on any payload carrying findings the
        // two agree by construction.
        namesRows: rows.length > 0,
      }
    })
    .sort((a, b) => order[a.severity] - order[b.severity])
}

export interface TaxReturnWebfileLine {
  /** Form 01-114 item number, where the figure maps to one. */
  item: string
  label: string
  /** Dollars, or null when this report does not compute the figure. */
  dollars: string | null
  note: string
  /**
   * True when the figure was TYPED by an operator rather than derived from
   * records here.
   *
   * The provenance has to travel with the number. Every other line on this
   * return is summed from `platformRevenue`; Item 3 cannot be, and a figure
   * that appears in the same column, in the same font, with the same
   * authority as a computed one is a figure somebody will later defend as
   * computed. The surfaces mark it, and the CSV carries who entered it and
   * when.
   */
  entered?: boolean
}

/**
 * ITEM 3, from the entry — and `not computed` when there is no entry.
 *
 * The whole of the rule this module holds most tightly lives in this one
 * function, so it is written once rather than spelled out at each caller:
 *
 *   - **No entry ⇒ `dollars: null`.** Never `'0.00'`. A zero printed where no
 *     figure was derived is a claim this data cannot support, and one arriving
 *     from a storage layer is worse than one arriving from nowhere, because it
 *     looks derived.
 *   - **An entry of zero ⇒ `dollars: '0.00'`, marked entered.** That is not
 *     the same fact and must not render as one: somebody looked, and the
 *     answer was nothing.
 */
function taxablePurchasesLine(
  payload: TaxReturnPayload | null,
): TaxReturnWebfileLine {
  const entry = payload?.taxablePurchases ?? null
  if (!entry) {
    return {
      item: 'Item 3',
      label: 'Taxable purchases',
      dollars: null,
      note:
        "NOT COMPUTED — use tax on Aglyn's own purchases is not in " +
        'platformRevenue. Enter it from the expense records on the Taxable ' +
        'purchases card, where it is stored for this period and audited.',
    }
  }
  const who = entry.enteredBy ? ` by ${entry.enteredBy}` : ''
  const when = entry.enteredAt ? ` on ${entry.enteredAt.slice(0, 10)}` : ''
  return {
    item: 'Item 3',
    label: 'Taxable purchases',
    dollars: entry.amountDollars,
    entered: true,
    note:
      `ENTERED, not computed${who}${when} — use tax on Aglyn's own ` +
      `purchases, from the expense records. Reason given: ${entry.note}`,
  }
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
 * Where an operator has ENTERED one for this period it prints their figure,
 * marked as entered and carrying who entered it — see
 * {@link taxablePurchasesLine}. An unentered period still reads not computed.
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
    taxablePurchasesLine(payload),
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
        ? centsToDollars(storefrontPlatformLiableCents(payload))
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

/**
 * THE GENERIC RETURN BREAKDOWN — every jurisdiction with no exporter of its
 * own.
 *
 * Not a form, and it says so. Nothing here knows what California's CDTFA
 * return or a UK VAT return asks for, in what order, or under which schedule
 * a facilitated sale belongs — and a document that guessed would be worse than
 * no document, because it would be transcribed. What the platform does know is
 * exactly what it collected and where, which is the raw material every one of
 * those returns is assembled from: the period, the gross, the base each rate
 * was applied to, the tax collected, and the same figures split by destination
 * region on the tables below.
 *
 * The item column carries no numbers because there is no form to number
 * against. `Taxable purchases` is absent for the same reason — it is a Texas
 * form line, not a universal concept, and inventing it here would claim
 * knowledge of a form this code does not have.
 */
export function taxReturnBreakdownLines(
  payload: TaxReturnPayload | null,
): TaxReturnWebfileLine[] {
  const filing = taxReturnFilingJurisdiction(payload)
  const figures = payload?.summary?.byJurisdiction?.[filing.code]
  const dollars = (cents: number | undefined) =>
    payload ? centsToDollars(cents ?? 0) : null
  return [
    {
      item: '—',
      label: `Total sales in ${filing.code}`,
      dollars: dollars(figures?.totalSalesCents),
      note: 'Receipts excluding the tax itself.',
    },
    {
      item: '—',
      label: 'Taxable sales',
      dollars: dollars(figures?.taxableSalesCents),
      note: "Stripe's taxable_amount summed — the base each rate was applied to.",
    },
    {
      item: '—',
      label: 'Tax collected',
      dollars: dollars(figures?.taxCollectedCents),
      note: 'What was actually charged to customers in this jurisdiction.',
    },
    {
      item: '—',
      label: 'Transactions',
      dollars: payload ? String(figures?.transactionCount ?? 0) : null,
      note: `Invoices in the period with a ${filing.code} billing address.`,
    },
    {
      item: '—',
      label: `${filing.code} storefront tax under the platform’s registration (NOT in the figures above)`,
      dollars: payload
        ? centsToDollars(storefrontPlatformLiableCents(payload))
        : null,
      note:
        'Collected from shoppers on merchants’ sales and held in the ' +
        'platform’s balance. Excluded from every figure above. Its treatment ' +
        'on the return is a question for the operator’s own counsel.',
    },
    {
      item: '—',
      label: `${filing.code} storefront tax under the MERCHANT’s own rate`,
      dollars: payload
        ? centsToDollars(
            payload.storefront?.summary?.merchantManual?.byJurisdiction?.[
              filing.code
            ]?.taxCollectedCents ?? 0,
          )
        : null,
      note:
        'A manual-mode store’s own configured rate. The platform’s ' +
        'registrations played no part in computing it. Shown so it is ' +
        'visibly NOT the line above — the two must never be added together.',
    },
  ]
}

/**
 * The filing figures for whichever jurisdiction is configured.
 *
 * ONE entry point, so a surface cannot render Texas's form lines on a
 * deployment that files somewhere else by reaching for the wrong helper — the
 * defect this dispatcher replaces was exactly that, with no reaching involved
 * because there was only one.
 */
export function taxReturnFilingLines(
  payload: TaxReturnPayload | null,
): TaxReturnWebfileLine[] {
  return taxReturnFilingJurisdiction(payload).form === 'tx-webfile'
    ? taxReturnWebfileLines(payload)
    : taxReturnBreakdownLines(payload)
}

/** A jurisdiction row for the "why the rest is not on the return" table. */
/**
 * One working-paper line, ready to render (AGL-2329).
 *
 * `label` is built here rather than in the component so the two consumers of
 * these rows — the screen and anything that exports them — cannot word the
 * same rate differently. A rate that reads `txr_tx_state` in one place and
 * `Texas 6.25%` in another is two names for one row of a filing.
 */
export interface TaxReturnWorkingPaperRow {
  key: string
  label: string
  lines: number
  taxCollectedDollars: string
  taxableSalesDollars: string
}

export interface TaxReturnJurisdictionRow {
  jurisdiction: string
  /** True for the one jurisdiction this deployment files a return in. */
  isFilingJurisdiction: boolean
  transactionCount: number
  totalSalesDollars: string
  taxableSalesDollars: string
  taxCollectedDollars: string
  /**
   * WHY this jurisdiction came out the way it did (AGL-2329).
   *
   * Stripe's taxability reasons, dearest first. This is the half a total can
   * never carry: $0 of tax reads identically whether we are unregistered
   * there, the product is exempt, or the rate is genuinely zero.
   */
  taxabilityReasons: TaxReturnWorkingPaperRow[]
  /** WHICH rate produced it — the row an examiner checks a rate table against. */
  rates: TaxReturnWorkingPaperRow[]
  /**
   * WHAT WAS TAKEN OUT of this jurisdiction, and it is stated because it was
   * taken out (AGL-1582).
   *
   * Aglyn's own purchases are not sales to a state, so they are excluded from
   * every figure above — but a return that quietly drops rows cannot be
   * checked by the person signing it. These are the same figures for the rows
   * that were removed, so the two can be added back by anyone who disagrees
   * with the exclusion.
   */
  internalTransactionCount: number
  internalTotalSalesDollars: string
  internalTaxCollectedDollars: string
  /**
   * True when NOTHING was filed for this jurisdiction and the rows here are
   * all excluded ones.
   *
   * The state the current deployment is in, and the one a union of the two
   * maps exists to make visible: a jurisdiction whose only rows are internal
   * is absent from `byJurisdiction` altogether, so a table built from that map
   * alone would report the period as having no invoices at all while an
   * excluded row sat behind it.
   */
  internalOnly: boolean
}

/**
 * Stripe's `taxability_reason` values, in the words a preparer uses.
 *
 * Not exhaustive by design — an unrecognised reason renders its raw code
 * rather than being dropped or mapped to a neighbour. On a filing record,
 * "we do not have a name for this" is a better answer than a plausible
 * wrong one.
 */
const TAXABILITY_REASON_LABEL: Record<string, string> = {
  standard_rated: 'Standard rated',
  taxable_basis_reduced: 'Taxable basis reduced',
  not_collecting: 'Not collecting — no registration',
  not_subject_to_tax: 'Not subject to tax',
  product_exempt: 'Product exempt',
  product_exempt_holiday: 'Product exempt — tax holiday',
  customer_exempt: 'Customer exempt',
  reverse_charge: 'Reverse charge',
  zero_rated: 'Zero rated',
  excluded_territory: 'Excluded territory',
  proportionally_rated: 'Proportionally rated',
  unstated: 'No reason recorded',
}

/** Every jurisdiction, the filing one first, then by receipts descending. */
export function taxReturnJurisdictionRows(
  payload: TaxReturnPayload | null,
): TaxReturnJurisdictionRow[] {
  const byJurisdiction = payload?.summary?.byJurisdiction ?? {}
  const internalByJurisdiction =
    payload?.summary?.internal?.byJurisdiction ?? {}
  const filing = taxReturnFilingJurisdiction(payload)
  // The UNION of the filed and the excluded maps. A jurisdiction whose only
  // rows were Aglyn's own purchases appears in neither `byJurisdiction` nor
  // any figure above, so a table built from the filed map alone would show an
  // empty period over rows that exist and were removed.
  const jurisdictions = [
    ...new Set([
      ...Object.keys(byJurisdiction),
      ...Object.keys(internalByJurisdiction),
    ]),
  ]
  return jurisdictions
    .map((jurisdiction) => {
      const bucket = byJurisdiction[jurisdiction]
      const internal = internalByJurisdiction[jurisdiction]
      return {
        jurisdiction,
        isFilingJurisdiction: jurisdiction === filing.code,
        transactionCount: Number(bucket?.transactionCount ?? 0),
        totalSalesDollars: centsToDollars(bucket?.totalSalesCents),
        taxableSalesDollars: centsToDollars(bucket?.taxableSalesCents),
        taxCollectedDollars: centsToDollars(bucket?.taxCollectedCents),
        taxabilityReasons: Object.entries(bucket?.taxabilityReasons ?? {})
          .map(([reason, entry]) => ({
            key: reason,
            // Stripe's enum, in words. An unrecognised reason keeps its raw
            // code rather than being dropped or relabelled — a filing record
            // must not silently rename a fact it does not know.
            label: TAXABILITY_REASON_LABEL[reason] ?? reason,
            lines: Number(entry?.lines ?? 0),
            taxCollectedDollars: centsToDollars(entry?.taxCollectedCents),
            taxableSalesDollars: centsToDollars(entry?.taxableAmountCents),
          }))
          .sort(
            (a, b) =>
              Number(b.taxCollectedDollars) - Number(a.taxCollectedDollars) ||
              a.key.localeCompare(b.key),
          ),
        rates: (bucket?.rates ?? []).map((rate) => ({
          key: `${rate?.taxRateId}-${rate?.percentage ?? 'na'}`,
          label:
            [
              rate?.jurisdiction ?? rate?.rateState ?? null,
              rate?.percentage == null ? null : `${rate.percentage}%`,
              rate?.taxRateId && rate.taxRateId !== 'unknown'
                ? rate.taxRateId
                : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'rate not stated',
          lines: Number(rate?.lines ?? 0),
          taxCollectedDollars: centsToDollars(rate?.taxCollectedCents),
          taxableSalesDollars: centsToDollars(rate?.taxableAmountCents),
        })),
        internalTransactionCount: Number(internal?.transactionCount ?? 0),
        internalTotalSalesDollars: centsToDollars(internal?.totalSalesCents),
        internalTaxCollectedDollars: centsToDollars(
          internal?.taxCollectedCents,
        ),
        internalOnly: !bucket && Number(internal?.transactionCount ?? 0) > 0,
        sortKey: Number(bucket?.totalSalesCents ?? 0),
      }
    })
    .sort((a, b) => {
      if (a.isFilingJurisdiction !== b.isFilingJurisdiction)
        return a.isFilingJurisdiction ? -1 : 1
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

/** One state's facilitated storefront sales, for the nexus question. */
export interface TaxReturnFacilitatedJurisdictionRow {
  jurisdiction: string
  /** True for the one jurisdiction this deployment files a return in. */
  isFilingJurisdiction: boolean
  transactionCount: number
  totalSalesDollars: string
  taxCollectedDollars: string
  /** The part of `taxCollectedDollars` Aglyn holds and must remit. */
  aglynLiableTaxDollars: string
  /** True when NO tax was collected on any sale into this state. */
  untaxed: boolean
}

/**
 * FACILITATED SALES BY STATE — the economic-nexus question (AGL-1956).
 *
 * Aglyn is a marketplace facilitator, so the question a state asks is "how much
 * did you facilitate INTO this state, and in how many transactions" — not "how
 * much tax did you collect there". A state Aglyn is not registered in collects
 * nothing by definition, which is exactly why collection cannot be the
 * measure: the states worth watching are the ones showing $0 tax and a rising
 * sales figure.
 *
 * So this SUMS the three liability buckets per jurisdiction. That is not a
 * violation of the rule that `platformRevenue` and `storefrontTaxCollected`
 * must never be summed — that rule is about two different COLLECTIONS
 * describing two different taxpayers' money, and it still holds: nothing here
 * touches `payload.summary`, which is Aglyn's own SaaS revenue. Within the
 * storefront collection the buckets differ only in WHO REMITS, and a nexus
 * threshold counts the sale whoever remits it.
 *
 * Who remits is still carried, per row, as `aglynLiableTaxDollars` — because
 * the two questions ("do we have nexus here" and "what do we owe here") are
 * answered off the same rows and must not be allowed to blur into each other.
 *
 * ⚠️ This is a LOWER BOUND, and deliberately so rather than silently:
 * `storefront-tax-record.ts` files no row at all for a sale whose `taxMode`
 * resolves to `none`, so a wholly untaxed storefront sale is invisible here.
 * That is the population nexus detection most needs, and closing it is a
 * write-side change recorded on AGL-1956 rather than smuggled into a report.
 * The filing jurisdiction does not depend on any of this — a filer registered
 * where it is established has no in-state threshold left to cross, so that
 * obligation is unconditional whatever this table says.
 */
export function taxReturnFacilitatedJurisdictionRows(
  payload: TaxReturnPayload | null,
): TaxReturnFacilitatedJurisdictionRow[] {
  const summary = payload?.storefront?.summary
  if (!summary) return []
  const filing = taxReturnFilingJurisdiction(payload)
  const totals = new Map<
    string,
    { count: number; salesCents: number; taxCents: number; aglynCents: number }
  >()
  const buckets: Array<['aglynLiable' | 'merchantManual' | 'connectedAccountLiable', boolean]> =
    [
      ['aglynLiable', true],
      ['merchantManual', false],
      ['connectedAccountLiable', false],
    ]
  for (const [id, aglynLiable] of buckets) {
    const byJurisdiction = summary[id]?.byJurisdiction ?? {}
    for (const [jurisdiction, figures] of Object.entries(byJurisdiction)) {
      const entry = totals.get(jurisdiction) ?? {
        count: 0,
        salesCents: 0,
        taxCents: 0,
        aglynCents: 0,
      }
      const taxCents = Number(figures?.taxCollectedCents ?? 0)
      entry.count += Number(figures?.transactionCount ?? 0)
      entry.salesCents += Number(figures?.totalSalesCents ?? 0)
      entry.taxCents += taxCents
      if (aglynLiable) entry.aglynCents += taxCents
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
      aglynLiableTaxDollars: centsToDollars(entry.aglynCents),
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
  const filing = taxReturnFilingJurisdiction(payload)
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
      note: `The remittable figure — and it is in NO ${figuresLine} line above.`,
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
  const filing = registration.jurisdiction
  const texas = filing.form === 'tx-webfile'
  const lines: string[][] = [
    texas
      ? ['Aglyn — Texas sales tax return working papers']
      : [`Sales tax return breakdown — ${filing.code} — working papers`],
    // The honesty line, and it is the first thing read on a file whose whole
    // risk is being mistaken for a return. Only where there is no exporter for
    // the jurisdiction: the Texas block below IS the form's own lines.
    ...(texas
      ? []
      : [
          [
            'FOR MANUAL FILING — a breakdown of what was collected in ' +
              `${filing.code}, not a submittable return. No form for this ` +
              'jurisdiction is known here; transcribe these figures onto ' +
              'the return the authority asks for.',
          ],
        ]),
    ['Period', payload.period ?? ''],
    ['Period start (UTC)', payload.summary?.periodStart ?? ''],
    ['Period end (UTC, exclusive)', payload.summary?.periodEnd ?? ''],
    ['Filing jurisdiction', filing.code],
    // AGL-2021: from the payload, and honestly absent when unconfigured —
    // never a blank cell, never a placeholder that reads as a real number.
    [
      filing.registrationIdLabel,
      registration.registrationId ?? TAX_REGISTRATION_UNSET,
    ],
    [filing.filingIdLabel, registration.filingId ?? taxFilingIdUnsetNote(filing)],
    [],
    [
      texas
        ? 'Webfile figures (Texas only)'
        : `Return breakdown (${filing.code} only)`,
    ],
    ['Item', 'Line', 'Amount (USD)', 'Note'],
    ...taxReturnFilingLines(payload).map((line) => [
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
    // AGL-2329. A SUBSET of the gross above, labelled as one — the billing
    // webhook maintained this figure and only the webhook read it, so the
    // return could not tell a refund we granted from a payment a bank
    // clawed back. Stated on its own row rather than netted in: they are
    // the same money and different facts.
    [
      'Of which reversed by a bank rather than by us (USD)',
      centsToDollars(payload.summary?.refunds?.chargedBackCents),
    ],
    ['Rows with a chargeback', String(payload.summary?.refunds?.rowsChargedBack ?? 0)],
    [],
    /*
     * WHAT WAS EXCLUDED, and it is in the working papers because it was
     * excluded (AGL-1582). Aglyn's own purchases are not sales to a state, so
     * they are out of every figure above — and a return whose rows do not sum
     * to its totals cannot be checked by the person signing it. Adding these
     * back reproduces the unfiltered figures exactly.
     */
    ['Excluded as Aglyn’s own purchases (NOT in any figure above)'],
    [
      'Rows excluded',
      String(payload.summary?.internal?.transactionCount ?? 0),
    ],
    [
      'Excluded receipts, tax excluded (USD)',
      centsToDollars(payload.summary?.internal?.totalSalesCents),
    ],
    [
      'Excluded taxable base (USD)',
      centsToDollars(payload.summary?.internal?.taxableSalesCents),
    ],
    [
      'Excluded tax collected (USD)',
      centsToDollars(payload.summary?.internal?.taxCollectedCents),
    ],
    [
      'How a row is marked',
      'At checkout, from a browser the deployment declared its own ' +
        '(AGL-1582). The mark cannot be added to a purchase afterwards.',
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
    // AGLYN'S OWN sales — `platformRevenue`. Named for the taxpayer whose
    // money it is (AGL-1956): this section used to be headed "All
    // jurisdictions", which read as every sale the platform saw and was in
    // fact only Aglyn's subscription and add-on invoices.
    ['Aglyn’s own sales by jurisdiction'],
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
    // MERCHANTS' sales, by where the shopper was — the nexus evidence
    // (AGL-1956). A different taxpayer's money from the section above and
    // never summed with it, which is why it is its own block rather than more
    // rows. The export is the contemporaneous record behind a filed return, so
    // the figure a state would ask about belongs in it.
    ['Facilitated sales by buyer state (merchants’ storefronts)'],
    [
      'Buyer state',
      'Sales',
      'Total sales (USD)',
      'Tax collected (USD)',
      'Of which Aglyn owes (USD)',
    ],
    ...(taxReturnFacilitatedJurisdictionRows(payload).length
      ? taxReturnFacilitatedJurisdictionRows(payload).map((row) => [
          row.jurisdiction,
          String(row.transactionCount),
          row.totalSalesDollars,
          row.taxCollectedDollars,
          row.aglynLiableTaxDollars,
        ])
      : [['—', '0', '0.00', '0.00', '0.00']]),
    [
      'LOWER BOUND — a storefront sale that collected no tax files no row, ' +
        `so it is absent here. ${filing.code} needs no threshold: the filer ` +
        'is established there.',
    ],
    [],
    /*
     * THE WORKING PAPERS (AGL-2329).
     *
     * This file calls itself working papers in its own first line, and the
     * fields that make it one — `taxabilityReason`, `taxRateId`,
     * `percentage`, `rateState`, three of them annotated "for the working
     * papers" at the writer — were projected by nothing. A jurisdiction
     * total with no reason beside it cannot be checked against the exemption
     * it claims, and $0 of tax reads identically whether we are
     * unregistered, the product is exempt, or the rate is genuinely zero.
     *
     * In the CSV as well as on the screen because this is where a preparer
     * actually works: the rows sort, filter and reconcile in a spreadsheet
     * and do not on a card.
     */
    ['Working papers — why each jurisdiction came out as it did'],
    [
      'Jurisdiction',
      'Taxability reason',
      'Lines',
      'Taxable sales (USD)',
      'Tax collected (USD)',
    ],
    ...taxReturnJurisdictionRows(payload).flatMap((row) =>
      row.taxabilityReasons.length
        ? row.taxabilityReasons.map((paper) => [
            row.jurisdiction,
            paper.label,
            String(paper.lines),
            paper.taxableSalesDollars,
            paper.taxCollectedDollars,
          ])
        : [[row.jurisdiction, 'No tax lines recorded', '0', '0.00', '0.00']],
    ),
    [],
    ['Working papers — the rates behind each jurisdiction'],
    [
      'Jurisdiction',
      'Rate',
      'Lines',
      'Taxable sales (USD)',
      'Tax collected (USD)',
    ],
    ...taxReturnJurisdictionRows(payload).flatMap((row) =>
      row.rates.map((rate) => [
        row.jurisdiction,
        rate.label,
        String(rate.lines),
        rate.taxableSalesDollars,
        rate.taxCollectedDollars,
      ]),
    ),
    [],
    [
      'Storefront commerce tax by liability (AGL-1904) — NOT in ' +
        (texas ? 'the Webfile figures' : 'the breakdown above'),
    ],
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
    [
      'Marketplace tax (AGL-2137) — NOT in ' +
        (texas ? 'the Webfile figures' : 'the breakdown above'),
    ],
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
      // AGL-1582: whether this row is in the figures above at all. A working
      // paper whose rows sum to something other than the total it supports is
      // not a working paper, so the exclusion has to be legible per row.
      'on the return',
      // The findings this row raises, so a count on the screen can be walked
      // back to its rows in a spreadsheet as well.
      'findings',
    ],
    ...[
      ...(payload.rows ?? []),
      // The rows in NO period query — the blocking finding's own population,
      // which is in no other list on the payload and was in no export.
      ...(payload.undated?.rows ?? []),
    ].map((row) => [
      row.invoiceId,
      row.orgId ?? '',
      row.paidAt ?? '',
      row.country ?? '',
      row.state ?? '',
      centsToDollars(row.grossCents),
      centsToDollars(row.taxCents),
      centsToDollars(row.taxableSalesCents),
      centsToDollars(row.refundedCents),
      // Three states, not two: a field that was never written is not the
      // explicit `false` the untaxed finding is about.
      row.automaticTax === null || row.automaticTax === undefined
        ? 'not stated'
        : row.automaticTax
          ? 'yes'
          : 'no',
      row.internalTraffic ? 'no — Aglyn’s own purchase' : 'yes',
      (row.findings ?? []).join(' '),
    ]),
  ]
  return lines.map((row) => (row ?? []).map(csvCell).join(',')).join('\n')
}

/**
 * A filename that sorts and identifies without being opened — including WHICH
 * AUTHORITY it is for, which is the half a folder of quarterly exports needs
 * most once a deployment files anywhere but Texas.
 *
 * The jurisdiction defaults rather than being required, so a caller that
 * predates the setting still names the Texas file exactly as it always did.
 */
export function taxReturnCsvFilename(
  period: string,
  jurisdictionCode?: string | null,
): string {
  const safe = String(period ?? '').replace(/[^\dA-Za-z-]/g, '') || 'period'
  return `${taxFilingJurisdiction(jurisdictionCode).fileStem}-${safe}.csv`
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
 *
 * The floor is CONFIGURATION. `firstTaxablePeriod` is stored beside the
 * jurisdiction in Platform settings and read by the page before it builds this
 * menu, so an operator whose obligation began in 2024 gets 2024's periods
 * offered rather than having to reach them by hand through the route's own
 * `?period=`. Omitted, it is this deployment's own first taxable month, which
 * is what every existing caller gets.
 */
export function taxReturnPeriodOptions(
  now: Date,
  firstTaxablePeriod?: string | null,
): TaxReturnPeriodOption[] {
  const quarters: TaxReturnPeriodOption[] = []
  const months: TaxReturnPeriodOption[] = []
  const year = now.getUTCFullYear()
  const monthIndex = now.getUTCMonth()
  const floor = taxablePeriodFloor(firstTaxablePeriod)
  const firstYear = floor.year
  const firstQuarterIndex = Math.floor(floor.monthIndex / 3)
  const firstMonthIndex = floor.monthIndex

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
export function defaultTaxReturnPeriod(
  now: Date,
  firstTaxablePeriod?: string | null,
): string {
  const options = taxReturnPeriodOptions(now, firstTaxablePeriod).filter(
    (option) => option.kind === 'quarter',
  )
  if (!options.length) {
    const floor = taxablePeriodFloor(firstTaxablePeriod)
    return `${floor.year}-Q${Math.floor(floor.monthIndex / 3) + 1}`
  }
  const currentQuarter = `${now.getUTCFullYear()}-Q${
    Math.floor(now.getUTCMonth() / 3) + 1
  }`
  // The current quarter is still accruing, so its figures are not a return.
  // Prefer the one before it — but never invent a period that predates the
  // collection obligation, so a launch-quarter filer still gets a real one.
  const ended = options.find((option) => option.value !== currentQuarter)
  return (ended ?? options[0]).value
}
