/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo site's promotions (AGL-3966), so the Aglyn app's Discounts,
 * Coupons and Gift cards screens show rows rather than an empty state:
 *
 * - `hosts/{hostId}/discounts`: the discounts engine's documents
 *   (`HostDiscount`, commerce-discounts.ts): a code, an automatic sale, free
 *   shipping over a minimum, and one switched off, as the discounts card
 *   writes them (an automatic discount's code is `null`).
 * - `hosts/{hostId}/coupons/{CODE}`: the legacy percent coupons, as
 *   host-coupons-card.component.tsx writes them.
 * - `hosts/{hostId}/giftCards/{code}`: cards as `gift-card-issue.ts` issues
 *   them, with the `searchTokens` and `createdAtMs` the Gift cards list asks
 *   by. The Pro plan leaves gift cards out, so the app shows the plan notice
 *   over them until the workspace's plan carries the feature.
 */

import { giftCardSearchTokens } from '../backfill-gift-card-search-tokens.mjs'

const DAY = 24 * 60 * 60_000

export async function seedPromotions({ put, uid, hostId, now: date }) {
  const now = date.getTime()

  const discounts = [
    ['seed-discount-welcome', { code: 'WELCOME10', name: 'Welcome 10%', kind: 'percent', valuePct: 10, enabled: true, redemptions: 14 }],
    [
      'seed-discount-fall',
      { code: null, name: 'Fall sale', kind: 'percent', valuePct: 15, enabled: true, redemptions: 32, startAtMs: now - 5 * DAY, endAtMs: now + 9 * DAY },
    ],
    [
      'seed-discount-shipping',
      { code: null, name: 'Free shipping over $50', kind: 'free_shipping', minSubtotalCents: 5000, enabled: true, redemptions: 21 },
    ],
    [
      'seed-discount-mugs',
      { code: 'MUG5', name: '$5 off mugs', kind: 'fixed', valueCents: 500, productIds: ['p-mug'], maxRedemptions: 50, enabled: false, redemptions: 50 },
    ],
  ]
  for (const [id, fields] of discounts) {
    await put(`hosts/${hostId}/discounts/${id}`, { ...fields, createdAt: new Date(now - 20 * DAY) })
  }

  const coupons = [
    ['LAUNCH20', { percentOff: 20, enabled: true, redemptions: 8, maxRedemptions: 100 }],
    ['FRIENDS15', { percentOff: 15, enabled: true, redemptions: 3, expiresAtMs: now + 30 * DAY }],
    ['SUMMER25', { percentOff: 25, enabled: false, redemptions: 41, expiresAtMs: now - 40 * DAY }],
  ]
  for (const [code, fields] of coupons) {
    await put(`hosts/${hostId}/coupons/${code}`, { ...fields, createdAt: new Date(now - 45 * DAY) })
  }

  const cards = [
    ['JSB-4KQ7-M2XD', 5000, 5000, 'maya@example.com', 2, null],
    ['JSB-9TRP-2VLA', 2500, 1150, 'daniel@example.com', 9, null],
    ['JSB-H3NC-8YEW', 10000, 0, 'priya@example.com', 21, null],
    ['JSB-Q6ZF-5BKU', 7500, 7500, null, 30, 'Raffle prize for the fall fair'],
  ]
  for (const [code, initialCents, balanceCents, recipientEmail, days, note] of cards) {
    await put(`hosts/${hostId}/giftCards/${code}`, {
      initialCents,
      balanceCents,
      recipientEmail,
      orderId: null,
      issuedBy: uid,
      ...(note ? { note } : {}),
      ...(balanceCents < initialCents ? { lastUsedAtMs: now - DAY } : {}),
      searchTokens: giftCardSearchTokens(code, recipientEmail),
      createdAtMs: now - days * DAY,
    })
  }
  return `${discounts.length} discounts, ${coupons.length} coupons, ${cards.length} gift cards`
}
