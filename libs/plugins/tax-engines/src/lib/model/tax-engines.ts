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
 * The words both halves of the plugin share (AGL-3631): which engines exist,
 * what a connection looks like to a reader who may not see its secret, what
 * an exemption is, and the arithmetic every money figure goes through.
 *
 * Pure: no Firestore, no fetch, nothing a console card cannot import.
 */

/** The engines a merchant can connect. */
export const TAX_ENGINE_PROVIDERS = ['avalara', 'taxjar'] as const
export type TaxEngineProviderId = (typeof TAX_ENGINE_PROVIDERS)[number]

export const TAX_ENGINE_PROVIDER_LABELS: Readonly<Record<TaxEngineProviderId, string>> = {
  avalara: 'Avalara AvaTax',
  taxjar: 'TaxJar',
}

/** Which of the vendor's environments a connection talks to. */
export type TaxEngineEnvironment = 'sandbox' | 'production'

export function isTaxEngineProvider(value: unknown): value is TaxEngineProviderId {
  return (TAX_ENGINE_PROVIDERS as readonly unknown[]).includes(value)
}

/** A postal address, in the core contract's words. `country` is ISO-3166 alpha-2. */
export interface TaxEngineAddress {
  line1?: string
  line2?: string
  city?: string
  region?: string
  postalCode?: string
  country: string
}

/**
 * A connection as a member reads it: everything but the secret. The secret
 * (an AvaTax license key, a TaxJar API token) is sealed server-side and never
 * leaves the server, not even masked.
 */
export interface TaxEngineConnectionView {
  provider: TaxEngineProviderId
  providerLabel: string
  environment: TaxEngineEnvironment
  /** AvaTax only: the account the license key belongs to. */
  accountId: string | null
  /** AvaTax only: the company the transactions are filed under. */
  companyCode: string | null
  /** Where the store ships or sells from: the engine's origin address. */
  shipFrom: TaxEngineAddress | null
  /** Whether the engine itself confirmed `shipFrom`. */
  shipFromValidated: boolean
  /** The tax code for a product the merchant gave none. */
  defaultTaxCode: string | null
  /** Whether paid orders and refunds are recorded with the engine. */
  recordTransactions: boolean
  /** The last test's verdict and when. */
  lastTestOk: boolean
  lastTestAtMs: number | null
  lastError: string | null
  updatedAtMs: number
}

/**
 * Why a customer pays no tax, in the words both engines accept. AvaTax calls
 * these entity use codes; TaxJar names fewer kinds and folds the rest into
 * `other`.
 */
export const TAX_EXEMPTION_TYPES = [
  'wholesale',
  'government',
  'nonprofit',
  'education',
  'religious',
  'other',
] as const
export type TaxExemptionType = (typeof TAX_EXEMPTION_TYPES)[number]

export const TAX_EXEMPTION_TYPE_LABELS: Readonly<Record<TaxExemptionType, string>> = {
  wholesale: 'Resale or wholesale',
  government: 'Government',
  nonprofit: 'Charitable or nonprofit',
  education: 'Educational',
  religious: 'Religious',
  other: 'Other',
}

export function isTaxExemptionType(value: unknown): value is TaxExemptionType {
  return (TAX_EXEMPTION_TYPES as readonly unknown[]).includes(value)
}

/** An exempt customer as the merchant recorded them. */
export interface TaxExemptionView {
  id: string
  email: string
  name: string | null
  type: TaxExemptionType
  /** The certificate or exemption number, as printed on the certificate. */
  certificateNumber: string | null
  /** The states or regions the exemption covers; empty means everywhere. */
  regions: string[]
  updatedAtMs: number
}

/** How one order stands with the engine. */
export type TaxEngineTransactionStatus =
  /** Recording was asked and has not yet succeeded; the event retries it. */
  | 'pending'
  | 'committed'
  /** The engine refused, or every retry ran out. A person can retry. */
  | 'failed'
  | 'voided'

export interface TaxEngineTransactionView {
  orderId: string
  provider: TaxEngineProviderId
  providerLabel: string
  status: TaxEngineTransactionStatus
  /** The document's code at the engine: the order id. */
  code: string
  /** The tax recorded: what the shopper was charged. */
  taxCents: number
  refundedCents: number
  refunds: number
  /**
   * Why checkout charged the store's own rates instead of the service's
   * (`timeout`, `error`), or `null` when it charged the service's tax.
   */
  fallbackReason: string | null
  lastError: string | null
  updatedAtMs: number
}

/** A product tax code: letters, digits, dots and dashes, as both vendors print them. */
export const TAX_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.\-_]{0,24}$/

export function normalizeTaxCode(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase()
  return code && TAX_CODE_PATTERN.test(code) ? code : null
}

/** Trims an address and drops what is blank. `null` when it names no country. */
export function normalizeTaxAddress(value: unknown): TaxEngineAddress | null {
  const source = (value ?? {}) as Record<string, unknown>
  const text = (key: string, max = 100) => String(source[key] ?? '').trim().slice(0, max)
  const country = text('country', 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return null
  const address: TaxEngineAddress = { country }
  const line1 = text('line1')
  const line2 = text('line2')
  const city = text('city', 60)
  const region = text('region', 3).toUpperCase() || text('state', 3).toUpperCase()
  const postalCode = text('postalCode', 12)
  if (line1) address.line1 = line1
  if (line2) address.line2 = line2
  if (city) address.city = city
  if (region) address.region = region
  if (postalCode) address.postalCode = postalCode
  return address
}

/**
 * Whether an address is complete enough to be an engine's ORIGIN. Both
 * vendors calculate local tax from a street and a postal code, and a country
 * and state alone would quote the state rate without the city's.
 */
export function isCompleteShipFrom(address: TaxEngineAddress | null | undefined): boolean {
  return Boolean(
    address && address.country && address.line1 && address.city && address.postalCode &&
      (address.country !== 'US' || address.region),
  )
}

/** Cents to the vendors' decimal currency units, exactly. */
export function centsToUnits(cents: number): number {
  return Math.round(Number(cents) || 0) / 100
}

/** The vendors' decimal units to cents, rounded half away from zero. */
export function unitsToCents(units: unknown): number {
  const value = Number(units)
  if (!Number.isFinite(value)) return 0
  return Math.sign(value) * Math.round(Math.abs(value) * 100)
}

/**
 * Splits `totalCents` across `weights` so the parts sum EXACTLY to the total:
 * each part rounded down, then the leftover cents handed out by the largest
 * remainders. A zero or negative weight takes nothing; with no positive
 * weight at all, nothing is allocated and every part is zero.
 */
export function allocateCents(totalCents: number, weights: readonly number[]): number[] {
  const total = Math.round(Number(totalCents) || 0)
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  if (sum <= 0 || total === 0) return clean.map(() => 0)
  const sign = Math.sign(total)
  const magnitude = Math.abs(total)
  const raw = clean.map((weight) => (magnitude * weight) / sum)
  const parts = raw.map(Math.floor)
  let left = magnitude - parts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .filter(({ index }) => clean[index] > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length) {
    parts[order[i].index] += 1
    left -= 1
  }
  return parts.map((part) => part * sign)
}

/** `YYYY-MM-DD` in UTC, the date both vendors file a document under. */
export function taxDocumentDate(atMs: number): string {
  return new Date(Number.isFinite(atMs) ? atMs : Date.now()).toISOString().slice(0, 10)
}

/**
 * The store's Taxes setting as this plugin reads it (AGL-3693): commerce's
 * `hosts/{hostId}/settings/store` `tax` field, restated because a plugin
 * never imports another.
 */
export interface StoreTaxSettingsView {
  mode?: string
  pricesIncludeTax?: boolean
}

/**
 * Whether a connected service is used, and if not, why (AGL-3693). Mirrors
 * commerce's `storeTaxAllowsEngine`: a sale is quoted by the service only
 * when Taxes is on the store's own (manual) rates with prices that exclude
 * tax, and an order is recorded only when its sale was quoted, so on any
 * other setting the service neither prices a sale nor records one.
 */
export type TaxServiceUse =
  | { applies: true }
  | { applies: false; reason: 'stripe' | 'none' | 'undecided' | 'prices-include-tax' }

export function taxServiceUse(settings: StoreTaxSettingsView | null | undefined): TaxServiceUse {
  const mode = settings?.mode
  if (mode === 'manual') {
    return settings?.pricesIncludeTax ? { applies: false, reason: 'prices-include-tax' } : { applies: true }
  }
  if (mode === 'stripe') return { applies: false, reason: 'stripe' }
  if (mode === 'none') return { applies: false, reason: 'none' }
  return { applies: false, reason: 'undecided' }
}
