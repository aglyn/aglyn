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

// This module is imported from BOTH graphs — the Billing card (client) and
// three App Routes (`report-usage`, `usage-alerts`, `host-usage`) — so it may
// import neither entry barrel: `@aglyn/aglyn` carries the client-only React
// contexts, and `@aglyn/aglyn/server` carries the `node:stream` API adapter
// (AGL-405). The specific modules underneath are safe in both.
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation'
import {
  METERED_MARKUP,
  PAGE_VIEW_CDN_REQUEST_COST_USD,
  bandwidthGbFromPageViews,
  pageViewsFromBandwidthGb,
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { planQuotaOf } from '@aglyn/aglyn/plugin-manager/plugin-plan-entitlements'
import {
  meteredPluginBands,
  type ResolvedPluginMeteredBand,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'

/**
 * Usage metering (AGL-41): converts per-host counters into an estimated
 * monthly infra cost, billed to the org at cost × 1.30. Rates are OUR
 * unit costs (operator-tuned; validate against a real Firebase + Vercel
 * invoice month before enabling live metered billing). Pure data module —
 * shared by the Billing page estimate and the report-usage rollup route.
 *
 * AGL-1280 gave it the included bands. It used to price every GB, page view
 * and form submission from unit zero, while the published terms promised
 * only "usage beyond your plan's included storage, bandwidth, and form
 * submissions" was metered — so the code overcharged relative to the promise.
 * The bands come from `plan-entitlements`, the same source the three
 * already-published overage meters read, so the two can't drift.
 */

/**
 * Platform markup on passed-through infra costs — RE-EXPORTED, not defined
 * here (AGL-2194), the same move AGL-2155 made for the bandwidth helpers
 * below.
 *
 * The definition moved down to `@aglyn/aglyn/app-utils/plan-entitlements`
 * because `/pricing` publishes both a cost column and a "you pay (+30%)"
 * column for the three meters, and `tools/marketing/build-pricing-tables.mts`
 * has to generate both from code for `npm run check:pricing-tables` to be able
 * to fail on drift. That generator resolves no `@aglyn/*` alias, so it cannot
 * import this module. Re-exported so every console caller keeps importing it
 * from the module it always did — one definition, no drift, no import churn.
 */
export { METERED_MARKUP } from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * Unit rates in USD — OUR marginal cost, before `METERED_MARKUP`.
 *
 * The published terms are "at cost + 30%", and the markup is applied to the
 * figures in THIS table, so a wrong rate here does not make us expensive, it
 * makes the published claim false. Corrected 2026-08-09 (AGL-1280); the
 * page-view rate re-pegged 2026-09-09 (AGL-2711); page views and form
 * submissions re-priced at Vercel's DEAREST region 2026-10-01 (AGL-3444),
 * because the CDN bills in the region that serves a visitor and "at cost +
 * 30%" has to be true in every one of them. A page view billed past its
 * band also carries `PAGE_VIEW_CDN_REQUEST_COST_USD` — see
 * {@link METERED_OVERAGE_COST_USD} — which this table does not, because
 * `perPageView` here is the weight-proportional cost the COGS table shares.
 *
 * **Validated against LIST rates, not an invoice**, because no paid month
 * exists to measure: GCP's July 2026 invoice (5653085482) totalled **$0.03**
 * with every storage and egress SKU inside the free tier, and the Vercel team
 * is on **Hobby**, which produces no invoice at all. List rates are the honest
 * substitute — `docs/STRIPE_GO_LIVE.md` §5 step 5 still stands, and this table
 * must be re-validated once a real paid month exists.
 *
 * - `storagePerGbMonth` **0.026** (2026-08-09) — GCS Standard **US
 *   multi-region** list, the SKU actually on our invoice. Was 0.03, ~15% over.
 * - `perPageView` **0.00035471473** (2026-10-01, AGL-3444) — folds bandwidth
 *   (~1.0 MB avg transfer, see `ESTIMATED_PAGE_TRANSFER_BYTES`, which states
 *   this same page in bytes and moves only with this rate) together with the
 *   Firestore reads behind a render. The per-KB cost is the one AGL-1280 fixed
 *   on 2026-08-09 — a real cold tenant page load of 24 requests and **627 KB
 *   encoded** gave ~$0.000088 transfer at Vercel's cheapest $0.15/GB + ~40
 *   reads @ $3e-7 + edge/ISR ≈ **$0.000102**, i.e. $0.0001 within +2% — with
 *   its TRANSFER share re-priced at Vercel's dearest $0.35/GB: $0.20 more per
 *   GB of page, which on the 1012.8 KB basis is $0.00019317627 a view on top
 *   of the $0.00016153846 the cheapest region priced. The reads are GCP's and
 *   do not move with the region; the edge/ISR share (~$0.0000003 a view on
 *   the calibration page, 1.6× at the dearest region) sits inside the cent the
 *   billed rate rounds up to (see `PAGE_VIEW_CDN_REQUEST_COST_USD`).
 *
 *   The rate now prices a **1012.8 KB** page. A cold load of `aglyn.com/`
 *   settles at **976.1 KB** of first-party encoded bytes, measured on
 *   2026-09-09 against production v1.0.0-beta.103 — the build that carries
 *   the weight reduction the standing decision preferred over a re-peg. The
 *   reduction landed and the page is still well over the 627 KB the rate was
 *   calibrated for, so the re-peg is owed and taken.
 *
 *   The basis sits ABOVE the measurement on purpose: the meter prices 1.038×
 *   what the page weighs, so the next correction is downward, which is the
 *   direction a published price can move without re-consenting anybody. The
 *   measurement, the basis and the reasoning are in
 *   `tools/tenant-page-budget.json` under `wireCalibration`, and
 *   `npm run check:page-view-rate` fails if a later measurement pushes a
 *   published page back above the weight this rate is priced for.
 * - `perFormSubmission` **0.000053846154** (2026-10-01, AGL-3444) — measured
 *   from `apps/tenant/app/api/forms/submit/route.ts` on 2026-08-09: ~12
 *   Firestore reads, ~9 writes, one ~0.4s function invocation. No email is
 *   sent (`notifyHostManagers` is in-app only) and there is no reCAPTCHA
 *   assessment — spam control is a honeypot plus a Firestore rate limiter.
 *   Priced with the invocation at Vercel's DEAREST region and the whole
 *   0.4 s billed as active CPU, because nothing measured splits it from I/O
 *   wait: 0.4 s × $0.221/hour of CPU ($0.0000246) + 2 GB (the Pro default) ×
 *   0.4 s × $0.0183/GB-hour of memory ($0.0000041) + $0.60 per million
 *   invocations ($0.0000006), and the Firestore side at nam5 list — 12 reads
 *   × $0.0000006 + 9 writes × $0.0000018 ($0.0000234). $0.0000526 a
 *   submission, ×1.3 is $0.0684 per 1,000, rounded up to $0.07 and pinned
 *   so the billed figure lands on it: $0.07 ÷ 1.3 ÷ 1,000. The cheapest
 *   region's same ledger is $0.0000406, which is what the $0.00005 it
 *   replaced covered.
 */
export const METERED_UNIT_RATES_USD = {
  storagePerGbMonth: 0.026,
  perPageView: 0.00035471473,
  perFormSubmission: 0.000053846154,
}

/**
 * What one unit PAST the included band costs us — the basis the markup is
 * applied to, in USD.
 *
 * Storage and form submissions are the unit rates above. A page view past the
 * band also carries the CDN's per-request charge (AGL-1879): the platform's
 * request allowance is spent long before its transfer allowance, so a billed
 * view costs its weight AND its requests. See
 * `PAGE_VIEW_CDN_REQUEST_COST_USD` for the measurement and the arithmetic.
 *
 * `costUsd` on the rollup stays on {@link METERED_UNIT_RATES_USD}, the table
 * the COGS model shares; this one prices only what is billed.
 */
export const METERED_OVERAGE_COST_USD = {
  storagePerGbMonth: METERED_UNIT_RATES_USD.storagePerGbMonth,
  perPageView:
    METERED_UNIT_RATES_USD.perPageView + PAGE_VIEW_CDN_REQUEST_COST_USD,
  perFormSubmission: METERED_UNIT_RATES_USD.perFormSubmission,
}

/**
 * What a customer is CHARGED per unit past the included band: the overage
 * cost above times {@link METERED_MARKUP} — $0.0338/GB-month, $0.70 per 1,000
 * page views, $0.07 per 1,000 form submissions.
 *
 * The rate above is our cost; this is the published price, and they are three
 * decimal places apart. A billing surface that printed the cost table would be
 * quoting a number no invoice uses — the terms are "at cost + 30%", and the
 * customer-facing figure is the product, not the input.
 *
 * Derived rather than written out, so a rate correction moves both together.
 *
 * ⛔ **Three meters, and email is not a fourth.** Every figure in this table
 * is a cost passed through at `METERED_MARKUP`, and the published sentence
 * for it is "at cost + 30%" — so anything added here inherits that claim.
 * Email overage is a retail price on `PLAN_PRICING.extraEmailSendsUsdPer1k`
 * that descends with the tier, like contacts and API requests; it is not
 * derived from our cost and must never be quoted as though it were. Our
 * per-email cost lives in `ORG_COGS_UNIT_RATES_USD.perEmailSend`, which the
 * COGS model reads and no customer surface does.
 */
export const METERED_BILLED_RATES_USD = {
  storagePerGbMonth: METERED_OVERAGE_COST_USD.storagePerGbMonth * METERED_MARKUP,
  perPageView: METERED_OVERAGE_COST_USD.perPageView * METERED_MARKUP,
  perFormSubmission: METERED_OVERAGE_COST_USD.perFormSubmission * METERED_MARKUP,
}

/**
 * Bandwidth ⇄ page views — RE-EXPORTED, not defined here (AGL-2155).
 *
 * The definitions moved down to `@aglyn/aglyn/app-utils/plan-entitlements`
 * because the bandwidth abuse ceiling is evaluated in the TENANT app, at the
 * beacon that writes the page-view counter, and the tenant app cannot import
 * anything under `apps/console`. Re-exported from here so the console's three
 * routes and the Billing card keep importing them from the module they always
 * did — one definition, no drift, no import churn.
 *
 * @see checkBandwidthAbuseCeiling
 */
export {
  ESTIMATED_PAGE_TRANSFER_BYTES,
  pageViewsFromBandwidthGb,
  bandwidthGbFromPageViews,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * Org-wide monthly bandwidth from per-SITE page-view readings.
 *
 * The denominator is `entitlements.bandwidthGb`, which is an ORG-wide band —
 * unlike storage and form submissions it is not multiplied by `hostLimit`
 * (see `meteredIncludedAllowance`). The invoice sums every host in the org
 * before subtracting it (`report-usage` → `estimateMonthlyUsageCost`), and so
 * does the usage-alerts cron. The console meter did not: it rendered ONE
 * host's reading against the org-wide band, understating by up to `hostLimit`×
 * on every plan above Starter (AGL-1371). The numerator is summed here, once,
 * so all three read the same fraction.
 */
export function orgBandwidthGb(
  perHostPageViews: Array<number | null | undefined>,
): number {
  return bandwidthGbFromPageViews(
    perHostPageViews.reduce<number>(
      (sum, views) => sum + Math.max(0, Number(views) || 0),
      0,
    ),
  )
}

/**
 * Whether `month`'s invoice includes the ORG LIBRARY's stored bytes
 * (AGL-1473).
 *
 * Org DAM uploads move `orgs/{id}/counters/media`, and every consumer that
 * turns bytes into money summed host counters only — so those bytes have been
 * enforced against the storage cap and never priced. Metering them is a
 * correctness fix and ships unconditionally. CHARGING for bytes that have been
 * sitting in org libraries for months is a decision with an invoice attached,
 * so it waits behind this.
 *
 * **A start MONTH, not a boolean, and that is the whole design.** `report-usage`
 * takes `month` in its body and the daily cron re-sweeps any org-month without
 * `reportedAt`, so a boolean flipped mid-September would bill a re-run of
 * January at January's accumulated bytes — retroactively, against a month
 * already invoiced. A start month cannot reach backwards no matter when it is
 * set, which makes the no-backdating guarantee a property of the mechanism
 * rather than of anyone's care.
 *
 * TO TURN IT ON: set `BILL_ORG_LIBRARY_STORAGE_FROM` to the first month whose
 * invoice should include org-library bytes, as `YYYY-MM`, in the console
 * project's environment. Nothing else changes; the measurement, the audit
 * fields and the COGS figure are already live.
 *
 * FAILS CLOSED. Anything that is not a `YYYY-MM` — `true`, `1`, a date, a
 * typo — bills nothing. The alternative is charging customers because somebody
 * wrote `yes` in a field that wanted a month.
 */
export function billsOrgLibraryStorage(
  month: string,
  configuredStart: string | null | undefined,
): boolean {
  return billsFromMonth(month, configuredStart)
}

/**
 * Whether `month`'s invoice charges for email past the plan's included band.
 *
 * Same mechanism as {@link billsOrgLibraryStorage}, same reason, one meter
 * over. Email sends have been counted for a long time and priced for none of
 * it, and the included bands moved at the same time the rate arrived — so a
 * boolean would put a charge on a month whose mail was sent under a larger
 * allowance, for volume that no cap refused because transactional mail is
 * never refused.
 *
 * TO TURN IT ON: set `BILL_EMAIL_SEND_OVERAGE_FROM` to the first month whose
 * invoice should carry it, as `YYYY-MM`, in the console project's
 * environment. The rate, the measurement and the customer-facing readouts are
 * live without it; this decides only when money starts moving.
 *
 * FAILS CLOSED, identically.
 */
export function billsEmailSendOverage(
  month: string,
  configuredStart: string | null | undefined,
): boolean {
  return billsFromMonth(month, configuredStart)
}

/**
 * The start-month comparison both gates above are.
 *
 * One implementation because both are the same decision about different
 * money, and a second hand-written copy of a fail-closed parser is how the
 * two stop agreeing on what `true` means. `usage-budget.ts` carries a third
 * copy for Assist; it is left where it is because importing this module from
 * there would close a cycle.
 */
function billsFromMonth(
  month: string,
  configuredStart: string | null | undefined,
): boolean {
  const start = String(configuredStart ?? '').trim()
  if (!/^\d{4}-\d{2}$/.test(start)) return false
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  // Zero-padded fixed-width `YYYY-MM` orders identically as a string and as a
  // date; the format check above is what makes that true rather than lucky.
  return month >= start
}

/**
 * The plugin meters billed beside storage and bandwidth — each plugin band
 * declared `metered` (`meteredPluginBands`), in band order. Today that is
 * the forms plugin's submissions; the estimate below names none of them.
 */
export function meteredBands(): readonly ResolvedPluginMeteredBand[] {
  return meteredPluginBands()
}

/** One rate of a metered band, by the key its declaration names. */
function meteredRate(
  table: Readonly<Record<string, number>>,
  name: string,
  band: ResolvedPluginMeteredBand,
): number {
  const rate = table[band.metered.rate]
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(
      `metered band "${band.id}" names no rate in ${name}: ${band.metered.rate}`,
    )
  }
  return rate
}

/**
 * Our cost of one unit of a metered band: the `METERED_UNIT_RATES_USD` entry
 * its declaration names — the figure `costUsd` prices every unit at. A key the
 * table does not carry THROWS rather than pricing at zero — a meter that
 * bills nothing is the silent direction, and `usage-metering.spec.ts` holds
 * every declared key to a rate that exists.
 */
export function meteredUnitRateUsd(band: ResolvedPluginMeteredBand): number {
  return meteredRate(METERED_UNIT_RATES_USD, 'METERED_UNIT_RATES_USD', band)
}

/**
 * What one unit of a metered band PAST its band costs us, before markup: the
 * `METERED_OVERAGE_COST_USD` entry its declaration names, which
 * `billableCostUsd` prices the excess at.
 */
export function meteredOverageCostUsd(band: ResolvedPluginMeteredBand): number {
  return meteredRate(METERED_OVERAGE_COST_USD, 'METERED_OVERAGE_COST_USD', band)
}

/** What a customer is charged per unit of a metered band past its band. */
export function meteredBilledRateUsd(band: ResolvedPluginMeteredBand): number {
  return meteredOverageCostUsd(band) * METERED_MARKUP
}

/**
 * One host's month of every metered band, by band id, from its per-site
 * counters: `read(hostCounter)` answers the counter's `{month}` field.
 */
export function hostMeterReadings(
  read: (hostCounter: string) => unknown,
): Record<string, number> {
  return Object.fromEntries(
    meteredBands().map((band) => [
      band.id,
      Number(read(band.hostCounter) ?? 0),
    ]),
  )
}

/** One month of usage for a single host (from the per-host counters). */
export interface HostUsageSnapshot {
  storageBytes: number
  pageViews: number
  /**
   * Each metered band's month on this host, by band id (`hostMeterReadings`).
   * A band left out reads as zero — the org library, which serves no pages
   * and receives nothing, leaves them all out.
   */
  meters?: Readonly<Record<string, number>>
}

/** What a plan includes before any of the meters starts charging. */
export interface MeteredIncludedAllowance {
  /** Org-wide media/file storage, GB. */
  storageGb: number
  /** Page views the plan's bandwidth band covers. */
  pageViews: number
  /** Each metered band's org-wide monthly figure, by band id. */
  meters: Record<string, number>
  /** False when the plan hard-caps instead of metering (free, enterprise). */
  metered: boolean
}

/**
 * The plan's included bands, in the units the counters are kept in.
 *
 * Two conversions, both matching what the rest of the platform already does:
 *
 * - Storage, and every metered band declared per site (`perHost`), are
 *   per-SITE entitlements and the counters are summed across sites, so the
 *   org-wide band is `hostLimit ×` the per-site figure — the same expansion
 *   the usage-alerts cron uses for the media allowance. `hostLimit` (not the
 *   live site count) on purpose: the band is then a property of the plan
 *   alone, so the console estimate and the rollup compute an identical number
 *   without having to agree on how many sites existed at the moment each one
 *   ran.
 * - Bandwidth is published in GB but metered per page view, so the band is
 *   converted through `ESTIMATED_PAGE_TRANSFER_BYTES` — the same assumption
 *   `perPageView` is priced on, used in the other direction by usage-alerts.
 *
 * A metered band reads the entitlement its declaration names; one no plan
 * declares is nothing included (`planQuotaOf`). `UNLIMITED` bands are
 * `Infinity`, which subtracts to zero billable usage without a special case.
 */
export function meteredIncludedAllowance(
  org: Partial<AglynOrgBilling> | null | undefined,
): MeteredIncludedAllowance {
  const entitlements = resolveOrgEntitlements(org)
  const hostLimit = Math.max(1, entitlements.hostLimit)
  return {
    storageGb: (hostLimit * entitlements.storagePerHostMb) / 1024,
    pageViews: pageViewsFromBandwidthGb(entitlements.bandwidthGb),
    meters: Object.fromEntries(
      meteredBands().map((band) => [
        band.id,
        (band.perHost ? hostLimit : 1) *
          planQuotaOf(entitlements, band.entitlement),
      ]),
    ),
    metered: planMetersInfraOverage(org),
  }
}

export interface UsageCostEstimate {
  storageGb: number
  pageViews: number
  /** Each metered band's month, by band id, summed over the snapshots. */
  meters: Record<string, number>
  /** The bands subtracted before anything is priced. */
  included: MeteredIncludedAllowance
  /** Storage past the included band — the only part billed. */
  billableStorageGb: number
  /** Page views past the included band. */
  billablePageViews: number
  /** Each metered band past its included figure, by band id. */
  billableMeters: Record<string, number>
  /**
   * Raw infra cost of ALL usage in USD — our COGS, which no included band
   * reduces. Unchanged by AGL-1280 because the cost model, the staff usage
   * views and the spike detector all mean "what did this org cost us".
   */
  costUsd: number
  /**
   * What the billable excess costs us, before markup — priced on
   * {@link METERED_OVERAGE_COST_USD}, so a billed page view carries its CDN
   * requests as well as its weight. It can therefore exceed the matching
   * share of `costUsd`, which prices every view on weight alone.
   */
  billableCostUsd: number
  /**
   * What each meter contributes to the charge, in USD AFTER markup: storage,
   * page views, and each metered band under its id.
   *
   * They add up to `billableCostUsd × METERED_MARKUP` exactly — they are the
   * same products `billedCents` is rounded from, split out rather than
   * recomputed, so a surface can attribute the total to the meter that
   * caused it without running a second cost model. Zero on a plan that hard-
   * caps rather than metering, matching `billableCostUsd`.
   *
   * Not rounded to cents individually. `billedCents` rounds the SUM once, and
   * separately-rounded figures need not add to it; a caller showing these
   * must round for display and must not present the sum as the invoice
   * total, which `billedCents` already is.
   */
  billableUsdByMeter: {
    storage: number
    pageViews: number
    [bandId: string]: number
  }
  /**
   * What the org is billed: billable excess × METERED_MARKUP, whole cents.
   * Zero on a plan that hard-caps rather than metering.
   */
  billedCents: number
}

/**
 * Sums host snapshots and prices the month's OVERAGE at cost × markup.
 *
 * Each meter is independent: exceeding the storage band does not make page
 * views billable, and usage exactly at a band is free (the boundary belongs
 * to the customer).
 *
 * `org` is optional only so a caller can price a snapshot with no org in
 * hand; omitting it resolves as free, which meters nothing. That is the safe
 * default — an unknown org billing $0 is recoverable, billing it from unit
 * zero is not.
 */
export function estimateMonthlyUsageCost(
  hosts: HostUsageSnapshot[],
  org?: Partial<AglynOrgBilling> | null,
): UsageCostEstimate {
  const bands = meteredBands()
  const storageBytes = hosts.reduce(
    (sum, host) => sum + Math.max(0, host.storageBytes || 0),
    0,
  )
  const pageViews = hosts.reduce(
    (sum, host) => sum + Math.max(0, host.pageViews || 0),
    0,
  )
  const meters: Record<string, number> = Object.fromEntries(
    bands.map((band) => [
      band.id,
      hosts.reduce(
        (sum, host) => sum + Math.max(0, host.meters?.[band.id] || 0),
        0,
      ),
    ]),
  )
  const storageGb = storageBytes / (1024 * 1024 * 1024)
  const included = meteredIncludedAllowance(org)
  const billableStorageGb = Math.max(0, storageGb - included.storageGb)
  const billablePageViews = Math.max(0, pageViews - included.pageViews)
  const billableMeters: Record<string, number> = Object.fromEntries(
    bands.map((band) => [
      band.id,
      Math.max(0, meters[band.id]! - (included.meters[band.id] ?? 0)),
    ]),
  )
  // What the usage cost us, on the shared unit table the COGS model reads.
  const costed = (
    storage: number,
    views: number,
    units: Readonly<Record<string, number>>,
  ): number =>
    storage * METERED_UNIT_RATES_USD.storagePerGbMonth +
    views * METERED_UNIT_RATES_USD.perPageView +
    bands.reduce(
      (sum, band) => sum + (units[band.id] ?? 0) * meteredUnitRateUsd(band),
      0,
    )
  // What the excess costs us when it is billed, the basis of the markup.
  const priced = (
    storage: number,
    views: number,
    units: Readonly<Record<string, number>>,
  ): number =>
    storage * METERED_OVERAGE_COST_USD.storagePerGbMonth +
    views * METERED_OVERAGE_COST_USD.perPageView +
    bands.reduce(
      (sum, band) => sum + (units[band.id] ?? 0) * meteredOverageCostUsd(band),
      0,
    )
  const billableCostUsd = included.metered
    ? priced(billableStorageGb, billablePageViews, billableMeters)
    : 0
  // One meter's share of the charge, from the SAME `priced` call the total
  // uses — isolated multiplications here would be a second cost model to
  // drift from the first. Each is `priced` with every other dimension
  // zeroed, so the shares provably sum to `billableCostUsd`.
  const billableShareUsd = (
    storage: number,
    views: number,
    units: Readonly<Record<string, number>>,
  ): number =>
    included.metered ? priced(storage, views, units) * METERED_MARKUP : 0
  return {
    storageGb,
    pageViews,
    meters,
    included,
    billableStorageGb,
    billablePageViews,
    billableMeters,
    costUsd: costed(storageGb, pageViews, meters),
    billableCostUsd,
    billableUsdByMeter: {
      storage: billableShareUsd(billableStorageGb, 0, {}),
      pageViews: billableShareUsd(0, billablePageViews, {}),
      ...Object.fromEntries(
        bands.map((band) => [
          band.id,
          billableShareUsd(0, 0, { [band.id]: billableMeters[band.id]! }),
        ]),
      ),
    },
    billedCents: Math.round(billableCostUsd * METERED_MARKUP * 100),
  }
}
