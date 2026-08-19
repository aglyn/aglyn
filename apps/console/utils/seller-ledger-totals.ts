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
 * WHAT THE PUBLISHER WAS ACTUALLY PAID (AGL-2158).
 *
 * The seller panel's Sales card summed `amountCents` and `feeCents` over EVERY
 * sale and rendered `net = gross − fee`. That was wrong twice over.
 *
 * WRONG NUMBER. `amountCents` is the TAX-INCLUSIVE gross the buyer paid, while
 * `feeCents` is computed off the PRE-TAX price — AGL-1544 pays the seller a
 * fixed `payment_intent_data[transfer_data][amount]` rather than an
 * application fee precisely so the sales tax stays with the platform that owes
 * it. So `gross − fee` is `pretax + tax − fee`: the publisher's real payout
 * PLUS tax that was never theirs. On the worked example ($100 listing, 20%
 * rate, $8.25 tax) the card showed $88.25 against a transfer of $80.00.
 * `transferCents` — the exact amount Stripe moved to their Connect account —
 * was already on the purchase document and unused by this panel.
 *
 * WRONG SET. No refund or reversal filter, so a refunded sale and a lost
 * chargeback both still counted as earnings.
 *
 * NETTED, NOT MERELY FILTERED. A refunded sale leaves the payout total and
 * gets its own line. Dropping it silently would leave a publisher unable to
 * reconcile a total that shrank between two page loads — the same complaint in
 * a new shape.
 *
 * Extracted from the component so the arithmetic is testable without a render:
 * every number here is money, and the defect was arithmetic, not layout.
 */

export interface SellerLedgerSale {
  /** Tax-INCLUSIVE gross the buyer paid. */
  amountCents?: number
  /** Platform fee, computed off the PRE-TAX price. */
  feeCents?: number
  /** Sales tax, collected under Aglyn's marketplace-provider registration. */
  taxCents?: number
  /** What Stripe actually transferred to the publisher's Connect account. */
  transferCents?: number
  /** Stamped by a full refund or a lost dispute (AGL-1546/1554). */
  refundedAt?: unknown
  /** What the transfer reversal actually pulled back (AGL-1554/1995/2140). */
  reversedTransferCents?: number
}

export interface SellerLedgerTotals {
  /** Sales still standing. */
  paidCount: number
  /** Refunded or charged back. */
  refundedCount: number
  /** What reached the publisher's Stripe account, net of any pull-back. */
  netPaidCents: number
  /** Tax-inclusive gross on the sales still standing. */
  buyersPaidCents: number
  /** Tax on those sales — Aglyn's remittance liability, never the seller's. */
  salesTaxCents: number
  /** Platform fee on those sales. */
  platformFeeCents: number
  /** Pulled back out of the publisher's account on the refunded ones. */
  returnedCents: number
}

/**
 * The amount Stripe moved.
 *
 * The fallback covers purchase documents written before AGL-1544 added
 * `transferCents`, whose `amountCents` WAS the pre-tax price — so `amount −
 * fee` was the transfer back then, and is the honest reading of those rows.
 */
function transferOf(sale: SellerLedgerSale): number {
  return Number(
    sale.transferCents ??
      Number(sale.amountCents ?? 0) - Number(sale.feeCents ?? 0),
  )
}

export function summarizeSellerLedger(
  sales: readonly SellerLedgerSale[] | null | undefined,
): SellerLedgerTotals {
  const all = sales ?? []
  const paid = all.filter((sale) => !sale.refundedAt)
  const refunded = all.filter((sale) => Boolean(sale.refundedAt))
  const sum = (
    rows: readonly SellerLedgerSale[],
    of: (sale: SellerLedgerSale) => number,
  ) => rows.reduce((total, sale) => total + (Number(of(sale)) || 0), 0)
  return {
    paidCount: paid.length,
    refundedCount: refunded.length,
    // `reversedTransferCents` is SUBTRACTED rather than assumed to be the
    // whole transfer: a partial pull-back leaves the publisher the remainder,
    // and a reversal Stripe REFUSED (AGL-2140 records `reversalFailedAt` and
    // the money stays with the publisher pending recovery) leaves them all of
    // it. Summing the reversal that actually happened is true in every case.
    netPaidCents: sum(
      paid,
      (sale) => transferOf(sale) - Number(sale.reversedTransferCents ?? 0),
    ),
    buyersPaidCents: sum(paid, (sale) => Number(sale.amountCents ?? 0)),
    salesTaxCents: sum(paid, (sale) => Number(sale.taxCents ?? 0)),
    platformFeeCents: sum(paid, (sale) => Number(sale.feeCents ?? 0)),
    // What came back out of the PUBLISHER's account — not what the buyer got
    // back, which also contains Aglyn's fee and Aglyn's tax.
    returnedCents: sum(refunded, (sale) =>
      Number(sale.reversedTransferCents ?? 0),
    ),
  }
}
