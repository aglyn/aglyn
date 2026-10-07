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
 * WHEN AN OUTSIDE TAX SERVICE PRICED A SALE (AGL-3631).
 *
 * A merchant may connect their own Avalara AvaTax or TaxJar account through
 * another plugin, which answers core's `core.tax-engine` contract. Commerce
 * asks it only where the store collects tax at its OWN rates (`mode:
 * 'manual'`, prices exclusive of tax): that is the regime where the merchant
 * is the one liable for the tax, so an engine of theirs answering for it
 * changes the arithmetic and not whose money it is. A Stripe Tax store is
 * never sent to an engine — that tax is computed against Aglyn's
 * registrations and is Aglyn's to remit (AGL-1904).
 *
 * The order's `taxMode` therefore stays what `storefrontTaxModeOf` says,
 * `manual` (or `none` at zero), and accounting posts it as tax the merchant
 * owes. What this module adds beside it is the `taxEngine` stamp: which
 * service answered, or that it was asked and did not, so the order says the
 * sale fell back to the store's own rates.
 *
 * Pure: no Firestore, no fetch. Imported by path, not through the model
 * barrel, so it costs the console bundle nothing.
 */

/** Which outside service priced a sale, or that it was asked and the sale fell back. */
export interface OrderTaxEngineStamp {
  /** The service's id, e.g. `avalara`. */
  provider: string
  /** Its name in the merchant's words, e.g. `Avalara AvaTax`. */
  providerLabel: string
  /** `quoted`: the service's tax was charged. `fallback`: the store's own rates were. */
  status: 'quoted' | 'fallback'
  /** Why it fell back: `timeout` or `error`; `null` when quoted. */
  reason: string | null
  /** Whether the service's test environment answered. */
  sandbox: boolean
}

/** Whether a store's tax settings let an outside service price its sales. */
export function storeTaxAllowsEngine(settings: {
  mode?: string
  pricesIncludeTax?: boolean
} | null | undefined): boolean {
  return settings?.mode === 'manual' && !settings.pricesIncludeTax
}

/**
 * The stamp as Checkout Session metadata, for the webhook that writes the
 * order to restate. Stripe caps a metadata value at 500 characters; these
 * are a few dozen.
 */
export function taxEngineSessionMetadata(
  stamp: OrderTaxEngineStamp | null | undefined,
): Record<string, string> {
  if (!stamp) return {}
  return {
    'metadata[taxEngine]': stamp.provider.slice(0, 40),
    'metadata[taxEngineLabel]': stamp.providerLabel.slice(0, 80),
    'metadata[taxEngineStatus]': stamp.status,
    ...(stamp.reason ? { 'metadata[taxEngineReason]': stamp.reason.slice(0, 40) } : {}),
    ...(stamp.sandbox ? { 'metadata[taxEngineSandbox]': 'true' } : {}),
  }
}

/** The stamp read back off a session's metadata, spread onto the order. */
export function taxEngineStampFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): { taxEngine?: OrderTaxEngineStamp } {
  const provider = String(metadata?.['taxEngine'] ?? '').trim()
  if (!provider) return {}
  const status = metadata?.['taxEngineStatus'] === 'quoted' ? 'quoted' : 'fallback'
  return {
    taxEngine: {
      provider,
      providerLabel: String(metadata?.['taxEngineLabel'] ?? '') || provider,
      status,
      reason: status === 'fallback' ? String(metadata?.['taxEngineReason'] ?? '') || 'error' : null,
      sandbox: metadata?.['taxEngineSandbox'] === 'true',
    },
  }
}

/** The stamp as the public order view carries it: `null` when no service was asked. */
export function orderTaxEngineView(value: unknown): OrderTaxEngineStamp | null {
  const stamp = (value ?? null) as Record<string, unknown> | null
  if (!stamp || typeof stamp['provider'] !== 'string' || !stamp['provider']) return null
  const status = stamp['status'] === 'quoted' ? 'quoted' : 'fallback'
  return {
    provider: stamp['provider'],
    providerLabel: String(stamp['providerLabel'] ?? '') || stamp['provider'],
    status,
    reason: status === 'fallback' ? String(stamp['reason'] ?? '') || 'error' : null,
    sandbox: stamp['sandbox'] === true,
  }
}

/**
 * Splits `totalCents` across `weights` so the parts sum exactly to the
 * total: each part floored, the leftover cents handed out by the largest
 * remainders. Stripe spreads a session coupon across lines in proportion to
 * their amounts; this is the same proportion, so a rate derived from it is
 * applied by Stripe to (within a cent) the amount it was derived from.
 */
export function allocateCentsByWeight(totalCents: number, weights: readonly number[]): number[] {
  const total = Math.max(0, Math.round(Number(totalCents) || 0))
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  if (sum <= 0 || total === 0) return clean.map(() => 0)
  const raw = clean.map((weight) => (total * weight) / sum)
  const parts = raw.map(Math.floor)
  let left = total - parts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .filter(({ index }) => clean[index] > 0)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length) {
    parts[order[i].index] += 1
    left -= 1
  }
  return parts
}

/**
 * A quoted tax as one PERCENTAGE per line, for the cart's hosted checkout.
 *
 * The cart charges tax through real Stripe Tax Rates on each line (AGL-1953)
 * because its discounts are session coupons Stripe spreads across every line,
 * and a rate is applied after them. An engine answers in cents per line, so
 * each line's cents become the rate that yields them on that line's
 * discounted amount, to Stripe's four decimal places — exact to the cent for
 * any line under $10,000. A line the engine taxed at zero, or one with
 * nothing left to tax, carries no rate (`null`).
 */
export function engineLineTaxPercentages(
  lines: ReadonlyArray<{ amountCents: number; taxCents: number }>,
  discountCents: number,
): Array<number | null> {
  const amounts = lines.map((line) => Math.max(0, Math.round(Number(line.amountCents) || 0)))
  const discounts = allocateCentsByWeight(
    Math.min(Math.max(0, discountCents), amounts.reduce((a, b) => a + b, 0)),
    amounts,
  )
  return lines.map((line, index) => {
    const net = amounts[index] - discounts[index]
    const tax = Math.max(0, Math.round(Number(line.taxCents) || 0))
    if (net <= 0 || tax <= 0) return null
    return Math.round((tax / net) * 100 * 10_000) / 10_000
  })
}
