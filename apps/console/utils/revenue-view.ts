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
 * View helpers for the staff revenue page (AGL-2486).
 *
 * Split out of the page for the reason every helper here exists: these decide
 * what a figure MEANS — which stream it belongs to, whether it is a loss,
 * whether the page may call it earnings — and that reasoning deserves a test
 * that does not have to mount React to run.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'

/** The shape `/api/admin/revenue` answers with, as the page receives it. */
export interface RevenuePayload {
  period?: string
  periodStart?: string
  periodEnd?: string
  contracted?: {
    total?: { orgs?: number; listPriceUsd?: number; mrrUsd?: number }
    collecting?: { orgs?: number; listPriceUsd?: number; mrrUsd?: number }
    trialing?: { orgs?: number; listPriceUsd?: number; mrrUsd?: number }
    pastDue?: { orgs?: number; listPriceUsd?: number; mrrUsd?: number }
    compedOrgs?: number
    discountUsd?: number
  }
  settled?: {
    subscriptions?: Record<string, number>
    marketplace?: Record<string, number>
    // `truncated` is a boolean beside numeric fields, so the index signature
    // has to admit both — `Record<string, number> & { truncated?: boolean }`
    // is unsatisfiable and no object can be assigned to it.
    commerce?: Record<string, number | boolean> & { truncated?: boolean }
    totalEarnedCents?: number
  }
  gap?: {
    collectingMrrCents?: number
    settledSubscriptionCents?: number
    gapCents?: number
    causes?: Record<string, number>
    unexplainedCents?: number
  }
  attention?: { rowsOutsideEveryPeriod?: number; commerceTruncated?: boolean }
  unbilledMeteredApplies?: boolean
  unbilledMeteredFailed?: boolean
  commerceQueryFailed?: boolean
  subscriptionsTruncated?: boolean
  marketplaceTruncated?: boolean
  contractedTruncated?: boolean
  /** Which sources hit the sweep ceiling, by name — never an anonymous flag. */
  truncatedSources?: string[]
  /** ISO date of the earliest mirrored invoice, or `null` for an empty mirror. */
  settledCoverageStart?: string | null
  /** The period starts before the settled mirror existed. */
  periodPrecedesCoverage?: boolean
  /** No invoice has ever been mirrored. */
  settledMirrorEmpty?: boolean
  /** The selected period has already ended — see `periodIsClosed` on the route. */
  periodIsClosed?: boolean
  attribution?: {
    rows?: {
      orgId?: string
      name?: string
      plan?: string
      state?: string
      mrrUsd?: number
      listPriceUsd?: number
      settledCents?: number
      invoices?: number
      refundedCents?: number
      unbilledMeteredCents?: number
    }[]
    omittedOrgs?: number
    omittedMrrUsd?: number
    omittedSettledCents?: number
    totalOrgs?: number
  }
  attributionByListing?: SourceAttributionView
  attributionByPublisher?: SourceAttributionView
  attributionByHost?: SourceAttributionView
}

/** One attributed source table, as the page receives it. */
export interface SourceAttributionView {
  rows?: {
    key?: string
    name?: string
    detail?: string
    gainCents?: number
    lossCents?: number
    count?: number
  }[]
  omittedRows?: number
  omittedGainCents?: number
  omittedLossCents?: number
}

/**
 * A cent figure as money, with the SIGN OUTSIDE the currency symbol.
 *
 * `$${dollars(-2500)}` rendered `$-25.00`, which reads as a broken template
 * rather than a negative amount. Every figure that can go negative goes
 * through this (AGL-2486).
 */
export function money(cents: unknown): string {
  const parsed = Number(cents ?? 0)
  const safe = Number.isFinite(parsed) ? parsed : 0
  return `${safe < 0 ? '-' : ''}$${dollars(Math.abs(safe))}`
}

/** The same, for a USD number rather than cents. */
export function usdMoney(value: unknown): string {
  const parsed = Number(value ?? 0)
  const safe = Number.isFinite(parsed) ? parsed : 0
  return `${safe < 0 ? '-' : ''}$${usdDollars(Math.abs(safe))}`
}

/** How an org's revenue state reads to a human. */
export const ORG_STATE_LABELS: Record<string, string> = {
  collecting: 'Active and collecting',
  trialing: 'Trialing',
  pastDue: 'Past due',
  comped: 'Comped / staff override',
  inactive: 'No live subscription',
}

/** Cents to a plain dollar string, no currency symbol. */
export function dollars(cents: unknown): string {
  const parsed = Number(cents ?? 0)
  return ((Number.isFinite(parsed) ? parsed : 0) / 100).toLocaleString(
    'en-US',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  )
}

/** A USD number (not cents) to the same format. */
export function usdDollars(value: unknown): string {
  const parsed = Number(value ?? 0)
  return (Number.isFinite(parsed) ? parsed : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Period choices: the last `count` months, newest first, plus quarters. */
export function revenuePeriodOptions(
  now: Date,
  count = 12,
): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  for (let back = 0; back < count; back += 1) {
    const date = new Date(Date.UTC(year, month - back, 1))
    const value = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, '0')}`
    options.push({
      value,
      label: date.toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    })
  }
  // Quarters after the months: a quarter cannot answer the unbilled-meter
  // question (the usage rollup keys on a month), so it is the coarser choice
  // and is offered second rather than as the default.
  for (let back = 0; back < 4; back += 1) {
    const date = new Date(Date.UTC(year, month - back * 3, 1))
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1
    const value = `${date.getUTCFullYear()}-Q${quarter}`
    if (!options.some((option) => option.value === value)) {
      options.push({ value, label: `Q${quarter} ${date.getUTCFullYear()}` })
    }
  }
  return options
}

/** The default period: the month just gone, which is the last complete one. */
export function defaultRevenuePeriod(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0',
  )}`
}

/** One line of the earned-revenue breakdown. */
export interface EarnedLine {
  id: string
  label: string
  cents: number
  /** Why this figure is what it is — never a restatement of the label. */
  note: string
}

/**
 * The earned breakdown: what Aglyn actually kept, by source.
 *
 * Every line is stated NET of the thing that would overstate it, and the note
 * says which thing. A reader must never have to know which of these figures
 * already had tax removed and which did not.
 */
export function earnedLines(payload: RevenuePayload | null): EarnedLine[] {
  const settled = payload?.settled
  if (!settled) return []
  const subscriptions = settled.subscriptions ?? {}
  const marketplace = settled.marketplace ?? {}
  const commerce = settled.commerce ?? {}
  return [
    {
      id: 'subscriptions',
      label: 'Subscriptions, add-ons and metered usage',
      cents: Number(subscriptions.netOfReversalsCents ?? 0),
      note:
        `Paid invoices on ${PLATFORM_BRAND_NAME}’s own account, net of sales ` +
        'tax and net of every ' +
        'refund and lost dispute. Add-ons and metered usage bill as lines on ' +
        'these same invoices, so they are already inside this figure — counting ' +
        'the usage rollup beside it would double them.',
    },
    {
      id: 'marketplace',
      label: 'Marketplace commission',
      cents: Number(marketplace.commissionNetCents ?? 0),
      note:
        'The platform’s cut of plugin sales, at the rate resolved from the ' +
        'seller’s entitlements when each sale settled, net of refunds. The ' +
        'buyer’s gross and the publisher’s transfer are excluded — that money ' +
        `is the publisher’s, not ${PLATFORM_BRAND_NAME}’s.`,
    },
    {
      id: 'commerce',
      label: 'Storefront commission',
      cents: Number(commerce.commissionNetCents ?? 0),
      note:
        'The advertised take on merchant storefront sales, net of refunds — ' +
        'with Stripe’s card processing removed. The platform fee charged on a ' +
        'storefront sale bundles that processing cost and passes it through at ' +
        'cost; it is a recovery, not earnings.',
    },
  ]
}

/** One named cause of the gap between the two bases. */
export interface GapCause {
  id: string
  label: string
  cents: number
  /** What to actually do about it. */
  action: string
  /**
   * Whether this cause is measured OVER THE PERIOD rather than as of today.
   *
   * `reversed` and `unbilledMetered` are period-scoped facts. `pastDue` and
   * `trialing` are read off the contracted base, which is a run-rate measured
   * NOW — so for a closed period they describe the book today, not the book
   * that produced that period's cash, and showing them as causes of a
   * historical difference is the same category error as the gap itself
   * (AGL-2486).
   */
  periodScoped: boolean
}

/**
 * The gap, decomposed into causes a person can act on.
 *
 * This is the part of the page that justifies showing two bases at all. Two
 * totals with no explanation leave the reader to subtract and guess, and the
 * guess is always "our reporting is broken" rather than "three cards are
 * failing".
 */
export function gapCauses(payload: RevenuePayload | null): GapCause[] {
  const causes = payload?.gap?.causes
  if (!causes) return []
  return [
    {
      id: 'pastDue',
      periodScoped: false,
      label: 'Past due — contracted, owed, not collected',
      cents: Number(causes.pastDueCents ?? 0),
      action:
        'Stripe is still retrying these cards. This is dunning: the money is ' +
        'owed and may still arrive, or may churn. Chase before the retry ' +
        'schedule runs out.',
    },
    {
      id: 'trialing',
      periodScoped: false,
      label: 'Trialing — contracted, converts later',
      cents: Number(causes.trialingCents ?? 0),
      action:
        'A trial settles $0 by design and is not a failure. It is counted in ' +
        'contracted MRR because the subscription is real, and excluded from ' +
        'the collecting figure because no invoice is due yet.',
    },
    {
      id: 'reversed',
      periodScoped: true,
      label: 'Refunded and charged back — a loss',
      cents: Number(causes.reversedCents ?? 0),
      action:
        'Money handed back. Stripe does not return its processing fee on a ' +
        'refund and a lost dispute costs a further fee on top, so a reversal ' +
        'costs more than the amount shown here — it is never a wash.',
    },
    {
      id: 'unbilledMetered',
      periodScoped: true,
      label: 'Metered usage measured but never invoiced',
      cents: Number(causes.unbilledMeteredCents ?? 0),
      action:
        'The nightly rollup priced this usage and the meter event never ' +
        'reached Stripe, so it was measured and never charged. This is a leak, ' +
        'not a timing difference — check Maintenance for a blocked sweep.',
    },
  ]
}
