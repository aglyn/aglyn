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
 * A merchant's `manual`-mode tax as a real Stripe Tax Rate (AGL-1953).
 *
 * ## Why this exists as its own module
 *
 * AGL-1751 built exactly this — mint a Tax Rate on the platform account, cache
 * it under the host — inline in `checkout.ts`, for subscriptions. AGL-1953
 * needed the same thing for the cart and draft-order paths, and a second copy
 * of a money-shaped cache is how two paths quietly diverge. One implementation,
 * three callers.
 *
 * ## Why a TAX RATE and not another line item
 *
 * Buy-now's one-time construction (AGL-1711) appends the tax as an ordinary
 * `line_items[1]` product line Stripe is never told is tax. That works there
 * because buy-now prices its discount INTO the unit amount, so nothing at
 * session level can touch the tax line afterwards.
 *
 * **The cart cannot use it.** The cart applies its discounts, coupons and gift
 * cards as real Stripe coupons at `discounts[0][coupon]`, and a session-level
 * coupon is spread across every line — including a fake tax line. The tax would
 * be discounted along with the goods, and the `metadata[taxCents]` snapshot
 * would then over-state what was actually collected.
 *
 * A real tax rate is applied by Stripe AFTER the discount, which is the
 * behaviour we want and which was MEASURED rather than assumed. Test mode, a
 * $100.00 line carrying an 8.25% rate plus a $30.00 `amount_off` coupon:
 *
 *   amount_subtotal 10000, amount_discount 3000, **amount_tax 578**,
 *   breakdown.taxes[0].taxable_amount **7000**
 *
 * 578 is 8.25% of the discounted 7000, not of the 10000 subtotal. Stripe
 * discounts first and taxes the remainder, so the arithmetic stays right with
 * no snapshot to keep in step — and `total_details.amount_tax` becomes a real
 * field, so the order's own decomposition needs no metadata witness at all.
 *
 * ## This does NOT make the sale Stripe Tax
 *
 * `automatic_tax.enabled` stays `false` (confirmed on the same measured
 * session), which is the discriminator `storefront-tax.ts` reads. A rate minted
 * here is the merchant's own configured percentage against their own declared
 * origin; Aglyn's registrations never enter into it and the money is not
 * Aglyn's to remit. Reading tax-LINE presence instead of the flag would book
 * this as Aglyn-collected, which is the AGL-1904 trap stated in that module.
 */

/**
 * The rate id for (percentage, label) on this host, minting and caching one on
 * first use. `null` means Stripe refused — the caller decides what that costs,
 * and for every current caller it is a visible 502 rather than a silent
 * untaxed sale.
 *
 * The rate is created on the PLATFORM account (no `Stripe-Account` header),
 * matching the session calls, because that is where the session lives — a
 * connected-account rate id would not resolve. Tax rates are immutable, so one
 * object exists per (percentage, label): a merchant who edits their zone rate
 * misses the cache and mints a fresh one, while the old object stays behind on
 * everything already carrying it, exactly as it should.
 */
export async function resolveManualTaxRateId(options: {
  /** `hosts/{hostId}` — the cache lives under it. */
  hostRef: any
  taxPct: number
  taxLabel: string
  /** Per-object idempotency header, derived by the caller (AGL-1714). */
  headers?: Record<string, string>
}): Promise<string | null> {
  const { hostRef, taxPct, taxLabel, headers = {} } = options
  if (!(taxPct > 0)) return null
  // ≤4 decimal places, which is all Stripe accepts on a tax rate.
  const percentage = Math.round(taxPct * 10000) / 10000
  const displayLabel = (taxLabel || `Tax (${percentage}%)`).slice(0, 50)
  const cacheKey = `p${Math.round(percentage * 10000)}-${encodeURIComponent(
    displayLabel,
  )}`
  const cacheRef = hostRef.collection('stripeTaxRates').doc(cacheKey)
  const cached = await cacheRef.get()
  const cachedId = String(cached.get('taxRateId') ?? '')
  if (cachedId) return cachedId

  const response = await fetch('https://api.stripe.com/v1/tax_rates', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams({
      display_name: displayLabel,
      percentage: String(percentage),
      inclusive: 'false',
    }).toString(),
  })
  const taxRate = (await response.json()) as { id?: string; error?: any }
  if (!response.ok || !taxRate.id) {
    console.error('Stripe tax rate error', taxRate.error)
    return null
  }
  // Best-effort: the rate exists either way, and two concurrent misses racing
  // this write just means one orphan rate on the dashboard.
  await cacheRef
    .set({
      taxRateId: String(taxRate.id),
      pct: percentage,
      label: displayLabel,
      createdAtMs: Date.now(),
    })
    .catch(() => undefined)
  return String(taxRate.id)
}
