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

import type { OrderPayment, OrderTotals } from '../model'
import type { PosOfflineFlag } from '../model/commerce-pos-offline'

/*==========================================
 * THE MONEY ON AN ORDER FOR A CARD TAKEN OFFLINE (AGL-4039).
 *
 * Pure: the offline sync settles the card with Stripe first, then hands the
 * result here and writes what comes back in the transaction that creates the
 * order. Kept out of `pos-offline-sync.ts` so the refund, dispute and
 * register-collection specs can build an order exactly as the sync writes it
 * without loading the sync's Firestore and Stripe dependencies.
 *
 * What a CAPTURED card writes, and why each field:
 *
 *  - `paymentIntentId`, `paymentIntentIds` and `paidAtMs` at the ORDER level,
 *    as the online register's completion writes them (`posCompletionPatch`).
 *    The refund route and the dispute lookup read the order-level fields; an
 *    intent kept only inside `payments[0]` leaves the order unrefundable and
 *    its chargeback matched to no order.
 *  - The payment's `amountCents` is what Stripe took (`intent.amount`), not
 *    the server's restated total. Where they differ the order is flagged
 *    `card-amount-differs` for the merchant to check against the receipt.
 *  - `totals.feeCents` is the whole fee the sale settled: the card's
 *    `application_fee_amount` (the take share plus Stripe's processing cost)
 *    as the online completion counts it, plus any shortfall invoiced below.
 *  - A FEE SHORTFALL: an intent the server first meets already `succeeded`
 *    (captured on the device, with no application fee) netted less than the
 *    tender rule's fee from the payout. The difference accrues to the org's
 *    month ledger (`orgs/{id}/offlineFees`), the same ledger a room charge's
 *    take accrues to, and the order is flagged `card-fee-short`.
 *
 * What an UNPAID card writes: `status: 'pending'` with the failed payment,
 * and the sale's plan take on `posTakeFeeCents` with the org it accrues to.
 * Collecting it later at the register reads that take, exactly as an open
 * sale does, so a later card, room charge or cash collection is charged by
 * the same tender rule as any other sale.
 *=========================================*/

export type PosOfflineCardSettled =
  | {
      kind: 'captured'
      intentId: string
      /** What Stripe charged, `intent.amount`. */
      amountCents: number
      /** What Stripe kept for the platform, `intent.application_fee_amount`. */
      feeCents: number
      /** What the tender rule says the platform's fee is on this charge. */
      expectedFeeCents: number
      /** The card tender's share of the plan's take. */
      takeShareCents: number
      livemode: boolean
      brand?: string
      last4?: string
    }
  | {
      kind: 'unpaid'
      flag: 'card-declined' | 'card-not-charged'
      intentId?: string
      message: string
      brand?: string
      last4?: string
    }

export interface PosOfflineCardOrderMoney {
  status: 'paid' | 'pending'
  /** The server's totals with the fee the sale settled. */
  totals: OrderTotals
  payment: OrderPayment
  /** Written at the order's top level beside the payment. */
  fields: Record<string, unknown>
  /** Cents to accrue to the org's month ledger with the order, 0 for none. */
  invoiceCents: number
  /** What the money adds to the sale's flags. */
  flags: PosOfflineFlag[]
}

const whole = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function posOfflineCardOrderMoney(input: {
  settled: PosOfflineCardSettled
  /** The server's totals for the sale, restated where the register's did not add up. */
  totals: OrderTotals
  /** The plan's take on the goods, before the tender rule. */
  planTakeCents: number
  soldAtMs: number
  nowMs: number
  cashierId: string
  /** The org the fees accrue to; '' when the site has none, and nothing accrues. */
  feeOrgId: string
}): PosOfflineCardOrderMoney {
  const { settled, soldAtMs, nowMs, cashierId, feeOrgId } = input
  const card = {
    ...(settled.intentId ? { paymentIntentId: settled.intentId } : {}),
    ...(settled.brand ? { cardBrand: settled.brand } : {}),
    ...(settled.last4 ? { last4: settled.last4 } : {}),
  }
  if (settled.kind === 'unpaid') {
    const planTakeCents = whole(input.planTakeCents)
    return {
      status: 'pending',
      totals: { ...input.totals, feeCents: 0 },
      payment: {
        id: 'pay_card_offline',
        method: 'card_present',
        amountCents: whole(input.totals.totalCents),
        status: 'failed',
        atMs: soldAtMs,
        takeFeeCents: 0,
        feeCents: 0,
        failureMessage: settled.message.slice(0, 300),
        ...card,
        cashierId,
      },
      fields: {
        posTakeFeeCents: planTakeCents,
        ...(feeOrgId ? { posFeeOrgId: feeOrgId } : {}),
      },
      invoiceCents: 0,
      flags: [settled.flag],
    }
  }
  const flags: PosOfflineFlag[] = []
  const amountCents = whole(settled.amountCents)
  if (amountCents !== whole(input.totals.totalCents)) flags.push('card-amount-differs')
  const nettedCents = whole(settled.feeCents)
  const shortfallCents = Math.max(0, whole(settled.expectedFeeCents) - nettedCents)
  if (shortfallCents > 0) flags.push('card-fee-short')
  const invoiceCents = feeOrgId ? shortfallCents : 0
  const feeCents = nettedCents + invoiceCents
  return {
    status: 'paid',
    totals: { ...input.totals, feeCents },
    payment: {
      id: 'pay_card_offline',
      method: 'card_present',
      amountCents,
      status: 'succeeded',
      atMs: soldAtMs,
      settledAtMs: nowMs,
      takeFeeCents: whole(settled.takeShareCents),
      feeCents: nettedCents,
      livemode: settled.livemode,
      ...card,
      cashierId,
    },
    fields: {
      ...(feeCents > 0
        ? { feeCollection: invoiceCents > 0 ? (nettedCents > 0 ? 'split' : 'invoice') : 'payout' }
        : {}),
      paymentIntentId: settled.intentId,
      paymentIntentIds: [settled.intentId],
      paidAtMs: soldAtMs,
      ...(settled.livemode === false ? { livemode: false } : {}),
    },
    invoiceCents,
    flags,
  }
}
