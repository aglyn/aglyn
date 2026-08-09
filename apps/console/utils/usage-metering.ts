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
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

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

/** Platform markup on passed-through infra costs. */
export const METERED_MARKUP = 1.3

/**
 * Unit rates in USD — OUR marginal cost, before `METERED_MARKUP`.
 *
 * The published terms are "at cost + 30%", and the markup is applied to the
 * figures in THIS table, so a wrong rate here does not make us expensive, it
 * makes the published claim false. Corrected 2026-08-09 (AGL-1280).
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
 * - `perPageView` **0.0001** (2026-08-09) — folds bandwidth (~0.6 MB avg
 *   transfer at ~$0.15/GB, see `ESTIMATED_PAGE_TRANSFER_BYTES`) together with
 *   the Firestore reads behind a render. Measured against a real cold tenant
 *   page load — 24 requests, **627 KB encoded** — giving ~$0.000088 transfer +
 *   ~40 reads @ $3e-7 + edge/ISR ≈ **$0.000102**, i.e. +2%. This is the one
 *   well-calibrated rate; leave it alone.
 * - `perFormSubmission` **0.00005** (2026-08-09) — measured from
 *   `apps/tenant/app/api/forms/submit/route.ts`: ~12 Firestore reads, ~9
 *   writes, one ~0.4s function invocation. No email is sent
 *   (`notifyHostManagers` is in-app only) and there is no reCAPTCHA
 *   assessment — spam control is a honeypot plus a Firestore rate limiter.
 *   Was 0.0005, 8-13x over; the invoice corroborates it directly, since the
 *   whole platform's 2,790 July entity writes billed $0.000000.
 */
export const METERED_UNIT_RATES_USD = {
  storagePerGbMonth: 0.026,
  perPageView: 0.0001,
  perFormSubmission: 0.00005,
}

/**
 * Average transfer per page view (HTML + JS + a few images) used to turn
 * the analytics view counter into a bandwidth estimate — same assumption
 * the `perPageView` rate is built on.
 */
export const ESTIMATED_PAGE_TRANSFER_BYTES = 600 * 1024

/** One month of usage for a single host (from the per-host counters). */
export interface HostUsageSnapshot {
  storageBytes: number
  pageViews: number
  formSubmissions: number
}

/** What a plan includes before any of the three meters starts charging. */
export interface MeteredIncludedAllowance {
  /** Org-wide media/file storage, GB. */
  storageGb: number
  /** Page views the plan's bandwidth band covers. */
  pageViews: number
  /** Org-wide form submissions per month. */
  formSubmissions: number
  /** False when the plan hard-caps instead of metering (free, enterprise). */
  metered: boolean
}

/**
 * The plan's included bands, in the units the counters are kept in.
 *
 * Two conversions, both matching what the rest of the platform already does:
 *
 * - Storage and form submissions are per-SITE entitlements and the counters
 *   are summed across sites, so the org-wide band is `hostLimit ×` the
 *   per-site figure — the same expansion the usage-alerts cron uses for the
 *   media allowance. `hostLimit` (not the live site count) on purpose: the
 *   band is then a property of the plan alone, so the console estimate and
 *   the rollup compute an identical number without having to agree on how
 *   many sites existed at the moment each one ran.
 * - Bandwidth is published in GB but metered per page view, so the band is
 *   converted through `ESTIMATED_PAGE_TRANSFER_BYTES` — the same assumption
 *   `perPageView` is priced on, used in the other direction by usage-alerts.
 *
 * `UNLIMITED` bands are `Infinity`, which subtracts to zero billable usage
 * without a special case.
 */
export function meteredIncludedAllowance(
  org: Partial<AglynOrgBilling> | null | undefined,
): MeteredIncludedAllowance {
  const entitlements = resolveOrgEntitlements(org)
  const hostLimit = Math.max(1, entitlements.hostLimit)
  return {
    storageGb: (hostLimit * entitlements.storagePerHostMb) / 1024,
    pageViews:
      (entitlements.bandwidthGb * 1024 * 1024 * 1024) /
      ESTIMATED_PAGE_TRANSFER_BYTES,
    formSubmissions: hostLimit * entitlements.formSubmissionsPerMonth,
    metered: planMetersInfraOverage(org),
  }
}

export interface UsageCostEstimate {
  storageGb: number
  pageViews: number
  formSubmissions: number
  /** The bands subtracted before anything is priced. */
  included: MeteredIncludedAllowance
  /** Storage past the included band — the only part billed. */
  billableStorageGb: number
  /** Page views past the included band. */
  billablePageViews: number
  /** Form submissions past the included band. */
  billableFormSubmissions: number
  /**
   * Raw infra cost of ALL usage in USD — our COGS, which no included band
   * reduces. Unchanged by AGL-1280 because the cost model, the staff usage
   * views and the spike detector all mean "what did this org cost us".
   */
  costUsd: number
  /** Raw infra cost of the billable excess only. */
  billableCostUsd: number
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
  const storageBytes = hosts.reduce(
    (sum, host) => sum + Math.max(0, host.storageBytes || 0),
    0,
  )
  const pageViews = hosts.reduce(
    (sum, host) => sum + Math.max(0, host.pageViews || 0),
    0,
  )
  const formSubmissions = hosts.reduce(
    (sum, host) => sum + Math.max(0, host.formSubmissions || 0),
    0,
  )
  const storageGb = storageBytes / (1024 * 1024 * 1024)
  const included = meteredIncludedAllowance(org)
  const billableStorageGb = Math.max(0, storageGb - included.storageGb)
  const billablePageViews = Math.max(0, pageViews - included.pageViews)
  const billableFormSubmissions = Math.max(
    0,
    formSubmissions - included.formSubmissions,
  )
  const priced = (
    storage: number,
    views: number,
    submissions: number,
  ): number =>
    storage * METERED_UNIT_RATES_USD.storagePerGbMonth +
    views * METERED_UNIT_RATES_USD.perPageView +
    submissions * METERED_UNIT_RATES_USD.perFormSubmission
  const billableCostUsd = included.metered
    ? priced(billableStorageGb, billablePageViews, billableFormSubmissions)
    : 0
  return {
    storageGb,
    pageViews,
    formSubmissions,
    included,
    billableStorageGb,
    billablePageViews,
    billableFormSubmissions,
    costUsd: priced(storageGb, pageViews, formSubmissions),
    billableCostUsd,
    billedCents: Math.round(billableCostUsd * METERED_MARKUP * 100),
  }
}
