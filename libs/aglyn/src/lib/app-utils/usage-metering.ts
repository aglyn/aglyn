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
 * Usage metering (AGL-41): converts per-host counters into an estimated
 * monthly infra cost, billed to the tenant at cost × 1.30. Rates are OUR
 * unit costs (operator-tuned; validate against a real Firebase + Vercel
 * invoice month before enabling live metered billing). Pure data module —
 * shared by the Billing page estimate and the report-usage rollup route.
 */

/** Platform markup on passed-through infra costs. */
export const METERED_MARKUP = 1.3

/**
 * Unit rates in USD. `perPageView` folds together bandwidth (~0.6 MB avg
 * transfer at ~$0.15/GB) and the Firestore reads behind a render.
 */
export const METERED_UNIT_RATES_USD = {
  storagePerGbMonth: 0.03,
  perPageView: 0.0001,
  perFormSubmission: 0.0005,
}

/** One month of usage for a single host (from the per-host counters). */
export interface HostUsageSnapshot {
  storageBytes: number
  pageViews: number
  formSubmissions: number
}

export interface UsageCostEstimate {
  storageGb: number
  pageViews: number
  formSubmissions: number
  /** Raw infra cost estimate in USD. */
  costUsd: number
  /** What the tenant is billed: cost × METERED_MARKUP, in whole cents. */
  billedCents: number
}

/** Sums host snapshots and prices the month at cost × markup. */
export function estimateMonthlyUsageCost(
  hosts: HostUsageSnapshot[],
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
  const costUsd =
    storageGb * METERED_UNIT_RATES_USD.storagePerGbMonth +
    pageViews * METERED_UNIT_RATES_USD.perPageView +
    formSubmissions * METERED_UNIT_RATES_USD.perFormSubmission
  return {
    storageGb,
    pageViews,
    formSubmissions,
    costUsd,
    billedCents: Math.round(costUsd * METERED_MARKUP * 100),
  }
}
