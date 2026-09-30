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
 * The storefront's take on the operator's revenue report (AGL-2486, AGL-3080).
 *
 * Answered through the platform's revenue source contract
 * (`@aglyn/aglyn/plugin-manager/plugin-revenue-sources`). The report folds the
 * operator's own invoices; this is what storefront orders earned it — and the
 * one figure on that page most likely to be reported wrongly.
 *
 * An order's `feeCents` is the Connect `application_fee_amount`, which since
 * AGL-2152 is the advertised take PLUS Stripe's processing cost:
 *
 *     fee = take%(goods) + processing%(charge) + 30¢
 *
 * Every storefront charge is a DESTINATION charge, so Stripe moves the whole
 * amount to the merchant and debits its processing fee from the PLATFORM's
 * balance; the pass-through half of that fee exists purely to recover a cost
 * the platform has already paid. Reporting `feeCents` as earnings would
 * overstate the margin on every single storefront sale — and on a small order
 * it would report the 30¢ Stripe just took as money the platform made.
 *
 * So the pass-through is recomputed with the SAME helper the fee was charged
 * from (`saleProcessingCostCents`) and subtracted. Both halves are
 * reported, because "we collected X of which Y was Stripe's" is the sentence a
 * margin figure needs.
 *
 * The recomputation is an estimate in one direction only: it re-derives the
 * cost from the stored charge amount rather than reading Stripe's actual
 * balance-transaction fee, and it prices it at the DEAREST enabled payment
 * method's rate (BNPL, 6%) because that is the rate the fee was charged at.
 * A card-family order really costs 2.9%, so on those orders this subtracts
 * more than Stripe took and the take is UNDERSTATED — the safe direction, and
 * stated on the page rather than left to be discovered.
 *
 * ## Subscription cycles, and the one cycle this understates
 *
 * A storefront SUBSCRIPTION cycle carries a `subscriptionId`. Since AGL-2655
 * its fee carries the same pass-through, folded into
 * `application_fee_percent` as a rate because a Stripe subscription cannot
 * express a fixed 30¢ — so it is netted out here exactly as a one-time sale's
 * is. The percent is sized on the recurring goods and the recomputed cost here
 * is sized on the whole amount paid, tax included, so a taxed cycle subtracts
 * slightly more than was recovered: understated, the safe direction.
 *
 * A subscription sold before the pass-through existed is carried onto it by
 * the renewal re-price (AGL-2289) at its next paid invoice — but THAT invoice
 * was billed at the bare take, so its row's `feeCents` holds no pass-through
 * and the clamp reports its take as zero. One cycle per legacy subscription,
 * and the count beside the figure is how a reader sees how much of the book
 * that is.
 */

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { saleProcessingCostCents } from '@aglyn/aglyn/server'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { stripeIdIsTestMode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import {
  groupRevenueAttribution,
  type RevenueAttribution,
  type RevenueSource,
  type RevenueSourceAnswer,
} from '@aglyn/aglyn/plugin-manager/plugin-revenue-sources'

/** One `hosts/{hostId}/orders/{orderId}` row — a storefront sale. */
export interface CommerceOrderRowInput {
  id: string
  /** What the shopper paid, tax and shipping included. */
  amountCents?: unknown
  /**
   * The Connect `application_fee_amount`: the platform's advertised take PLUS
   * Stripe's processing cost passed through at cost (AGL-2152). NOT margin —
   * see the module note.
   */
  feeCents?: unknown
  /**
   * Present ONLY on a storefront SUBSCRIPTION renewal, and it changes how
   * `feeCents` must be read — see the module note.
   */
  subscriptionId?: unknown
  /** Merchant refunds AND chargebacks both land here (`refund.ts`). */
  refundedCents?: unknown
  /**
   * WHICH storefront the order belongs to — the attribution key.
   *
   * Orders live at `hosts/{hostId}/orders/{orderId}`, so this is lifted from
   * the document PATH by the reader rather than read from a field. It costs no
   * extra read and cannot disagree with where the document actually is.
   */
  hostId?: unknown
  createdAt?: unknown
  /**
   * Whether Stripe moved real money, stamped from `event.livemode` by the
   * webhook. Authoritative when present, and absent on every order written
   * before that stamp shipped — which is why {@link isTestModeOrderRow} falls
   * back to the id below rather than treating absence as an answer.
   */
  livemode?: unknown
  /**
   * The Checkout Session that produced the order. It carries its own mode
   * (`cs_test_…`), which a subscription renewal's invoice id does not — so
   * this is the fallback discriminator for rows predating `livemode`.
   */
  checkoutSessionId?: unknown
}

export interface CommerceSettled {
  transactionCount: number
  /** Shopper spend across storefronts. Overwhelmingly the merchant's. */
  grossCents: number
  /** The whole `application_fee_amount` the platform collected. NOT margin. */
  applicationFeeCents: number
  /** Stripe's processing cost this recovered, at cost. Subtracted, never earnings. */
  processingPassThroughCents: number
  /** Application fee minus the pass-through: the advertised take. */
  commissionCents: number
  /** Take handed back with refunds and chargebacks, pro-rata. */
  commissionRefundedCents: number
  /** Take net of reversals. */
  commissionNetCents: number
  /**
   * Storefront SUBSCRIPTION cycles in this period. Counted because a cycle
   * billed before its subscription was re-priced onto the pass-through
   * reports no take at all — see the module note.
   */
  subscriptionOrders: number
  /**
   * The sweep hit its ceiling, so every figure above is a LOWER BOUND and must
   * not be quoted as a total. Narrow the period instead.
   */
  truncated: boolean
}

/** Cents from anything, defaulting to 0 rather than NaN. */
function cents(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

/**
 * Whether this order row was a test-mode rehearsal.
 *
 * A recorded `livemode` wins, and the session id's prefix is the fallback for
 * rows written before anything recorded it. An order with neither signal is
 * LIVE: a POS cash sale carries no Stripe session at all, and answering "test"
 * for anything unidentifiable would erase genuine revenue from the report.
 */
function isTestModeOrderRow(row: CommerceOrderRowInput): boolean {
  if (typeof row.livemode === 'boolean') return !row.livemode
  return stripeIdIsTestMode(row.checkoutSessionId ?? row.id)
}

export function commerceSettledSummary(
  rows: readonly CommerceOrderRowInput[],
  truncated = false,
): CommerceSettled {
  const out: CommerceSettled = {
    transactionCount: 0,
    grossCents: 0,
    applicationFeeCents: 0,
    processingPassThroughCents: 0,
    commissionCents: 0,
    commissionRefundedCents: 0,
    commissionNetCents: 0,
    subscriptionOrders: 0,
    truncated: truncated === true,
  }
  for (const row of rows ?? []) {
    // A REHEARSAL IS NOT REVENUE. A smoke-test checkout writes a real order
    // document — Stripe never moved money for it, and its session id says so.
    // Skipped ENTIRELY rather than counted at zero, because `transactionCount`
    // is read as "how many sales", and a rehearsal is not one.
    if (isTestModeOrderRow(row)) continue
    const split = commerceOrderTake(row)
    out.transactionCount += 1
    out.grossCents += split.gross
    out.applicationFeeCents += split.fee
    if (split.isSubscriptionOrder) out.subscriptionOrders += 1
    out.processingPassThroughCents += split.passThrough
    out.commissionCents += split.take
    out.commissionRefundedCents += split.takeRefunded
    out.commissionNetCents += split.takeNet
  }
  return out
}

/**
 * One storefront order's take, in ONE place.
 *
 * Shared with the per-host attribution so a host table cannot sum to
 * something other than the storefront line above it.
 *
 * A zero-fee order contributes its gross and its count and nothing else —
 * there is no take to attribute, and inventing one from the gross would
 * report a merchant's money as the platform's.
 */
export function commerceOrderTake(row: CommerceOrderRowInput | null): {
  gross: number
  fee: number
  isSubscriptionOrder: boolean
  passThrough: number
  take: number
  takeRefunded: number
  takeNet: number
} {
  const gross = cents(row?.amountCents)
  const fee = Math.max(0, cents(row?.feeCents))
  const isSubscriptionOrder =
    typeof row?.subscriptionId === 'string' && row.subscriptionId.length > 0
  if (fee <= 0) {
    return {
      gross,
      fee,
      isSubscriptionOrder,
      passThrough: 0,
      take: 0,
      takeRefunded: 0,
      takeNet: 0,
    }
  }
  // Every fee bundles the recovery — a one-time sale's in cents, a
  // subscription cycle's as a rate (AGL-2655). Clamped to the fee itself: the
  // recomputed cost can exceed a fee charged under an older rate, and a
  // negative take would subtract from another order's real margin.
  const passThrough = Math.min(fee, saleProcessingCostCents(gross))
  const take = fee - passThrough
  const refunded = Math.min(gross, Math.max(0, cents(row?.refundedCents)))
  const takeRefunded = gross > 0 ? Math.round((refunded * take) / gross) : 0
  return {
    gross,
    fee,
    isSubscriptionOrder,
    passThrough,
    take,
    takeRefunded,
    takeNet: take - takeRefunded,
  }
}

/**
 * Storefront take by HOST.
 *
 * By host and not by org on purpose: one org can run several storefronts, and
 * "which store earns" is the question a per-org roll-up destroys.
 */
export function commerceHostAttribution(
  rows: readonly CommerceOrderRowInput[],
  limit = 100,
): RevenueAttribution {
  return groupRevenueAttribution(
    (rows ?? []).map((row) => {
      const split = commerceOrderTake(row)
      return {
        key: String(row?.hostId ?? ''),
        detail: '',
        gain: split.takeNet,
        loss: split.takeRefunded,
      }
    }),
    limit,
    'Host not recorded',
  )
}

/**
 * The storefront's answer for one period, from figures already folded. Pure,
 * so what the report prints can be proved from fixtures.
 *
 * `failed` is a sweep that could not run — a collection-group index this
 * deployment has not built answers FAILED_PRECONDITION — and it is reported as
 * a failure with figures of zero, never as a cap: "we read part of it" and "we
 * read none of it" have different remedies.
 */
export function commerceRevenueAnswer(read: {
  settled: CommerceSettled
  byHost: RevenueAttribution
  failed: boolean
}): RevenueSourceAnswer {
  const brand = PLATFORM_BRAND_NAME
  const { settled } = read
  return {
    id: 'commerce',
    name: 'storefront orders',
    earned: {
      label: 'Storefront commission',
      cents: Number(settled.commissionNetCents ?? 0),
      note:
        'The advertised take on merchant storefront sales, net of refunds — ' +
        'with Stripe’s card processing removed. The platform fee charged on a ' +
        'storefront sale bundles that processing cost and passes it through at ' +
        'cost; it is a recovery, not earnings.',
    },
    grossToNet: [
      {
        label: 'Storefront sales (shopper gross)',
        cents: settled.grossCents,
        deduction: false,
        note:
          'The merchant’s. It transfers straight to their connected account ' +
          'and is shown only for scale.',
      },
      {
        label: 'Storefront platform fee collected',
        cents: settled.applicationFeeCents,
        deduction: false,
        note: `Not all ${brand}’s — see the next line.`,
      },
      {
        label: '— less card processing passed through at cost',
        cents: settled.processingPassThroughCents,
        deduction: true,
        note: `Stripe’s. On a destination charge Stripe debits ${brand}’s balance for processing, and this half of the fee recovers exactly that. It is a recovery, not earnings, and reporting it as revenue would overstate every storefront sale.`,
      },
    ],
    notes:
      Number(settled.subscriptionOrders ?? 0) > 0
        ? [
            {
              label: `${settled.subscriptionOrders} storefront subscription cycles — one billed before its re-price reports no take`,
              tone: 'warning',
            },
          ]
        : [],
    attribution: [
      {
        id: 'byHost',
        heading: 'Storefront take by host',
        unit: 'Storefront',
        countLabel: 'Orders',
        empty: `No storefront order settled in this period. Note this is ${brand}'s take only — the shopper's spend is the merchant's money and is never counted here.`,
        chartEmpty: 'No storefront earned a take in this period — nothing to plot yet.',
        ...read.byHost,
      },
    ],
    attributionNote:
      "Storefront figures above are the advertised take with Stripe's " +
      'processing cost already subtracted, on the basis stated in “Gross ' +
      'versus net” below. Attribution is by host rather than by org because ' +
      'one org can run several storefronts, and rolling them up destroys the ' +
      'question.',
    truncated: settled.truncated,
    failure: read.failed
      ? {
          title: 'Storefront orders could not be read',
          detail:
            'The storefront commission below reads $0 because the query ' +
            'failed, not because there were no sales. The sweep needs the ' +
            'COLLECTION_GROUP index on orders.createdAtMs — check it is still ' +
            'declared in the Firestore index config and actually deployed, ' +
            'since indexes ship separately from the app.',
        }
      : null,
    summary: settled,
  }
}

/**
 * The storefront's source, registered on the console's API surface: the
 * staff revenue report awaits that surface before it asks.
 */
export const commerceRevenueSource: RevenueSource = {
  async read(request) {
    const firestore = firebaseAdmin.app().firestore()
    // Storefront orders live per host (`hosts/{hostId}/orders`), so this is a
    // collection-GROUP range — ranged on `createdAtMs`, the NUMBER, and not on
    // the `createdAt` Timestamp beside it. A collection-group range needs a
    // COLLECTION_GROUP-scoped single-field index — Firestore's automatic ones
    // are COLLECTION scope only — and the index that is declared and deployed
    // is on `createdAtMs` (AGL-1793). The `createdAt` form answers
    // FAILED_PRECONDITION on every request, which is how the report once read
    // $0 for every storefront.
    let swept: {
      docs: FirebaseFirestore.QueryDocumentSnapshot[]
      truncated: boolean
    } | null
    try {
      swept = await request.sweep<FirebaseFirestore.QueryDocumentSnapshot>(
        firestore
          .collectionGroup('orders')
          .where('createdAtMs', '>=', request.start.getTime())
          .where('createdAtMs', '<', request.end.getTime()),
        'createdAtMs',
      )
    } catch {
      swept = null
    }
    const rows: CommerceOrderRowInput[] = (swept?.docs ?? []).map((doc) => ({
      id: doc.id,
      // The storefront that earned the take is in the PATH.
      hostId: doc.ref.parent.parent?.id ?? '',
      ...(doc.data() as object),
    }))
    const settled = commerceSettledSummary(rows, swept?.truncated === true)
    const byHost = commerceHostAttribution(rows, request.attributionLimit)
    await request.nameRows(byHost.rows, {
      collection: 'hosts',
      nameField: 'displayName',
      detailField: 'subdomain',
    })
    return commerceRevenueAnswer({ settled, byHost, failed: swept === null })
  },
}
