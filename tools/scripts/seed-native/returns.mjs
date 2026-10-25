/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns and stays on the demo site (AGL-3966), so the Aglyn app's Returns
 * and Reservations screens show rows rather than an empty state:
 *
 * - `hosts/{hostId}/returns`: `HostReturn` (commerce-returns.ts), written by
 *   the server routes in the console, here against the store seed's shipped
 *   orders (`o-1044` fulfilled, `o-1045` delivered, `o-1052` fulfilled) in
 *   three states: requested, approved with a label, refunded and restocked.
 *   The store's return policy goes on `settings/store.returns`.
 * - `hosts/{hostId}/resources` and `hosts/{hostId}/reservations`:
 *   `HostResource` and `HostReservation` (commerce-reservations.ts), two
 *   cabins and their stays, and twelve RV hookups (one resource with
 *   `units: 12`) part booked, days at UTC midnight as the reservation routes
 *   keep them.
 */

import { COMMERCE_ORDER_STATUSES, COMMERCE_PEOPLE, COMMERCE_PRODUCTS } from './store.mjs'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

/** The store seed's order `number`: its customer, status and product (store.mjs writes it from the same lists). */
function storeOrder(number) {
  const index = number - 1041
  const [name, email] = COMMERCE_PEOPLE[(index * 5 + (index >> 2)) % COMMERCE_PEOPLE.length]
  const pool = COMMERCE_PRODUCTS.filter((entry) => entry.type !== 'digital')
  const pick = pool[(index * 5) % pool.length]
  return { id: `o-${number}`, number, status: COMMERCE_ORDER_STATUSES[index % COMMERCE_ORDER_STATUSES.length], name, email, product: pick }
}

/** UTC midnight, `days` from now. */
const dayMs = (now, days) => Math.floor((now + days * DAY) / DAY) * DAY

export async function seedReturns({ put, hostId, now: date }) {
  const now = date.getTime()

  await put(`hosts/${hostId}/settings/store`, { returns: { enabled: true, windowDays: 30, eligibleTypes: ['physical'] } }, { merge: true })

  const returns = [
    {
      id: 'seed-return-requested',
      order: storeOrder(1044),
      status: 'requested',
      reason: 'damaged',
      days: 1,
      extra: { customerNote: 'The box arrived crushed and one corner chipped.' },
    },
    {
      id: 'seed-return-approved',
      order: storeOrder(1045),
      status: 'approved',
      reason: 'size_or_fit',
      days: 4,
      extra: {
        merchantNote: 'Approved; label sent.',
        returnLabel: {
          carrier: 'usps',
          trackingNumber: '9202090153540012345678',
          labelUrl: 'https://example.com/labels/seed-return-approved.pdf',
          attachedAtMs: now - 3 * DAY,
        },
      },
    },
    {
      id: 'seed-return-refunded',
      order: storeOrder(1052),
      status: 'refunded',
      reason: 'no_longer_needed',
      days: 9,
      extra: {},
    },
  ]
  for (const entry of returns) {
    const { order } = entry
    // A return is only possible on a shipped order; a store seed change that moves these orders must move them too.
    if (order.status !== 'fulfilled' && order.status !== 'delivered') throw new Error(`returns seed: ${order.id} is ${order.status}, not shipped`)
    const createdAtMs = now - entry.days * DAY
    const unitCents = Math.round(order.product.price * 100)
    const timeline = [{ atMs: createdAtMs, event: 'requested', detail: 'Requested by the customer' }]
    const done = {}
    if (entry.status === 'approved' || entry.status === 'refunded') timeline.push({ atMs: createdAtMs + 6 * HOUR, event: 'approved' })
    if (entry.status === 'refunded') {
      timeline.push({ atMs: createdAtMs + 3 * DAY, event: 'received', detail: '1 item back on the shelf' })
      timeline.push({ atMs: createdAtMs + 3 * DAY + HOUR, event: 'refunded' })
      Object.assign(done, {
        restock: { lines: [{ lineItemId: 0, quantity: 1 }], atMs: createdAtMs + 3 * DAY },
        refundedAtMs: createdAtMs + 3 * DAY + HOUR,
        refundCents: unitCents,
      })
    }
    await put(`hosts/${hostId}/returns/${entry.id}`, {
      orderId: order.id,
      orderNumber: `#${order.number}`,
      customerEmail: order.email,
      customerName: order.name,
      lines: [{ lineItemId: 0, quantity: 1, reason: entry.reason, name: order.product.name }],
      status: entry.status,
      requestedBy: 'buyer',
      ...entry.extra,
      ...done,
      timeline,
      createdAtMs,
      updatedAtMs: timeline[timeline.length - 1].atMs,
    })
  }

  const cabins = [
    {
      id: 'seed-cabin-creekside',
      name: 'Creekside cabin',
      description: 'A one-room cabin by the creek, five minutes from the bakery.',
      capacity: 2,
      amenities: ['Wi-Fi', 'Kitchenette', 'Breakfast basket'],
      nightlyRateUsd: 140,
      weekendMultiplier: 1.25,
      minNights: 2,
      depositPct: 25,
      cancellationHours: 72,
    },
    {
      id: 'seed-cabin-loft',
      name: 'Loft above the bakery',
      description: 'The loft over the shop, with the ovens warming the floor.',
      capacity: 4,
      amenities: ['Wi-Fi', 'Washer', 'Parking'],
      nightlyRateUsd: 185,
      seasons: [{ from: '12-15', to: '01-05', multiplier: 1.5, label: 'Holidays' }],
      minNights: 1,
      cancellationHours: 48,
    },
  ]
  for (const { id, ...fields } of cabins) await put(`hosts/${hostId}/resources/${id}`, fields)

  const stays = [
    ['seed-stay-1', 'seed-cabin-creekside', 'checked_in', -1, 2, 'Lena Fischer', 'lena.fischer@fernhill.example', 140],
    ['seed-stay-2', 'seed-cabin-loft', 'confirmed', 3, 2, 'James Okafor', 'james.okafor@larkspur.example', 185],
    ['seed-stay-3', 'seed-cabin-creekside', 'confirmed', 6, 3, 'Sofia Reyes', 'sofia.reyes@harbormarket.example', 140],
    ['seed-stay-4', 'seed-cabin-loft', 'pending', 10, 1, 'Ethan Cole', 'ethan@example.test', 185],
    ['seed-stay-5', 'seed-cabin-creekside', 'checked_out', -9, 2, 'Naomi Brooks', 'naomi.brooks@brightside.example', 140],
    ['seed-stay-6', 'seed-cabin-loft', 'cancelled', 14, 2, 'Victor Santos', 'victor.santos@maplestreet.example', 185],
  ]
  for (const [id, resourceId, status, inDays, nights, guestName, guestEmail, rateUsd] of stays) {
    const totalCents = rateUsd * 100 * nights
    const depositCents = resourceId === 'seed-cabin-creekside' ? Math.round(totalCents * 0.25) : 0
    const paidCents = status === 'checked_out' ? totalCents : status === 'pending' || status === 'cancelled' ? 0 : depositCents
    await put(`hosts/${hostId}/reservations/${id}`, {
      resourceId,
      status,
      checkInDayMs: dayMs(now, inDays),
      checkOutDayMs: dayMs(now, inDays + nights),
      guestName,
      guestEmail,
      nights,
      totalCents,
      depositCents,
      paidCents,
      createdAtMs: now - (20 - inDays) * HOUR,
    })
  }
  /*
   * Twelve identical RV hookups (AGL-4044, several units per resource): five
   * left tomorrow, none the night after, two left the night after that, and a
   * block four nights out that closes every hookup. The native Reservations
   * screen draws these as its units-left look-ahead.
   */
  await put(`hosts/${hostId}/resources/seed-rv-hookups`, {
    name: 'RV hookups',
    description: 'Water and 30/50 amp at every site.',
    units: 12,
    capacity: 6,
    nightlyRateUsd: 60,
    minNights: 1,
    blocks: [{ fromDayMs: dayMs(now, 4), toDayMs: dayMs(now, 5) }],
  })
  const hookupNights = [
    [1, 7],
    [2, 12],
    [3, 10],
  ]
  let hookupStays = 0
  for (const [inDays, count] of hookupNights) {
    for (let n = 1; n <= count; n++) {
      hookupStays++
      await put(`hosts/${hostId}/reservations/seed-rv-${inDays}-${n}`, {
        resourceId: 'seed-rv-hookups',
        status: 'confirmed',
        checkInDayMs: dayMs(now, inDays),
        checkOutDayMs: dayMs(now, inDays + 1),
        guestName: `Site ${n} guest`,
        guestEmail: null,
        nights: 1,
        totalCents: 6000,
        depositCents: 0,
        paidCents: 0,
        createdAtMs: now - HOUR,
      })
    }
  }
  return `${returns.length} returns, ${cabins.length + 1} resources, ${stays.length + hookupStays} stays`
}
