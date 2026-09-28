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

/*==========================================
 * THE CARDS AN ORDER ISSUED, WHEN ITS PAYMENT GOES BAD (AGL-3363).
 *
 * See "GIFT CARDS ARE A CASH-OUT" in `model/commerce-gift-cards.ts` for the
 * rules. This is the one place that applies them to the cards an order
 * minted — found by `orderId`, which the cart's completion stamps on every
 * card it issues (the order's id is its Checkout Session id) — so the
 * webhook's fraud-signal and dispute branches and the refund route share it.
 *
 * Every write is per card, in its own transaction, and best-effort: a card
 * that fails to freeze is logged and the rest carry on. The caller's money
 * movement (a refund that already left, a dispute Stripe already opened) is
 * never failed by this.
 *=========================================*/

import type { RiskEventInput } from '@aglyn/tenant-data-admin/server/risk-notice'
import type * as CommerceModel from '../model'

/** What happened to the payment that bought the cards. */
export type GiftCardRiskAction =
  | { kind: 'freeze'; reason: CommerceModel.GiftCardFreezeReason }
  /** A dispute won, or a merchant's release: lifts a freeze for `reason` only. */
  | { kind: 'release'; reason?: CommerceModel.GiftCardFreezeReason }
  | {
      kind: 'void'
      reason: CommerceModel.GiftCardVoidReason
      /**
       * Only the cards bought as these products, for a partial refund that
       * withdrew some lines. Absent voids every card the order issued. A card
       * issued before `productId` was stamped is voided only by a full void.
       */
      productIds?: readonly string[]
    }

/** A host document reference, as far as this module reads it. */
type HostRef = FirebaseFirestore.DocumentReference

const CARDS_PER_ORDER_READ = 500

/**
 * Apply `action` to every card `orderId` issued on `hostRef`. Returns how
 * many cards changed. Never throws.
 */
export async function applyGiftCardRiskToOrder(input: {
  firestore: FirebaseFirestore.Firestore
  hostRef: HostRef
  orderId: string
  action: GiftCardRiskAction
  nowMs?: number
}): Promise<number> {
  const { firestore, hostRef, orderId, action } = input
  if (!orderId) return 0
  const nowMs = input.nowMs ?? Date.now()
  let cards: FirebaseFirestore.QueryDocumentSnapshot[]
  try {
    const snapshot = await hostRef
      .collection('giftCards')
      .where('orderId', '==', orderId)
      .limit(CARDS_PER_ORDER_READ)
      .get()
    cards = snapshot.docs ?? []
  } catch (error) {
    console.error('[gift-card-risk] could not read the order’s cards', orderId, error)
    return 0
  }
  let changed = 0
  for (const card of cards) {
    try {
      const moved = await firestore.runTransaction(async (transaction) => {
        const fresh = await transaction.get(card.ref)
        const data = (fresh.data() ?? {}) as CommerceModel.HostGiftCard & {
          productId?: string
        }
        if (Number(data.voidedAtMs) > 0) return false
        if (action.kind === 'freeze') {
          if (Number(data.frozenAtMs) > 0) return false
          transaction.set(
            card.ref,
            { frozenAtMs: nowMs, frozenReason: action.reason },
            { merge: true },
          )
          return true
        }
        if (action.kind === 'release') {
          if (!(Number(data.frozenAtMs) > 0)) return false
          if (action.reason && data.frozenReason !== action.reason) return false
          transaction.set(
            card.ref,
            { frozenAtMs: null, frozenReason: null, releasedAtMs: nowMs },
            { merge: true },
          )
          return true
        }
        if (action.productIds) {
          if (!data.productId || !action.productIds.includes(data.productId)) {
            return false
          }
        }
        const balance = Math.max(0, Math.round(Number(data.balanceCents) || 0))
        transaction.set(
          card.ref,
          {
            balanceCents: 0,
            voidedAtMs: nowMs,
            voidedReason: action.reason,
            // What was taken back, so the merchant can see it and reissue by
            // hand if the reversal is itself reversed.
            voidedBalanceCents: balance,
          },
          { merge: true },
        )
        return true
      })
      if (moved) changed += 1
    } catch (error) {
      console.error('[gift-card-risk] card update failed', card.id, error)
    }
  }
  return changed
}

/** What a freeze's reason means, in the merchant's words. */
const FREEZE_CAUSE: Record<CommerceModel.GiftCardFreezeReason, string> = {
  'early-fraud-warning': 'the card issuer reported the payment as possibly fraudulent',
  'radar-review': 'the payment is being reviewed for fraud',
  dispute: 'the payment is disputed',
}

/** The notifier's shape: `notifyRiskEvent` from the admin barrel (AGL-3368). */
export type GiftCardHoldNotifier = (input: RiskEventInput) => Promise<unknown>

/**
 * Tell the site's managers, the workspace's owners and staff that an
 * order's gift cards were frozen (AGL-3363), through the risk notice seam
 * (AGL-3368). The owners read the catalog's `gift-card-hold` words — what
 * happened, and the two ways out: release the cards from Gift cards, or
 * refund the order — never a rule or a number. Never throws.
 */
export async function notifyGiftCardHold(
  input: {
    hostId: string
    /** The order as the merchant knows it: `order 1042`. */
    orderLabel: string
    /** The order's own dialog, where Refund lives. */
    orderPath?: string | null
    /** The order's id, so a redelivered signal notifies once. */
    orderId?: string | null
    cards: number
    reason: CommerceModel.GiftCardFreezeReason
  },
  notify: GiftCardHoldNotifier,
): Promise<void> {
  if (!input.hostId || input.cards <= 0) return
  await notify({
    kind: 'gift-card-hold',
    orgId: null,
    hostId: input.hostId,
    item: { label: input.orderLabel, path: input.orderPath ?? `/${input.hostId}/products/orders` },
    ...(input.orderId ? { dedupeKey: `gift-card-hold:${input.hostId}:${input.orderId}:${input.reason}` } : {}),
    staffEvidence:
      `${input.cards} gift card${input.cards === 1 ? '' : 's'} frozen: ${FREEZE_CAUSE[input.reason]}.`,
  }).catch(() => undefined)
}
