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
 * What a storefront sale's TAX decomposes to (AGL-1904) — the record that
 * makes tax collected on a merchant's sale visible to Aglyn's own return.
 *
 * ## The observation this module exists to record
 *
 * Every storefront checkout — cart, buy-now, subscription — creates its
 * Checkout Session on the PLATFORM account: platform secret key, no
 * `Stripe-Account` header, no `on_behalf_of`, with
 * `payment_intent_data[transfer_data][destination]` pointing at the merchant's
 * connected account. `cart-checkout.ts` and `checkout.ts` then set
 * `automatic_tax[enabled]` when the store's tax mode is `stripe`.
 *
 * That was long suspected to mean Stripe Tax computes the shopper's tax
 * against AGLYN's registrations rather than the merchant's. It was MEASURED on
 * 2026-08-18, in test mode, as a two-arm experiment on exactly that session
 * shape (a $100 line, a Texas shopper address, `transfer_data[destination]`
 * set):
 *
 *   - **Platform unregistered, destination connected account registered in
 *     TX** → `amount_tax: 0`, one breakdown line with
 *     `taxability_reason: "not_collecting"`, `taxable_amount: 0`.
 *   - **Platform registered in TX, everything else byte-identical** →
 *     `amount_tax: 825`, `taxability_reason: "standard_rated"`,
 *     `taxable_amount: 10000`, rate 8.25% "Texas".
 *
 * Both sessions reported `automatic_tax.liability: { type: "self" }` — Stripe's
 * own word for "the account this session was created on is the one liable".
 * `transfer_data[destination]` had no effect on tax in either arm.
 *
 * So on a `mode: 'stripe'` store the tax charged to the shopper is computed on
 * Aglyn's registration footprint, lands in Aglyn's platform balance, and is
 * Aglyn's to remit. The live platform account has held an ACTIVE Texas state
 * sales tax registration since 2026-08-17, so this is not hypothetical.
 *
 * **This module describes that mechanism and records the money. It states no
 * position on marketplace-facilitator status** — that is a legal conclusion
 * that attaches by operation of law, it belongs to counsel, and nothing here
 * should be read as deciding it.
 *
 * ## The two store modes are DIFFERENT FACTS and must never be summed
 *
 * `taxMode` is the whole point of this record, and it is derived from
 * `automatic_tax.enabled` — **never** from whether tax lines are present:
 *
 *   - **`stripe-automatic`** — Stripe Tax computed it, against whichever
 *     account `automatic_tax.liability` names. When that is `platform`, the
 *     money is held under Aglyn's registration.
 *   - **`manual`** — the merchant's own configured rate
 *     (`checkout.ts` / `pos-order.ts`), applied to the merchant's own declared
 *     origin. Aglyn's registrations never enter into it and the amount is not
 *     Aglyn's to remit.
 *
 * The trap that makes the `automatic_tax.enabled` discriminator load-bearing:
 * a MANUAL-mode subscription renewal carries a real Stripe Tax Rate (AGL-1751
 * attaches one so the tax recurs), so its invoice arrives with a populated
 * `total_taxes[]` — indistinguishable from a Stripe Tax invoice if you look at
 * the tax lines. Summing tax lines would silently book merchant-configured tax
 * as Aglyn-collected. **Read the flag, not the lines.**
 *
 * ## The taxable base is kept, never inferred
 *
 * `taxable_amount` is what a return reports as "taxable sales". Deriving it as
 * `amount ÷ rate` needs a live read to resolve the rate id and rounds wrong at
 * the edges, so it is stored when Stripe states it and left `null` when it
 * does not — and a row whose base cannot be read is COUNTED OUT LOUD by the
 * return rather than treated as a zero-base sale.
 *
 * A Checkout Session's `total_details.breakdown` is not in the webhook payload
 * and must be re-read with `expand[]=total_details.breakdown`; an invoice
 * carries `total_taxes[]` inline. Both land in the same `taxLines` shape.
 *
 * Pure and total: unreadable input answers `null`, never throws — a recording
 * failure must never 500 a webhook into redelivery.
 */

/** Which machinery produced the tax on this sale. See the module note. */
export type StorefrontTaxMode = 'stripe-automatic' | 'manual' | 'none'

/**
 * Whose registrations Stripe Tax computed against, from
 * `automatic_tax.liability.type`: `self` (the account the object lives on,
 * i.e. Aglyn's platform) or `account` (a named connected account).
 * Null whenever `taxMode` is not `stripe-automatic`.
 */
export type StorefrontTaxLiability = 'platform' | 'connected-account'

/** One entry of the stored tax breakdown. */
export interface StorefrontTaxLine {
  amountCents: number
  /** Stripe's stated reason, e.g. `standard_rated`, `not_collecting`. */
  taxabilityReason: string | null
  taxRateId: string | null
  /** Stripe's `taxable_amount`; null when the shape did not carry it. */
  taxableAmountCents: number | null
  /** e.g. `Texas` — from the expanded rate, for the working papers. */
  jurisdiction: string | null
  /** The rate's own state code, which is not the shopper's address. */
  rateState: string | null
  percentage: number | null
}

/** The per-transaction record `storefrontTaxCollected/{stripeId}` stores. */
export interface StorefrontTaxRow {
  /** `session` for one-time sales, `invoice` for subscription cycles. */
  kind: 'session' | 'invoice'
  hostId: string
  /** The commerce path — `commerce-cart`, `commerce-order`, … */
  metadataType: string | null
  taxMode: StorefrontTaxMode
  taxLiability: StorefrontTaxLiability | null
  /** The merchant's connected account, when the object names one. */
  connectedAccountId: string | null
  /** What the shopper actually paid, tax included. */
  grossCents: number
  taxCents: number
  /** Gross minus tax. NOT Aglyn's revenue — most of it is the merchant's. */
  netCents: number
  currency: string
  /** The jurisdiction input — the shopper's address on the Stripe object. */
  customerAddress: {
    country: string | null
    state: string | null
    city: string | null
    postalCode: string | null
  } | null
  taxLines: StorefrontTaxLine[]
  paidAt: Date | null
}

function asCents(value: unknown): number {
  const cents = Number(value ?? 0)
  return Number.isFinite(cents) ? Math.round(cents) : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function asNumberOrNull(value: unknown): number | null {
  const parsed = Number(value ?? NaN)
  return Number.isFinite(parsed) ? parsed : null
}

/** Seconds-since-epoch to Date, or null for anything unreadable. */
function asDate(value: unknown): Date | null {
  const seconds = Number(value ?? NaN)
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : null
}

function address(source: any): StorefrontTaxRow['customerAddress'] {
  if (!source || typeof source !== 'object') return null
  return {
    country: asStringOrNull(source.country),
    state: asStringOrNull(source.state),
    city: asStringOrNull(source.city),
    postalCode: asStringOrNull(source.postal_code),
  }
}

/**
 * The breakdown entries, from either shape.
 *
 * A Checkout Session expands them under `total_details.breakdown.taxes[]`
 * with the rate object inline; an invoice carries `total_taxes[]` (rate under
 * `tax_rate_details.tax_rate`) or the older `total_tax_amounts[]` (`tax_rate`,
 * an id or an expanded object). All three map onto one stored line.
 */
function taxLines(source: any): StorefrontTaxLine[] {
  const entries: any[] = Array.isArray(source?.total_details?.breakdown?.taxes)
    ? source.total_details.breakdown.taxes
    : Array.isArray(source?.total_taxes)
      ? source.total_taxes
      : Array.isArray(source?.total_tax_amounts)
        ? source.total_tax_amounts
        : []
  return entries.map((entry: any) => {
    const rate = entry?.rate ?? entry?.tax_rate_details?.tax_rate ?? entry?.tax_rate
    const rateObject = rate && typeof rate === 'object' ? rate : null
    // Distinguish an absent `taxable_amount` from a genuine zero: a zero base
    // is a real fact (`not_collecting`), an absent one means the base is
    // UNKNOWN, and the return has to be able to tell those apart.
    const taxableAmount = Number(entry?.taxable_amount ?? NaN)
    return {
      amountCents: asCents(entry?.amount),
      taxabilityReason: asStringOrNull(entry?.taxability_reason),
      taxRateId: asStringOrNull(rate) ?? asStringOrNull(rateObject?.id),
      taxableAmountCents: Number.isFinite(taxableAmount)
        ? Math.round(taxableAmount)
        : null,
      jurisdiction: asStringOrNull(rateObject?.jurisdiction),
      rateState: asStringOrNull(rateObject?.state),
      percentage:
        asNumberOrNull(rateObject?.effective_percentage) ??
        asNumberOrNull(rateObject?.percentage),
    }
  })
}

/** Sum of the stored lines' amounts. */
function sumLines(lines: readonly StorefrontTaxLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0)
}

export interface StorefrontTaxContext {
  kind: 'session' | 'invoice'
  hostId: string
  /**
   * The manual-mode tax `checkout.ts` puts over as an ordinary line item.
   * Stripe is never told it is tax, so no Stripe field carries it and the
   * session's own `metadata[taxCents]` is the only witness (AGL-1711).
   */
  manualTaxCents?: number
}

/**
 * Decomposes a paid storefront session or invoice into the stored row, or
 * `null` when there is no host to attribute it to.
 *
 * The caller decides WHICH objects reach this — the commerce webhook
 * self-selects on `metadata.type`, exactly as every other section does.
 */
export function storefrontTaxRow(
  object: unknown,
  context: StorefrontTaxContext,
): StorefrontTaxRow | null {
  const source = object as any
  const hostId = String(context?.hostId ?? '')
  if (!hostId) return null

  const automatic = source?.automatic_tax?.enabled === true
  const lines = automatic ? taxLines(source) : []
  const manualCents = Math.max(0, asCents(context?.manualTaxCents))
  // The flag, never the lines — see the module note. A manual-mode
  // subscription renewal carries real Stripe tax rates in `total_taxes[]`,
  // and booking those as Aglyn-collected would be the whole defect restated.
  const manualLineCents =
    !automatic && context.kind === 'invoice' ? sumLines(taxLines(source)) : 0
  const taxCents = automatic
    ? // `total_details.amount_tax` on a session, `total_taxes[]` on an
      // invoice. Prefer the summed lines when they exist (a computed invoice
      // can send a 0/null scalar beside a populated array — AGL-1811's
      // measurement), and fall back to the scalar shapes otherwise.
      lines.length > 0
      ? sumLines(lines)
      : asCents(source?.total_details?.amount_tax ?? source?.tax)
    : Math.max(manualCents, manualLineCents)

  const taxMode: StorefrontTaxMode = automatic
    ? 'stripe-automatic'
    : taxCents > 0
      ? 'manual'
      : 'none'

  const liabilityType = asStringOrNull(source?.automatic_tax?.liability?.type)
  const taxLiability: StorefrontTaxLiability | null = !automatic
    ? null
    : liabilityType === 'account'
      ? 'connected-account'
      : // `self`, and also an absent liability: Stripe omits the field on
        // older API versions, where the only account a session could be
        // liable under is the one it was created on — the platform.
        'platform'

  const grossCents = asCents(
    context.kind === 'invoice' ? source?.amount_paid : source?.amount_total,
  )
  const transferDestination =
    source?.payment_intent_data?.transfer_data?.destination ??
    source?.transfer_data?.destination
  return {
    kind: context.kind,
    hostId,
    metadataType:
      asStringOrNull(source?.metadata?.type) ??
      asStringOrNull(source?.subscription_details?.metadata?.type) ??
      asStringOrNull(source?.parent?.subscription_details?.metadata?.type),
    taxMode,
    taxLiability,
    connectedAccountId:
      asStringOrNull(transferDestination) ??
      asStringOrNull((transferDestination as any)?.id),
    grossCents,
    taxCents,
    netCents: grossCents - taxCents,
    currency: asStringOrNull(source?.currency) ?? 'usd',
    customerAddress:
      address(source?.customer_details?.address) ??
      address(source?.customer_address),
    // Manual tax has no Stripe-stated breakdown by construction, and an
    // invented one would be a base nobody computed. Empty is the honest
    // answer; the return counts a taxed row with no stated base out loud.
    taxLines: lines,
    paidAt:
      asDate(source?.status_transitions?.paid_at) ?? asDate(source?.created),
  }
}
