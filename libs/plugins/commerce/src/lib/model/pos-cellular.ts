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

import {
  STRIPE_PROCESSOR_FEE_FIXED_USD,
  STRIPE_PROCESSOR_FEE_PCT,
} from '@aglyn/aglyn/app-utils/plan-entitlements'

/*==========================================
 * 4G FOR STRIPE READER S710s (AGL-4038).
 *
 * Stripe sells cellular service for the Stripe Reader S710 as a monthly
 * subscription per reader, billed to the Stripe account the reader is
 * registered to — which, for every reader a store sets up here, is the
 * PLATFORM's. A reader has it when the Terminal Location it is registered
 * to has a Configuration with `cellular[enabled]`; Stripe bills a reader for
 * every calendar month it had it at any time.
 *
 * So 4G is turned on for a STORE: the platform keeps one Location and one
 * Configuration per store (`pos-terminal.ts`), and the native apps' connection
 * tokens are scoped to that one Location, so a second, cellular Location for
 * some of a store's readers would be one those apps could never reach, and
 * moving a reader there takes a fresh pairing code. Every S710 at a store
 * with 4G on has it, and each one is charged.
 *
 * The store's workspace pays what the platform pays, passed through: per
 * S710 per calendar month, Stripe's cellular price, plus what collecting it
 * costs the platform (the card processing on the charge), with no markup.
 * Both are configuration, never literals here:
 *
 *   POS_CELLULAR_MONTHLY_COST_CENTS        Stripe's price per reader per
 *                                          month, in cents. Unset: 4G is not
 *                                          offered anywhere (hidden, not
 *                                          disabled).
 *   POS_CELLULAR_BILLING_COST_BPS          the processing percentage on the
 *                                          charge, in basis points (default:
 *                                          the platform's card rate)
 *   POS_CELLULAR_BILLING_COST_FIXED_CENTS  the processing fixed fee per
 *                                          charge (default: the platform's)
 *   STRIPE_PRODUCT_POS_CELLULAR            the product the invoice line is
 *                                          billed against (its tax code);
 *                                          `setup-stripe.mjs` makes it
 *
 * Billed in ARREARS, once per workspace per calendar month, on a one-off
 * invoice through core's usage-invoice charge — the same path a domain or
 * an AI overage takes — for the readers that had 4G at any time that month,
 * which is what Stripe bills the platform for. Turning 4G off stops the
 * charge from the next calendar month.
 *=========================================*/

export const POS_CELLULAR_ENV = {
  monthlyCostCents: 'POS_CELLULAR_MONTHLY_COST_CENTS',
  billingCostBps: 'POS_CELLULAR_BILLING_COST_BPS',
  billingCostFixedCents: 'POS_CELLULAR_BILLING_COST_FIXED_CENTS',
  productId: 'STRIPE_PRODUCT_POS_CELLULAR',
} as const

/** The platform's card processing rate, in basis points: the default billing cost. */
export const POS_CELLULAR_DEFAULT_BILLING_COST_BPS = Math.round(STRIPE_PROCESSOR_FEE_PCT * 10_000)

/** The platform's card processing fixed fee, in cents: the default billing cost. */
export const POS_CELLULAR_DEFAULT_BILLING_COST_FIXED_CENTS = Math.round(STRIPE_PROCESSOR_FEE_FIXED_USD * 100)

/** The Stripe device types that take cellular service: the S710, and its simulator. */
export const POS_CELLULAR_DEVICE_TYPES: readonly string[] = ['stripe_s710', 'simulated_stripe_s710']

/** The top-level, server-only record of each reader's 4G months. */
export const POS_CELLULAR_READERS_COLLECTION = 'posCellularReaders'

/** The top-level, server-only record of each workspace's monthly 4G charge. */
export const POS_CELLULAR_CHARGES_COLLECTION = 'posCellularCharges'

/** The metadata `kind` the charge's invoice carries. */
export const POS_CELLULAR_CHARGE_KIND = 'pos-cellular'

/** How many 4G periods a reader's record keeps: two years of on and off. */
export const POS_CELLULAR_MAX_PERIODS = 24

export interface PosCellularConfig {
  monthlyCostCents: number
  billingCostBps: number
  billingCostFixedCents: number
  productId: string
}

function wholeNumber(text: string | undefined, fallback: number, max: number): number | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return fallback
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value <= max ? value : null
}

/**
 * The deployment's 4G pricing, or null when 4G is not offered: no monthly
 * cost, no product, or a value that is not a whole number in range. A bad
 * value hides the feature rather than billing a guess.
 */
export function parsePosCellularConfig(
  env: Record<string, string | undefined> = process.env,
): PosCellularConfig | null {
  const costText = String(env[POS_CELLULAR_ENV.monthlyCostCents] ?? '').trim()
  if (!/^\d+$/.test(costText)) return null
  const monthlyCostCents = Number(costText)
  if (!Number.isSafeInteger(monthlyCostCents) || monthlyCostCents <= 0 || monthlyCostCents > 100_000) return null
  const productId = String(env[POS_CELLULAR_ENV.productId] ?? '').trim()
  if (!/^prod_[A-Za-z0-9]+$/.test(productId)) return null
  const billingCostBps = wholeNumber(env[POS_CELLULAR_ENV.billingCostBps], POS_CELLULAR_DEFAULT_BILLING_COST_BPS, 5_000)
  const billingCostFixedCents = wholeNumber(
    env[POS_CELLULAR_ENV.billingCostFixedCents],
    POS_CELLULAR_DEFAULT_BILLING_COST_FIXED_CENTS,
    1_000,
  )
  if (billingCostBps === null || billingCostFixedCents === null) return null
  return { monthlyCostCents, billingCostBps, billingCostFixedCents, productId }
}

/**
 * One workspace's 4G charge for a month, in whole cents: Stripe's price for
 * each reader, grossed up so that what the charge's own processing takes
 * leaves the platform exactly that:
 *
 *     ceil((readers × cost + fixed) / (1 − rate))
 *
 * Rounded up, the one direction that never bills below cost.
 * Zero readers is no charge.
 */
export function posCellularChargeCents(readers: number, config: PosCellularConfig): number {
  if (!Number.isSafeInteger(readers) || readers <= 0) return 0
  const passThrough = readers * config.monthlyCostCents + config.billingCostFixedCents
  return Math.ceil((passThrough * 10_000) / (10_000 - config.billingCostBps))
}

/**
 * What one reader costs a month, as the console shows it: a store's charge
 * for a single reader. More readers on one charge share its fixed fee, so
 * this is never less than any reader's share of a larger charge.
 */
export function posCellularReaderMonthlyCents(config: PosCellularConfig): number {
  return posCellularChargeCents(1, config)
}

/** Whether a reader of this Stripe device type can have 4G. */
export function isPosCellularDeviceType(deviceType: unknown): boolean {
  return typeof deviceType === 'string' && POS_CELLULAR_DEVICE_TYPES.includes(deviceType)
}

/** `2026-10` for a time in October 2026, in UTC. */
export function posCellularMonthKey(ms: number): string {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The calendar month before the one `ms` falls in. */
export function posCellularPreviousMonthKey(ms: number): string {
  const date = new Date(ms)
  return posCellularMonthKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
}

/** A month's first instant, and the next month's, in UTC; null for a key that is not one. */
export function posCellularMonthBounds(month: string): { startMs: number; endMs: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2]) - 1
  if (index < 0 || index > 11) return null
  return { startMs: Date.UTC(year, index, 1), endMs: Date.UTC(year, index + 1, 1) }
}

/** `October 2026`, for the invoice line. */
export function posCellularMonthLabel(month: string): string {
  const bounds = posCellularMonthBounds(month)
  if (!bounds) return month
  return new Date(bounds.startMs).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** One stretch of time a reader had 4G: from when it was turned on, to when it was turned off (open while it is on). */
export interface PosCellularPeriod {
  fromMs: number
  toMs: number | null
}

/**
 * `posCellularReaders/{hostId}_{readerId}`: one S710's 4G months, written
 * only by the server. No person is named on it: a workspace, a store, a
 * Stripe reader and its serial, and when it had 4G.
 */
export interface PosCellularReaderRecord {
  orgId: string
  hostId: string
  readerId: string
  serialNumber: string | null
  /** The store's Terminal Configuration that carries `cellular[enabled]`. */
  stripeConfigurationId: string | null
  enabled: boolean
  periods: PosCellularPeriod[]
  /** The last time a period was closed, which the month's charge queries by. */
  disabledAtMs: number | null
  updatedAtMs: number
}

/** The record's document id. */
export function posCellularReaderId(hostId: string, readerId: string): string {
  return `${hostId}_${readerId}`
}

/** The record with a period open from `now`, unless one already is. */
export function openPosCellularPeriod(
  base: Omit<PosCellularReaderRecord, 'enabled' | 'periods' | 'disabledAtMs' | 'updatedAtMs'>,
  existing: PosCellularReaderRecord | null,
  now: number,
): PosCellularReaderRecord {
  const periods = existing?.periods ?? []
  const open = periods.some((period) => period.toMs === null)
  return {
    ...base,
    enabled: true,
    periods: open ? periods : [...periods, { fromMs: now, toMs: null }].slice(-POS_CELLULAR_MAX_PERIODS),
    disabledAtMs: existing?.disabledAtMs ?? null,
    updatedAtMs: now,
  }
}

/** The record with its open period closed at `now`; unchanged when none is open. */
export function closePosCellularPeriod(existing: PosCellularReaderRecord, now: number): PosCellularReaderRecord {
  if (!existing.periods.some((period) => period.toMs === null) && !existing.enabled) return existing
  return {
    ...existing,
    enabled: false,
    periods: existing.periods.map((period) => (period.toMs === null ? { ...period, toMs: now } : period)),
    disabledAtMs: now,
    updatedAtMs: now,
  }
}

/** Whether a reader had 4G at any time in the month. */
export function posCellularBilledInMonth(
  record: Pick<PosCellularReaderRecord, 'periods'>,
  bounds: { startMs: number; endMs: number },
): boolean {
  return (record.periods ?? []).some(
    (period) => period.fromMs < bounds.endMs && (period.toMs === null || period.toMs > bounds.startMs),
  )
}

/** Each workspace's readers that had 4G in the month, by workspace. */
export function posCellularReadersByWorkspace(
  records: ReadonlyArray<PosCellularReaderRecord>,
  month: string,
): Map<string, { readers: number; hostIds: string[] }> {
  const bounds = posCellularMonthBounds(month)
  const byOrg = new Map<string, { readers: number; hostIds: string[] }>()
  if (!bounds) return byOrg
  for (const record of records) {
    if (!record.orgId || !posCellularBilledInMonth(record, bounds)) continue
    const entry = byOrg.get(record.orgId) ?? { readers: 0, hostIds: [] }
    entry.readers += 1
    if (!entry.hostIds.includes(record.hostId)) entry.hostIds.push(record.hostId)
    byOrg.set(record.orgId, entry)
  }
  return byOrg
}

/**
 * The outcome of a workspace's month: charged and paid; charged and left
 * open on their Billing page because the card failed; not charged because
 * there is no one to bill (no workspace, no customer) or nothing to bill
 * (under Stripe's minimum); or `charging`, claimed by a run in progress.
 */
export type PosCellularChargeState =
  | 'charging'
  | 'paid'
  | 'open'
  | 'failed'
  | 'no-workspace'
  | 'no-customer'
  | 'below-minimum'

/** States a later run never charges again. */
export const POS_CELLULAR_SETTLED_STATES: readonly PosCellularChargeState[] = [
  'paid',
  'open',
  'no-workspace',
  'no-customer',
  'below-minimum',
]

/** `posCellularCharges/{orgId}_{month}`: one workspace's 4G charge for one month. */
export interface PosCellularCharge {
  orgId: string
  month: string
  readers: number
  amountCents: number
  state: PosCellularChargeState
  invoiceId: string | null
  paidCents: number
  attempts: number
  createdAtMs: number
  updatedAtMs: number
}

/** What the POS devices card is told about 4G for a store; null hides it. */
export interface PosCellularView {
  /** What one reader costs a month, in cents, before any sales tax. */
  readerMonthlyCents: number
  enabled: boolean
  /** The store's readers that take 4G. */
  readers: number
}

/**
 * The 4G row of a store's POS devices card: shown only where 4G is offered
 * and the store has an S710, or already has 4G on (so it can be turned off).
 */
export function posCellularView(
  config: PosCellularConfig | null,
  terminal: { cellularEnabled?: unknown } | null | undefined,
  readers: ReadonlyArray<{ deviceType?: unknown }>,
): PosCellularView | null {
  if (!config) return null
  const enabled = terminal?.cellularEnabled === true
  const capable = readers.filter((reader) => isPosCellularDeviceType(reader.deviceType)).length
  if (!enabled && capable === 0) return null
  return { readerMonthlyCents: posCellularReaderMonthlyCents(config), enabled, readers: capable }
}
