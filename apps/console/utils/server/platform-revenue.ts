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
 * What one paid invoice on Aglyn's OWN account decomposes to (AGL-1811) —
 * the record a Texas sales tax return is filed from.
 *
 * Computing tax (AGL-1133/1537/1811) is half the obligation; the other half
 * is a per-transaction record of what was collected, and until this module
 * nothing kept one: the webhook mirrored plan/status onto the org and sent
 * a GA4 hit, and the marketplace ledger (`marketplacePurchases.taxCents`)
 * covers only marketplace-provider sales. Every one of Aglyn's own charges —
 * initial subscribe, renewal, proration, add-on change, enterprise net-30 —
 * lands as an `invoice.paid` event, so this is derived from the INVOICE, the
 * one object authoritative for all of those paths at once. Checkout sessions
 * are deliberately NOT a second source: a subscription checkout always
 * produces an invoice, and recording both would double-count the sale.
 *
 * ## The tax fields, measured against the live account rather than assumed
 *
 * Stripe has shipped three shapes: a `tax` scalar (older API versions),
 * `total_tax_amounts[]`, and `total_taxes[]` (current). The live account's
 * webhook version sends BOTH the scalar and `total_taxes[]` — on a computed
 * invoice the scalar can be 0/null while the array still carries the
 * breakdown entries, so the array is read FIRST and the scalar is only a
 * fallback for old shapes that carry nothing else. `total_taxes[]` is also
 * the only shape that says WHY (`taxability_reason`, e.g.
 * `taxable_basis_reduced` for the TX 80% data-processing base) and against
 * WHAT rate — which is what makes the stored row auditable against the
 * filed position, not just summable.
 *
 * Pure and total: bad input answers `null`, never throws — a recording
 * failure must never 500 a billing webhook into redelivery.
 */

/** One entry of the stored tax breakdown. */
export interface PlatformRevenueTaxLine {
  amountCents: number
  /** Stripe's stated reason — `taxable_basis_reduced` is the 80% base. */
  taxabilityReason: string | null
  /** The tax rate id, resolvable to a jurisdiction in the dashboard. */
  taxRateId: string | null
  /**
   * The base the rate was applied to — Stripe's `taxable_amount`, which under
   * the TX data-processing position is 80% of the charge. This is the
   * "taxable sales" figure a return reports directly; without it the base
   * must be re-derived as `amount ÷ rate`, which needs a live Stripe read to
   * resolve the rate id. Null when the event's shape did not carry it —
   * `taxReturnSummary` counts such rows out loud rather than guessing.
   */
  taxableAmountCents: number | null
}

/** The per-transaction revenue record `platformRevenue/{invoiceId}` stores. */
export interface PlatformRevenueRecord {
  invoiceId: string
  subscriptionId: string | null
  stripeCustomerId: string | null
  /** What actually arrived — `amount_paid`, credit balance applied and all. */
  grossCents: number
  /** What the invoice billed — differs from gross when credit covered part. */
  totalCents: number
  taxCents: number
  /** Gross minus tax — Aglyn's revenue; the tax is held for the state. */
  netCents: number
  currency: string
  /** False marks an invoice billed before its subscription gained tax. */
  automaticTax: boolean
  /** The jurisdiction input — the buyer's billing address on the invoice. */
  customerAddress: {
    country: string | null
    state: string | null
    city: string | null
    postalCode: string | null
  } | null
  taxLines: PlatformRevenueTaxLine[]
  /** Stripe's payment timestamp; the return period this row files under. */
  paidAt: Date | null
}

/** Sum of an `[{ amount }]` list, ignoring anything unreadable. */
function sumAmounts(
  list: readonly { amount?: unknown }[] | null | undefined,
): number {
  return (list ?? []).reduce((sum: number, entry) => {
    const amount = Number(entry?.amount ?? 0)
    return sum + (Number.isFinite(amount) ? amount : 0)
  }, 0)
}

function asCents(value: unknown): number {
  const cents = Number(value ?? 0)
  return Number.isFinite(cents) ? Math.round(cents) : 0
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** Seconds-since-epoch to Date, or null for anything unreadable. */
function asDate(value: unknown): Date | null {
  const seconds = Number(value ?? NaN)
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : null
}

/**
 * The breakdown entries, whichever generation of the field the event carries.
 *
 * `total_taxes[]` nests the rate under `tax_rate_details.tax_rate`;
 * `total_tax_amounts[]` carried it as `tax_rate` (an id, or an expanded
 * object). Both map onto the same stored line.
 */
function taxLines(invoice: any): PlatformRevenueTaxLine[] {
  const entries: any[] = Array.isArray(invoice?.total_taxes)
    ? invoice.total_taxes
    : Array.isArray(invoice?.total_tax_amounts)
      ? invoice.total_tax_amounts
      : []
  return entries.map((entry: any) => {
    const rate = entry?.tax_rate_details?.tax_rate ?? entry?.tax_rate
    // Both generations carry `taxable_amount`; distinguish an absent field
    // from a genuine zero so the return summary can say which rows cannot
    // state their base rather than treating them as zero-base sales.
    const taxableAmount = Number(entry?.taxable_amount ?? NaN)
    return {
      amountCents: asCents(entry?.amount),
      taxabilityReason: asStringOrNull(entry?.taxability_reason),
      taxRateId:
        asStringOrNull(rate) ?? asStringOrNull((rate as any)?.id) ?? null,
      taxableAmountCents: Number.isFinite(taxableAmount)
        ? Math.round(taxableAmount)
        : null,
    }
  })
}

/**
 * Decomposes a paid invoice into the stored revenue record, or `null` when
 * the object carries no invoice id (nothing to key the row by).
 *
 * The caller decides WHOSE invoice this is — the webhook only records
 * invoices whose customer resolves through the `stripeCustomers` index,
 * which `writeOrgBilling` stamps for Aglyn's own billing customers and
 * nothing else stamps. A tenant store's shopper or a marketplace buyer
 * never appears in it, so their charges never reach this record.
 */
export function platformInvoiceRevenue(
  invoice: unknown,
): PlatformRevenueRecord | null {
  const source = invoice as any
  const invoiceId = asStringOrNull(source?.id)
  if (!invoiceId) return null

  const lines = taxLines(source)
  const scalarTax = Number(source?.tax ?? NaN)
  // The breakdown first; the scalar only when no array said anything —
  // measured on the live account, where a computed invoice sends `tax: 0`
  // or `tax: null` BESIDE a populated `total_taxes[]`.
  const taxCents =
    lines.length > 0
      ? sumAmounts(lines.map((line) => ({ amount: line.amountCents })))
      : Number.isFinite(scalarTax) && scalarTax > 0
        ? Math.round(scalarTax)
        : 0

  const grossCents = asCents(source?.amount_paid)
  const address = source?.customer_address
  const subscription = source?.subscription
  const customer = source?.customer
  return {
    invoiceId,
    subscriptionId:
      asStringOrNull(subscription) ?? asStringOrNull(subscription?.id),
    stripeCustomerId: asStringOrNull(customer) ?? asStringOrNull(customer?.id),
    grossCents,
    totalCents: asCents(source?.total),
    taxCents,
    netCents: grossCents - taxCents,
    currency: asStringOrNull(source?.currency) ?? 'usd',
    automaticTax: source?.automatic_tax?.enabled === true,
    customerAddress:
      address && typeof address === 'object'
        ? {
            country: asStringOrNull(address.country),
            state: asStringOrNull(address.state),
            city: asStringOrNull(address.city),
            postalCode: asStringOrNull(address.postal_code),
          }
        : null,
    taxLines: lines,
    paidAt:
      asDate(source?.status_transitions?.paid_at) ?? asDate(source?.created),
  }
}
