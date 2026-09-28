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
 * Gift cards are a cash-out (AGL-3363).
 *
 * Before this, a gift card bought with a stolen card stayed spendable
 * through an issuer's fraud warning, a Radar review, a dispute and even a
 * refund: nothing in any of those paths touched `giftCards`. These cases
 * drive the real freeze, release and void over an in-memory store, and the
 * real availability rule a checkout asks, so "frozen" means a checkout
 * genuinely cannot redeem it.
 */

import {
  GIFT_CARD_PURCHASE_LIMITS,
  giftCardAvailableCents,
  giftCardPurchaseRefusal,
  giftCardSettlementCents,
} from '../model/commerce-gift-cards'
import { renderOwnerRiskNotice } from '@aglyn/shared-util-email/risk-notice-catalog'
import { applyGiftCardRiskToOrder, notifyGiftCardHold } from './gift-card-risk'

const NOW = 1_760_000_000_000

function store(cards: Record<string, Record<string, unknown>>) {
  const docs = new Map<string, Record<string, unknown>>(
    Object.entries(cards).map(([code, data]) => [code, { ...data }]),
  )
  const ref = (code: string) => ({
    id: code,
    get: async () => ({ id: code, exists: docs.has(code), data: () => docs.get(code) }),
  })
  const hostRef = {
    collection: (name: string) => {
      expect(name).toBe('giftCards')
      return {
        where: (field: string, _op: string, value: unknown) => ({
          limit: () => ({
            get: async () => ({
              docs: [...docs.entries()]
                .filter(([, data]) => data[field] === value)
                .map(([code]) => ({ id: code, ref: ref(code) })),
            }),
          }),
        }),
      }
    },
  }
  const firestore = {
    runTransaction: async (fn: (transaction: unknown) => Promise<unknown>) =>
      fn({
        get: (docRef: { get: () => Promise<unknown> }) => docRef.get(),
        set: (docRef: { id: string }, value: Record<string, unknown>) => {
          docs.set(docRef.id, { ...(docs.get(docRef.id) ?? {}), ...value })
        },
      }),
  }
  return { docs, hostRef: hostRef as never, firestore: firestore as never }
}

const ORDER = 'cs_test_order_1'

describe('a fraud signal freezes the cards its payment bought', () => {
  it('a frozen card offers nothing to a new checkout, and keeps its balance', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-A': { orderId: ORDER, balanceCents: 5000, productId: 'gift-50' },
      'GC-OTHER': { orderId: 'cs_other', balanceCents: 5000 },
    })
    expect(giftCardAvailableCents(docs.get('GC-A'), NOW)).toBe(5000)

    const changed = await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'freeze', reason: 'early-fraud-warning' },
      nowMs: NOW,
    })

    expect(changed).toBe(1)
    expect(docs.get('GC-A')?.['frozenReason']).toBe('early-fraud-warning')
    expect(docs.get('GC-A')?.['balanceCents']).toBe(5000)
    expect(giftCardAvailableCents(docs.get('GC-A'), NOW)).toBe(0)
    // Another order's card is untouched.
    expect(giftCardAvailableCents(docs.get('GC-OTHER'), NOW)).toBe(5000)
  })

  it('a hold placed before the freeze still settles: that shopper has paid', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-A': {
        orderId: ORDER,
        balanceCents: 5000,
        holds: { cs_spend: { cents: 2000, expiresAtMs: NOW + 60_000 } },
      },
    })
    await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'freeze', reason: 'radar-review' },
      nowMs: NOW,
    })
    expect(giftCardSettlementCents(docs.get('GC-A'), 'cs_spend', NOW)).toBe(2000)
  })

  it('a won dispute releases only the dispute’s freeze', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-DISPUTED': { orderId: ORDER, balanceCents: 5000, frozenAtMs: NOW, frozenReason: 'dispute' },
      'GC-WARNED': { orderId: ORDER, balanceCents: 5000, frozenAtMs: NOW, frozenReason: 'early-fraud-warning' },
    })
    await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'release', reason: 'dispute' },
      nowMs: NOW,
    })
    expect(giftCardAvailableCents(docs.get('GC-DISPUTED'), NOW)).toBe(5000)
    expect(giftCardAvailableCents(docs.get('GC-WARNED'), NOW)).toBe(0)
  })
})

describe('a reversal voids what is left on the cards', () => {
  it('a full refund or a lost dispute zeroes every card the order issued, never deleting it', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-A': { orderId: ORDER, balanceCents: 3000, productId: 'gift-50' },
      'GC-B': { orderId: ORDER, balanceCents: 5000 },
    })
    await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'void', reason: 'dispute-lost' },
      nowMs: NOW,
    })
    for (const code of ['GC-A', 'GC-B']) {
      expect(docs.get(code)?.['balanceCents']).toBe(0)
      expect(docs.get(code)?.['voidedReason']).toBe('dispute-lost')
    }
    expect(docs.get('GC-A')?.['voidedBalanceCents']).toBe(3000)
  })

  it('a partial refund voids only the cards bought by the withdrawn lines', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-50': { orderId: ORDER, balanceCents: 5000, productId: 'gift-50' },
      'GC-100': { orderId: ORDER, balanceCents: 10000, productId: 'gift-100' },
      'GC-LEGACY': { orderId: ORDER, balanceCents: 2500 },
    })
    await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'void', reason: 'refund', productIds: ['gift-50'] },
      nowMs: NOW,
    })
    expect(docs.get('GC-50')?.['balanceCents']).toBe(0)
    expect(docs.get('GC-100')?.['balanceCents']).toBe(10000)
    // A card issued before the line was stamped is voided only by a full void.
    expect(docs.get('GC-LEGACY')?.['balanceCents']).toBe(2500)
  })

  it('a voided card is never frozen or released back into use', async () => {
    const { docs, hostRef, firestore } = store({
      'GC-A': { orderId: ORDER, balanceCents: 0, voidedAtMs: NOW - 1 },
    })
    const changed = await applyGiftCardRiskToOrder({
      firestore,
      hostRef,
      orderId: ORDER,
      action: { kind: 'freeze', reason: 'dispute' },
      nowMs: NOW,
    })
    expect(changed).toBe(0)
    expect(docs.get('GC-A')?.['frozenAtMs']).toBeUndefined()
  })

  it('never throws when the cards cannot be read', async () => {
    const hostRef = {
      collection: () => {
        throw new Error('unavailable')
      },
    }
    await expect(
      applyGiftCardRiskToOrder({
        firestore: {} as never,
        hostRef: hostRef as never,
        orderId: ORDER,
        action: { kind: 'freeze', reason: 'dispute' },
      }),
    ).resolves.toBe(0)
  })
})

describe('a purchase has a ceiling', () => {
  it('a real shop’s gift order sits inside it (false-positive guard)', () => {
    // Ten $100 cards for a team, from an established shop.
    expect(giftCardPurchaseRefusal({ giftCardCents: 100_000, young: false })).toBeNull()
    // Five $100 cards from a young shop.
    expect(giftCardPurchaseRefusal({ giftCardCents: 50_000, young: true })).toBeNull()
  })

  it('refuses past the ceiling, lower while the workspace is young, without naming it', () => {
    const young = giftCardPurchaseRefusal({
      giftCardCents: GIFT_CARD_PURCHASE_LIMITS.perOrderCentsYoung + 1,
      young: true,
    })
    expect(young).toBeTruthy()
    expect(young).not.toMatch(/\d/)
    expect(
      giftCardPurchaseRefusal({
        giftCardCents: GIFT_CARD_PURCHASE_LIMITS.perOrderCentsYoung + 1,
        young: false,
      }),
    ).toBeNull()
    expect(
      giftCardPurchaseRefusal({
        giftCardCents: GIFT_CARD_PURCHASE_LIMITS.perOrderCents + 1,
        young: false,
      }),
    ).toBeTruthy()
  })
})

describe('notifyGiftCardHold', () => {
  it('tells the managers what happened and what to do, with no rule or number', async () => {
    const notify = jest.fn(async (_input: Record<string, unknown>) => undefined)
    await notifyGiftCardHold(
      { hostId: 'host-1', orderLabel: 'your order', cards: 2, reason: 'early-fraud-warning' },
      notify,
    )
    // One notice through the risk seam (AGL-3368): managers, owners, staff.
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({ kind: 'gift-card-hold', hostId: 'host-1' })
    const told = renderOwnerRiskNotice('gift-card-hold', { 'item.label': 'your order' })
    expect(told.steps.join(' ')).toMatch(/release the cards from Gift cards/)
    expect(Object.values(told).flat().join(' ')).not.toMatch(/\d/)
  })

  it('says nothing when no card changed', async () => {
    const notify = jest.fn(async () => undefined)
    await notifyGiftCardHold(
      { hostId: 'host-1', orderLabel: 'Order 1', cards: 0, reason: 'dispute' },
      notify,
    )
    expect(notify).not.toHaveBeenCalled()
  })
})
