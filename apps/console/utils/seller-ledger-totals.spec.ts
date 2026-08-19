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
 *
 * @jest-environment node
 */

/**
 * THE SELLER LEDGER SAID THE PUBLISHER EARNED MORE THAN STRIPE PAID THEM
 * (AGL-2158).
 *
 * The Sales card summed `amountCents` and `feeCents` over EVERY sale and
 * rendered `net = gross − fee`. `amountCents` is the TAX-INCLUSIVE gross while
 * `feeCents` is computed off the PRE-TAX price (AGL-1544), so that expression
 * is `pretax + tax − fee`: the payout plus sales tax that was never the
 * publisher's. And with no refund filter, refunded sales and lost chargebacks
 * counted as earnings.
 *
 * Every case below is stated in cents against the AGL-1639 worked example —
 * $100 listing, 20% platform rate, $8.25 tax — so that the old expression and
 * the new one produce visibly different numbers ($88.25 against $80.00) rather
 * than agreeing by accident on a tax-free row.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  summarizeSellerLedger,
  type SellerLedgerSale,
} from './seller-ledger-totals'

/** One $100 sale: gross 10825 incl. 825 tax, fee 2000, transfer 8000. */
const sale = (over: Partial<SellerLedgerSale> = {}): SellerLedgerSale => ({
  amountCents: 10825,
  feeCents: 2000,
  taxCents: 825,
  transferCents: 8000,
  ...over,
})

describe('summarizeSellerLedger (AGL-2158)', () => {
  it('reports the TRANSFER as net, not gross minus fee', () => {
    const totals = summarizeSellerLedger([sale()])
    // What Stripe moved to the Connect account.
    expect(totals.netPaidCents).toBe(8000)
    // The old expression, pinned so the difference is explicit: it would have
    // reported $88.25 — the payout plus $8.25 of Aglyn's sales tax.
    expect(10825 - 2000).toBe(8825)
    expect(totals.netPaidCents).not.toBe(8825)
  })

  it('breaks the buyer’s payment into the three parts that explain it', () => {
    const totals = summarizeSellerLedger([sale(), sale()])
    expect(totals).toMatchObject({
      paidCount: 2,
      buyersPaidCents: 21650,
      salesTaxCents: 1650,
      platformFeeCents: 4000,
      netPaidCents: 16000,
    })
    // The identity the card's copy asserts: buyers paid = tax + fee + payout.
    expect(
      totals.salesTaxCents + totals.platformFeeCents + totals.netPaidCents,
    ).toBe(totals.buyersPaidCents)
  })

  it('excludes a refunded sale from the payout and shows it separately', () => {
    const totals = summarizeSellerLedger([
      sale(),
      sale({ refundedAt: 'NOW', reversedTransferCents: 8000 }),
    ])
    expect(totals.paidCount).toBe(1)
    expect(totals.refundedCount).toBe(1)
    expect(totals.netPaidCents).toBe(8000)
    // Netted, not merely filtered: what came back out of the PUBLISHER's
    // account is its own line, so a total that shrank is reconcilable.
    expect(totals.returnedCents).toBe(8000)
    // And not the buyer's refund, which also contains Aglyn's fee and tax.
    expect(totals.returnedCents).not.toBe(10825)
  })

  it('excludes a lost chargeback the same way', () => {
    const totals = summarizeSellerLedger([
      sale({ refundedAt: 'NOW', reversedTransferCents: 8000 }),
    ])
    expect(totals.netPaidCents).toBe(0)
    expect(totals.buyersPaidCents).toBe(0)
  })

  it('leaves the publisher what a REFUSED reversal never took back', () => {
    // AGL-2140: `balance_insufficient` is a definitive 400, the reversal is
    // abandoned and recorded, and the money is still in the publisher's
    // account pending recovery. `returnedCents` must say 0, not 8000.
    const totals = summarizeSellerLedger([
      sale({
        refundedAt: 'NOW',
        reversedTransferCents: 0,
        reversalFailedAt: 'NOW',
      } as SellerLedgerSale),
    ])
    expect(totals.returnedCents).toBe(0)
  })

  it('subtracts a PARTIAL pull-back from a sale still standing', () => {
    // Belt and braces: a reversal without a refund stamp is unusual, and the
    // honest reading is the remainder, not the whole transfer.
    const totals = summarizeSellerLedger([
      sale({ reversedTransferCents: 3000 }),
    ])
    expect(totals.netPaidCents).toBe(5000)
  })

  it('reads a pre-AGL-1544 row, whose amount WAS the pre-tax price', () => {
    // No `transferCents` and no `taxCents`: back then `amount − fee` was the
    // transfer, so that is what those rows honestly mean.
    const totals = summarizeSellerLedger([
      { amountCents: 10000, feeCents: 2000 },
    ])
    expect(totals.netPaidCents).toBe(8000)
    expect(totals.salesTaxCents).toBe(0)
  })

  it('is all zeroes for no sales at all', () => {
    expect(summarizeSellerLedger([])).toMatchObject({
      paidCount: 0,
      refundedCount: 0,
      netPaidCents: 0,
      returnedCents: 0,
    })
    expect(summarizeSellerLedger(undefined).netPaidCents).toBe(0)
  })
})

describe('the Sales card renders the payout, not the old expression (AGL-2158)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'components', 'org-seller-panel.component.tsx'),
    'utf8',
  )

  it('delegates the arithmetic instead of restating it', () => {
    expect(source).toContain('summarizeSellerLedger(')
    // The expression that reported tax as earnings, and the unfiltered sums
    // that fed it.
    expect(source).not.toContain('(grossCents - feeCents)')
    expect(source).not.toContain('sum + (sale.amountCents ?? 0)')
  })

  it('carries the copy that explains the smaller number', () => {
    // A publisher who read `net $88.25` yesterday is owed the reason on the
    // card, not in a changelog.
    expect(source).toContain('Net paid out $')
    expect(source).toContain('what reached your Stripe account')
    expect(source).toContain('marketplace-provider')
  })
})
